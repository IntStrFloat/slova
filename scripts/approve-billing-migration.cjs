// Local operator command only. Prepare a reviewed JSON record containing userId,
// exact six-field draft, four-field target, disposition, and evidence. This does
// not verify the evidence for the operator and must never be called from HTTP.
// Linux setup (once): install -d -o root -g slova -m 0750 /etc/slova
// Run as root: node scripts/approve-billing-migration.cjs /private/review.json
// Atomic replacements retain root:slova 0640; the service can read, never write.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { validReview } = require('../backend/runtime/billing-migration.cjs');
const { createFileStore } = require('../backend/runtime/store.cjs');

function assertDestinationPolicy(directory, existing, serviceGid, uid) {
  if (uid !== 0 || !Number.isSafeInteger(serviceGid) || serviceGid <= 0 || !directory.isDirectory() || directory.isSymbolicLink() ||
    directory.uid !== 0 || directory.gid !== serviceGid || (directory.mode & 0o777) !== 0o750 ||
    (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== 0 || existing.gid !== serviceGid ||
      (existing.mode & 0o777) !== 0o640))) throw new Error('Protected root:slova directory/file permissions required');
}

function protectedWriter(recordsPath, options = {}) {
  const platform = options.platform ?? process.platform;
  const disk = options.fs ?? fs;
  const directory = path.dirname(recordsPath);
  let existing;
  try { existing = disk.lstatSync(recordsPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing?.isSymbolicLink()) throw new Error('Symlink destination rejected');
  if (platform === 'win32') return (data) => createFileStore(recordsPath, { strict: true, durable: true }).write(data);
  const gid = options.serviceGid ?? Number(execFileSync('id', ['-g', 'slova'], { encoding: 'utf8' }).trim());
  if (disk.realpathSync(directory) !== path.resolve(directory)) throw new Error('Symlink parent rejected');
  assertDestinationPolicy(disk.lstatSync(directory), existing, gid, options.uid ?? process.getuid());
  return (data) => {
    const temporary = `${recordsPath}.${crypto.randomUUID()}.tmp`;
    let fd;
    let created = false;
    try {
      fd = disk.openSync(temporary, 'wx', 0o600);
      created = true;
      disk.fchownSync(fd, 0, gid);
      disk.fchmodSync(fd, 0o640);
      disk.writeFileSync(fd, JSON.stringify(data));
      disk.fsyncSync(fd);
      disk.closeSync(fd);
      fd = undefined;
      disk.renameSync(temporary, recordsPath);
      const parentFd = disk.openSync(directory, 'r');
      try { disk.fsyncSync(parentFd); } finally { disk.closeSync(parentFd); }
    } finally {
      if (fd !== undefined) disk.closeSync(fd);
      if (created && disk.existsSync(temporary)) disk.unlinkSync(temporary);
    }
  };
}

function approve(reviewPath, recordsPath = '/etc/slova/billing-migration-resolutions.json', options = {}) {
  if (!reviewPath || !path.isAbsolute(reviewPath) || !path.isAbsolute(recordsPath) || path.resolve(reviewPath) === path.resolve(recordsPath)) throw new Error('Explicit separate absolute review and records paths required');
  const review = { ...JSON.parse(fs.readFileSync(reviewPath, 'utf8')), reviewedAt: new Date().toISOString() };
  if (!validReview(review)) throw new Error('Invalid reviewed migration record');
  const write = protectedWriter(recordsPath, options);
  const store = createFileStore(recordsPath, { strict: true, durable: true });
  const data = fs.existsSync(recordsPath) ? store.read() : { version: 1, resolutions: [] };
  if (data.version !== 1 || !Array.isArray(data.resolutions) || !data.resolutions.every(validReview)) throw new Error('Invalid operator records file');
  const duplicate = data.resolutions.some((entry) => entry.userId === review.userId &&
    isDeepStrictEqual(entry.draft, review.draft) && isDeepStrictEqual(entry.target, review.target));
  if (!duplicate) { data.resolutions.push(review); write(data); }
  return { recorded: true, duplicate };
}

if (require.main === module) {
  try { console.log(JSON.stringify(approve(process.argv[2], process.argv[3]))); }
  catch { console.error('Migration approval failed. On Linux run as root; require /etc/slova root:slova 0750 and an existing records file root:slova 0640. Inspect the private review locally.'); process.exitCode = 1; }
}
module.exports = { approve, assertDestinationPolicy, protectedWriter };
