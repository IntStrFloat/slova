/**
 * Деплой backend Slova на общий сервер (изолированно от bloxx, спека 14).
 * Креды — из gitignored deploy.secrets. Запуск:
 *   node scripts/deploy.cjs            # preflight (read-only)
 *   node scripts/deploy.cjs --apply    # деплой
 * Защиты: ничего из bloxx не трогаем; nginx -t перед reload; HTTP-first + certbot.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { NodeSSH } = require('node-ssh');

const ROOT = path.join(__dirname, '..');
const SUB = 'slova.193.160.208.95.nip.io';

function secrets() {
  const t = fs.readFileSync(path.join(ROOT, 'deploy.secrets'), 'utf8');
  const e = {};
  t.split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2].trim();
  });
  return e;
}

async function main() {
  const s = secrets();
  const apply = process.argv.includes('--apply');
  const ssh = new NodeSSH();
  await ssh.connect({
    host: s.SLOVA_DEPLOY_HOST,
    username: s.SLOVA_DEPLOY_USER,
    password: s.SLOVA_DEPLOY_PASS,
    readyTimeout: 25000,
  });
  const run = async (cmd) => {
    const r = await ssh.execCommand(cmd);
    return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.code };
  };
  const log = (label, r) => console.log(`• ${label}: ${r.out || ''}${r.err ? ' [err] ' + r.err : ''}`);

  if (process.argv.includes('--code')) {
    console.log('=== CODE REDEPLOY (upload + restart) ===');
    await ssh.putDirectory(path.join(ROOT, 'backend'), '/opt/slova/backend', {
      recursive: true,
      concurrency: 4,
      validate: (p) => !p.includes('node_modules') && !p.includes('__tests__'),
    });
    await run('chown -R slova:slova /opt/slova');
    log('restart', await run('systemctl restart slova-backend && sleep 1 && systemctl is-active slova-backend'));
    log('health', await run('curl -fs http://127.0.0.1:8788/api/health || echo FAIL'));
    ssh.dispose();
    return;
  }

  console.log('=== PREFLIGHT ===');
  log('node', await run('node -v 2>/dev/null || echo NO_NODE'));
  log('opt dirs', await run('ls -1 /opt 2>/dev/null | tr "\\n" " "'));
  log('bloxx active', await run('systemctl is-active bloxx-backend 2>/dev/null || echo n/a'));
  log('port 8787 (bloxx)', await run("ss -ltn 2>/dev/null | grep -c ':8787' || echo 0"));
  log('port 8788 (slova)', await run("ss -ltn 2>/dev/null | grep ':8788' || echo FREE"));
  log('slova user', await run('id -u slova 2>/dev/null || echo NO_USER'));
  log('nginx', await run('nginx -v 2>&1 || echo NO_NGINX'));
  log('nginx sites', await run('ls -1 /etc/nginx/sites-enabled 2>/dev/null | tr "\\n" " "'));
  log('certbot', await run('command -v certbot || echo NO_CERTBOT'));
  log('letsencrypt email', await run('ls -1 /etc/letsencrypt/accounts/*/*/*/regr.json 2>/dev/null | head -1 || echo none'));

  if (!apply) {
    console.log('\n(preflight only — повторите с --apply для деплоя)');
    ssh.dispose();
    return;
  }

  console.log('\n=== APPLY (изолированно от bloxx) ===');
  // 1) пользователь и каталоги
  log('useradd', await run('id -u slova >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin slova; echo ok'));
  log('mkdirs', await run('mkdir -p /opt/slova/backend /var/lib/slova && echo ok'));

  // 2) загрузка backend
  console.log('• upload backend/ …');
  await ssh.putDirectory(path.join(ROOT, 'backend'), '/opt/slova/backend', {
    recursive: true,
    concurrency: 4,
    validate: (p) => !p.includes('node_modules') && !p.includes('__tests__'),
  });
  log('uploaded', await run('ls -1 /opt/slova/backend && ls /opt/slova/backend/runtime'));

  // 3) backend.env (API_KEY пустой — публичный API, авторизация по bearer токену)
  await run(`printf 'PORT=8788\\nDATA_PATH=/var/lib/slova/store.json\\nAPI_KEY=\\n' > /opt/slova/backend.env`);
  log('env', await run('cat /opt/slova/backend.env'));
  await run('chown -R slova:slova /opt/slova /var/lib/slova && chmod 600 /opt/slova/backend.env');

  // 4) systemd unit
  await ssh.putFile(path.join(ROOT, 'backend/deploy/slova-backend.service'), '/etc/systemd/system/slova-backend.service');
  log('systemd', await run('systemctl daemon-reload && systemctl enable --now slova-backend && sleep 1 && systemctl is-active slova-backend'));
  log('local health', await run('curl -fs http://127.0.0.1:8788/api/health || echo FAIL'));

  // 5) nginx HTTP-first (чтобы certbot выпустил cert), затем certbot добавит TLS
  const httpConf = `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${SUB};\n  location /api/ {\n    proxy_pass http://127.0.0.1:8788;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    client_max_body_size 2m;\n  }\n  location / { return 404; }\n}\n`;
  await run(`cat > /etc/nginx/sites-available/slova <<'NGINX'\n${httpConf}NGINX`);
  await run('ln -sf /etc/nginx/sites-available/slova /etc/nginx/sites-enabled/slova');
  const t = await run('nginx -t 2>&1');
  log('nginx -t', t);
  if (/successful/i.test(t.err + t.out)) {
    log('nginx reload', await run('systemctl reload nginx && echo reloaded'));
    log('certbot', await run(`certbot --nginx -d ${SUB} --non-interactive --agree-tos --register-unsafely-without-email --redirect 2>&1 | tail -4`));
    log('https health', await run(`curl -fsk https://${SUB}/api/health || echo FAIL`));
  } else {
    console.log('  ! nginx -t не прошёл — НЕ перезагружаю nginx (bloxx не затронут). Backend на :8788 уже работает.');
  }

  ssh.dispose();
  console.log('\n=== DONE ===');
}

main().catch((e) => {
  console.error('DEPLOY ERROR:', e.message);
  process.exit(1);
});
