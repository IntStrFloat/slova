"""Publish only Slova app-ads.txt while preserving the deployed storefront."""
import argparse
import base64
import hashlib
import inspect
import json
from pathlib import Path
import re
import socket
import struct

import paramiko

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = 'slova.193.160.208.95.nip.io'
EXPECTED_SHA256 = '8e96a38e044e5e22d94dabdc81ee344b676f37cf7366c4a61c8cf14bcff690a1'
ROUTE = '''    location = /app-ads.txt {
        root /var/www/slova/current;
        try_files /app-ads.txt =404;
        default_type text/plain;
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options "nosniff" always;
    }
'''


def add_route(config):
    assert set(re.findall(r'server_name\s+([^;]+);', config)) == {DOMAIN}
    assert '127.0.0.1:8788' in config and '8787' not in config and 'bloxx' not in config
    matches = list(re.finditer(r'(?ms)^    # BEGIN SLOVA_STOREFRONT.*?^    # END SLOVA_STOREFRONT', config))
    assert len(matches) == 1
    marker = matches[0]
    block = marker.group()
    if '/app-ads.txt' in config:
        assert config.count(ROUTE) == 1 and ROUTE in block
        return config
    anchor = '    location ^~ /storefront-assets/ {'
    assert block.count(anchor) == 1
    return config[:marker.start()] + block.replace(anchor, ROUTE + anchor, 1) + config[marker.end():]


