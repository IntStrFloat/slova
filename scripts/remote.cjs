/** Запуск произвольной команды на деплой-сервере (креды из deploy.secrets). */
const fs = require('node:fs');
const path = require('node:path');
const { NodeSSH } = require('node-ssh');

function secrets() {
  const t = fs.readFileSync(path.join(__dirname, '..', 'deploy.secrets'), 'utf8');
  const e = {};
  t.split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2].trim();
  });
  return e;
}

(async () => {
  const s = secrets();
  const ssh = new NodeSSH();
  await ssh.connect({
    host: s.SLOVA_DEPLOY_HOST,
    username: s.SLOVA_DEPLOY_USER,
    password: s.SLOVA_DEPLOY_PASS,
    readyTimeout: 25000,
  });
  const cmd = process.argv.slice(2).join(' ');
  const r = await ssh.execCommand(cmd);
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.log('[err]', r.stderr);
  ssh.dispose();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
