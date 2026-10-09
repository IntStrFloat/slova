const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { expo: config } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const releaseName = `slova-${config.version}-vc${config.android.versionCode}`;
const artifact = path.join(root, `output/release/${releaseName}-release.aab`);
const java = 'C:/Program Files/Android/Android Studio/jbr/bin';
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.status}`);
  return result.stdout;
}
const manifest = JSON.parse(run('C:/Python312/python.exe', [
  path.join(root, 'output/retention-2026-10-03/inspect_aab.py'), artifact,
]));
if (manifest.package !== config.android.package || manifest.versionName !== config.version
  || manifest.versionCode !== String(config.android.versionCode)) {
  throw new Error('Unexpected release manifest');
}
const verified = run(path.join(java, 'jarsigner.exe'), ['-J-Duser.language=en', '-verify', artifact]);
if (!verified.includes('jar verified.')) throw new Error('Signature was not confirmed');
const certificate = run(path.join(java, 'keytool.exe'), ['-J-Duser.language=en', '-printcert', '-jarfile', artifact]);
const certificateSha256 = certificate.match(/SHA256:\s*([A-F0-9:]+)/)?.[1].replaceAll(':', '').toLowerCase();
const previous = JSON.parse(fs.readFileSync(path.join(root, 'output/release/slova-0.1.8-vc12-verification.json'), 'utf8'));
if (!certificateSha256 || certificateSha256 !== previous.certificateSha256) throw new Error('Release certificate changed');
const report = {
  package: manifest.package, versionName: manifest.versionName, versionCode: Number(manifest.versionCode),
  architectures: manifest.architectures, build: 'bundleRelease',
  sizeBytes: fs.statSync(artifact).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),
  certificateSha256, signatureVerified: true, matchesPreviousReleaseCertificate: true, artifact,
};
fs.writeFileSync(path.join(root, `output/release/${releaseName}-verification.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