REMOTE = r'''
import fcntl, os, shutil, stat, subprocess, time, uuid

def require(condition, message):
    if not condition: raise RuntimeError(message)

def run(args):
    result = subprocess.run(args, capture_output=True, timeout=25)
    require(result.returncode == 0, 'command_failed:' + args[0])
    return result.stdout

def fetch(url, headers=False):
    args = ['curl', '--fail', '--silent', '--show-error', '--max-time', '15',
            '--resolve', DOMAIN + ':443:127.0.0.1']
    if headers: args += ['--dump-header', '-']
    return run(args + ['-H', 'X-Slova-Billing-Protocol: robokassa-v3', 'https://' + DOMAIN + url])

def snapshot():
    services = run(['systemctl', 'is-active', 'slova-backend', 'bloxx-backend', 'nginx']).decode().splitlines()
    require(services == ['active', 'active', 'active'], 'services_not_active')
    catalog = json.loads(fetch('/api/billing/catalog'))
    health = json.loads(fetch('/api/health'))
    return {'services': services, 'billingCatalogSha256': hashlib.sha256(json.dumps(catalog, sort_keys=True).encode()).hexdigest(),
            'health': health, 'indexSha256': hashlib.sha256(fetch('/')).hexdigest()}

def tree_hashes(directory):
    hashes = {}
    for target in directory.rglob('*'):
        require(not target.is_symlink(), 'storefront_contains_symlink')
        require(target.is_dir() or target.is_file(), 'unexpected_storefront_entry')
        if target.is_file(): hashes[str(target.relative_to(directory))] = hashlib.sha256(target.read_bytes()).hexdigest()
    require('index.html' in hashes and len(hashes) <= 100, 'unexpected_storefront')
    return hashes

config = Path('/etc/nginx/sites-available/slova')
root = Path('/var/www/slova')
releases = root / 'releases'
current = root / 'current'
lock = Path('/opt/slova/storefront-deploy.lock')
require(config.resolve() == config and root.resolve() == root and releases.resolve() == releases, 'unsafe_root')
require(current.is_symlink() and current.resolve().parent == releases, 'unsafe_current')
require(lock.parent.resolve() == lock.parent and not lock.is_symlink(), 'unsafe_lock')
with lock.open('a') as handle:
    fcntl.flock(handle, fcntl.LOCK_EX)
    previous = os.readlink(current)
    previous_root = current.resolve()
    original = config.read_bytes()
    metadata = config.stat()
    updated = add_route(original.decode('utf-8')).encode('utf-8')
    before = snapshot()
    existing = tree_hashes(previous_root)
    name = 'app-ads-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8]
    backup_root = Path('/opt/slova/backups')
    require(backup_root.resolve() == backup_root and backup_root.is_dir(), 'unsafe_backup_root')
    backup = backup_root / name
    backup.mkdir(mode=0o700)
    (backup / 'nginx-slova.conf').write_bytes(original)
    (backup / 'nginx-slova.conf').chmod(0o600)
    (backup / 'previous-current.txt').write_text(previous)
    (backup / 'before.json').write_text(json.dumps(before, sort_keys=True))
    release = releases / name
    shutil.copytree(previous_root, release)
    require(tree_hashes(release) == existing, 'storefront_copy_mismatch')
    data = base64.b64decode(p['content'])
    require(hashlib.sha256(data).hexdigest() == EXPECTED_SHA256, 'attachment_hash_mismatch')
    target = release / 'app-ads.txt'
    target.write_bytes(data)
    target.chmod(0o644)
    actual = tree_hashes(release)
    require(all(actual[key] == value for key, value in existing.items() if key != 'app-ads.txt'), 'existing_file_changed')
    require(set(actual) == set(existing) | {'app-ads.txt'}, 'unexpected_new_file')
    # Refuse a deployment that raced a separate publisher.
    require(config.read_bytes() == original and os.readlink(current) == previous, 'deployment_race')
    require(tree_hashes(previous_root) == existing, 'storefront_race')
    next_link = root / (name + '.next')

    def save_config(content):
        temporary = config.with_name(name + '.tmp')
        with temporary.open('xb') as out:
            out.write(content); out.flush(); os.fsync(out.fileno())
        temporary.chmod(stat.S_IMODE(metadata.st_mode))
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, config)

    try:
        save_config(updated)
        run(['nginx', '-t'])
        os.symlink(release, next_link)
        os.replace(next_link, current)
        run(['systemctl', 'reload', 'nginx'])
        verified = False
        for attempt in range(5):
            try:
                response = fetch('/app-ads.txt', headers=True)
                header, body = response.split(b'\r\n\r\n', 1)
                verified = (hashlib.sha256(body).hexdigest() == EXPECTED_SHA256
                            and re.search(br'(?im)^content-type:\s*text/plain(?:\s*;[^\r\n]*)?\r?$', header) is not None)
                if verified: break
            except Exception:
                pass
            time.sleep(0.5)
        require(verified, 'published_file_verification_failed')
        after = snapshot()
        require(before == after, 'existing_service_or_content_changed')
        require(tree_hashes(release) == actual, 'published_tree_changed')
    except BaseException:
        save_config(original)
        if next_link.is_symlink(): next_link.unlink()
        os.symlink(previous, next_link)
        os.replace(next_link, current)
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        require(snapshot() == before, 'rollback_verification_failed')
        raise
    print(json.dumps({'status': 'PASS', 'published': True, 'url': 'https://' + DOMAIN + '/app-ads.txt',
        'sha256': EXPECTED_SHA256, 'bytes': len(data), 'contentType': 'text/plain', 'tlsVerified': True,
        'preservedStorefrontFiles': len(existing), 'billingCatalogUnchanged': True, 'healthUnchanged': True,
        'servicesUnchanged': True, 'services': dict(zip(['slova-backend', 'bloxx-backend', 'nginx'], after['services'])),
        'release': str(release), 'backup': str(backup), 'previousRelease': str(previous_root)}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interface-index', type=int, required=True)
    parser.add_argument('--source-address', required=True)
    parser.add_argument('--expected-sha256', default=EXPECTED_SHA256)
    parser.add_argument('--report', type=Path,
                        default=ROOT / 'output/easy-monetization-2026-10-20/app-ads-publication.json')
    args = parser.parse_args()
    expected_sha256 = args.expected_sha256.lower()
    assert re.fullmatch(r'[0-9a-f]{64}', expected_sha256), 'Invalid expected SHA256'
    report = args.report.resolve()
    assert not report.exists(), 'Publication report already exists; inspect it before rerunning'
    content = (ROOT / 'web/storefront/app-ads.txt').read_bytes()
    assert hashlib.sha256(content).hexdigest() == expected_sha256
    plan = {'content': base64.b64encode(content).decode()}
    prefix = ('from pathlib import Path\nimport base64, hashlib, json, re\n'
              + 'DOMAIN=' + repr(DOMAIN) + '\nEXPECTED_SHA256=' + repr(expected_sha256)
              + '\nROUTE=' + repr(ROUTE) + '\np=json.loads(base64.b64decode('
              + repr(base64.b64encode(json.dumps(plan).encode()).decode()) + '))\n')
    script = prefix + inspect.getsource(add_route) + '\n' + REMOTE
    raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    raw.settimeout(15)
    raw.setsockopt(socket.IPPROTO_IP, 31, struct.pack('!I', args.interface_index))
    raw.bind((args.source_address, 0))
    ssh = paramiko.SSHClient()
    ssh.load_host_keys(str(Path.home() / '.ssh/known_hosts'))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        raw.connect(('193.160.208.95', 22))
        ssh.connect('193.160.208.95', username='root', sock=raw, look_for_keys=True, allow_agent=True,
                    timeout=15, auth_timeout=15, banner_timeout=15)
        stdin, stdout, stderr = ssh.exec_command('python3 -', timeout=180)
        stdin.write(script)
        stdin.channel.shutdown_write()
        output = stdout.read().decode()
        error = stderr.read().decode()
        status = stdout.channel.recv_exit_status()
        if status:
            # Remote code contains no credentials, but keep error output bounded.
            raise RuntimeError('Publication failed: ' + error[-1200:])
        result = json.loads(output)
        report.parent.mkdir(parents=True, exist_ok=True)
        with report.open('x', encoding='utf-8') as out:
            json.dump(result, out, indent=2); out.write('\n')
        print(json.dumps(result))
    finally:
        ssh.close()
        raw.close()


if __name__ == '__main__':
    main()
