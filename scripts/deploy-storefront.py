"""Deploy only Slova's static storefront over existing verified SSH access.

Requires the already installed Paramiko. No credentials are copied or printed.
The optional Windows interface selection leaves VPN and system routes unchanged.
"""
import argparse
import base64
import hashlib
import json
import re
import socket
import struct
import uuid
from datetime import datetime, timezone
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'output/robokassa-qa/2026-10-16/approval-v3/storefront'
HOST = '193.160.208.95'
CONFIG = '/etc/nginx/sites-available/slova'
DOMAIN = 'slova.193.160.208.95.nip.io'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interface-index', type=int, required=True)
    parser.add_argument('--source-address', required=True)
    parser.add_argument('--build-dir', type=Path, default=BUILD)
    args = parser.parse_args()
    build = args.build_dir.resolve()
    manifest = json.loads((build / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['version'] == 1 and manifest['url'] == f'https://{DOMAIN}/'
    entries = manifest['files']
    assert 3 <= len(entries) <= 12 and len({x['path'] for x in entries}) == len(entries)
    assert any(x['path'] == 'index.html' for x in entries)
    for item in entries:
        assert re.fullmatch(r'index\.html|app-ads\.txt|storefront-assets/[a-z0-9-]+\.(?:css|jpg|png|webp)', item['path'])
        file = build / item['path']
        assert not file.is_symlink() and file.resolve().is_relative_to(build)
        content = file.read_bytes()
        assert len(content) == item['bytes'] and hashlib.sha256(content).hexdigest() == item['sha256']
    release_name = 'storefront-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    release = '/var/www/slova/releases/' + release_name
    local_config = (ROOT / 'backend/deploy/nginx-slova.conf').read_text(encoding='utf-8')
    block = re.search(r'(?ms)^    # BEGIN SLOVA_STOREFRONT.*?^    # END SLOVA_STOREFRONT', local_config).group()
    raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    raw.settimeout(15)
    raw.setsockopt(socket.IPPROTO_IP, 31, struct.pack('!I', args.interface_index))
    raw.bind((args.source_address, 0))
    ssh = paramiko.SSHClient()
    ssh.load_host_keys(str(Path.home() / '.ssh/known_hosts'))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        raw.connect((HOST, 22))
        ssh.connect(HOST, username='root', sock=raw, look_for_keys=True, allow_agent=True,
                    timeout=15, auth_timeout=15, banner_timeout=15)
        sftp = ssh.open_sftp()
        original = sftp.open(CONFIG, 'rb').read()
        config = original.decode('utf-8')
        assert set(re.findall(r'server_name\s+([^;]+);', config)) == {DOMAIN}
        assert '127.0.0.1:8788' in config and 'bloxx' not in config and '8787' not in config
        marker = r'(?ms)^\s*# BEGIN SLOVA_STOREFRONT.*?^\s*# END SLOVA_STOREFRONT'
        if 'BEGIN SLOVA_STOREFRONT' in config:
            updated, count = re.subn(marker, '\n' + block, config)
        else:
            updated, count = re.subn(r'(?m)^\s*location /\s*\{\s*return 404;\s*\}\s*$', '\n' + block + '\n', config)
        assert count == 1 and updated.count('BEGIN SLOVA_STOREFRONT') == 1
        # The static root is fixed and separate from both app backends. Refuse
        # symlinked parent roots and existing files before uploading anything.
        for directory in ['/var/www/slova', '/var/www/slova/releases', release, release + '/storefront-assets']:
            try:
                stat = sftp.lstat(directory)
                import stat as stat_module
                assert stat_module.S_ISDIR(stat.st_mode) and sftp.normalize(directory) == directory
            except FileNotFoundError:
                sftp.mkdir(directory, 0o755)
        for item in entries:
            target = release + '/' + item['path']
            with sftp.open(target, 'wx') as handle:
                handle.write((build / item['path']).read_bytes())
            sftp.chmod(target, 0o644)
        plan = {'release': release, 'name': release_name, 'domain': DOMAIN, 'files': entries,
                'configSha256': hashlib.sha256(original).hexdigest(), 'config': updated}
        encoded = base64.b64encode(json.dumps(plan).encode()).decode()
        script = "import base64,json\np=json.loads(base64.b64decode('" + encoded + "'))\n" + REMOTE
        stdin, stdout, stderr = ssh.exec_command('python3 -', timeout=60)
        stdin.write(script)
        stdin.channel.shutdown_write()
        output = stdout.read().decode()
        error = stderr.read().decode()
        status = stdout.channel.recv_exit_status()
        if status != 0:
            raise RuntimeError('Remote storefront verification failed: ' + error[-1500:])
        result = json.loads(output)
        (build.parent / 'storefront-deployment.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result))
        sftp.close()
    finally:
        ssh.close()
        raw.close()


REMOTE = r'''
import os, pathlib, hashlib, subprocess, fcntl, uuid, time
def run(args):
    r = subprocess.run(args, capture_output=True, timeout=20)
    if r.returncode != 0: raise RuntimeError('command_failed:' + args[0]+':'+str(r.returncode)+':'+r.stderr.decode(errors='replace')[-240:])
    return r.stdout
def get(url, headers=()):
    args=['curl','--fail','--silent','--show-error','--max-time','15','--resolve',p['domain']+':443:127.0.0.1']
    for h in headers: args += ['-H',h]
    return run(args + ['https://'+p['domain']+url])
def verify_file(url, digest):
    # systemctl reload returns before nginx's new workers necessarily accept
    # requests. Wait for the expected bytes, without redoing any mutation.
    for attempt in range(5):
        try:
            if hashlib.sha256(get(url)).hexdigest()==digest: return
        except RuntimeError:
            if attempt==4: raise
        if attempt<4: time.sleep(0.5)
    raise RuntimeError('published_file_mismatch:'+url)
config=pathlib.Path('/etc/nginx/sites-available/slova')
root=pathlib.Path('/var/www/slova')
release=pathlib.Path(p['release'])
assert root.resolve() == root and release.parent == root/'releases' and release.resolve() == release
assert config.resolve() == config
with open('/opt/slova/storefront-deploy.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 original=config.read_bytes(); metadata=config.stat()
 assert hashlib.sha256(original).hexdigest() == p['configSha256']
 for item in p['files']:
    target=release/item['path']
    assert target.resolve().is_relative_to(release)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == item['sha256']
 catalog=json.loads(get('/api/billing/catalog',['X-Slova-Billing-Protocol: robokassa-v3']))
 assert catalog['provider']=='robokassa' and catalog['mode']=='test' and catalog['available'] is False
 assert catalog['plan']['amount']=='99.00' and catalog['plan']['periodDays']==30 and catalog['plan']['currency']=='RUB'
 before=run(['systemctl','is-active','slova-backend','bloxx-backend','nginx']).decode().splitlines()
 assert before==['active','active','active']
 current=root/'current'
 assert not current.exists() or current.is_symlink()
 previous=os.readlink(current) if current.is_symlink() else None
 if previous is not None: assert current.resolve().parent == root/'releases'
 backup=pathlib.Path('/opt/slova/backups')/p['name']
 backup.mkdir(mode=0o700)
 (backup/'nginx-slova.conf').write_bytes(original); os.chmod(backup/'nginx-slova.conf',0o600)
 (backup/'previous-current.txt').write_text(previous or '')
 def save_config(data):
    temporary=config.with_name('slova.'+p['name']+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('xb') as out:
        out.write(data); out.flush(); os.fsync(out.fileno())
    os.chmod(temporary,metadata.st_mode & 0o777); os.chown(temporary,metadata.st_uid,metadata.st_gid)
    os.replace(temporary,config)
 next_link=root/('current.'+p['name'])
 try:
    os.symlink(release,next_link); os.replace(next_link,current)
    save_config(p['config'].encode())
    run(['nginx','-t']); run(['systemctl','reload','nginx'])
    for item in p['files']:
        url='/' if item['path']=='index.html' else '/'+item['path']
        verify_file(url,item['sha256'])
    assert json.loads(get('/api/billing/catalog',['X-Slova-Billing-Protocol: robokassa-v3']))==catalog
    for url in ['/api/health','/api/billing/terms','/api/billing/privacy','/api/billing/user-agreement','/api/billing/personal-data-consent','/api/billing/manage']: get(url)
    assert run(['systemctl','is-active','slova-backend','bloxx-backend','nginx']).decode().splitlines()==before
 except BaseException:
    save_config(original)
    if previous is None:
        if current.is_symlink() and current.resolve()==release: current.unlink()
    else:
        os.symlink(previous,next_link); os.replace(next_link,current)
    run(['nginx','-t']); run(['systemctl','reload','nginx'])
    raise
 print(json.dumps({'deployed':True,'url':'https://'+p['domain']+'/', 'release':str(release),'backup':str(backup),
    'filesVerified':len(p['files']),'tlsVerified':True,'billingUnchanged':True,'salesEnabled':False,
    'services':dict(zip(['slova-backend','bloxx-backend','nginx'],before))}))
'''

if __name__ == '__main__':
    main()
