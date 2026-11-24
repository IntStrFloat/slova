const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createBillingMigration } = require('../runtime/billing-migration.cjs');
const { createApi } = require('../runtime/api.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');
const { approve, assertDestinationPolicy, protectedWriter } = require('../../scripts/approve-billing-migration.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const target = { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova', mode: 'live' };
function fixture() {
  const requestId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const draft = { requestId, paymentId: 'old-payment', provider: 'yookassa', protocol: null, merchantLogin: null, mode: null };
  const ledger = { billingVersion: 1, requests: { [requestId]: attemptId },
    attempts: { [attemptId]: { id: attemptId, subscriptionId, userId: 'owner', mode: 'test', paymentId: draft.paymentId } },
    subscriptions: { [subscriptionId]: { id: subscriptionId, userId: 'owner', mode: 'test' } }, payments: {}, refunds: {} };
  const resolver = createBillingMigration({ target, sources: [{ provider: 'yookassa', read: () => structuredClone(ledger) }] });
  return { draft, ledger, resolver };
}

test('owned TEST legacy attempt resolves exact draft without changing retired journal', async () => {
  const f = fixture();
  const before = structuredClone(f.ledger);
  assert.deepEqual(await f.resolver.resolve('owner', f.draft), { resolution: 'safe_to_discard', reason: 'retired_test_payment', draft: f.draft, target });
  assert.deepEqual(f.ledger, before);
});

test('lost response without paymentId still requires a known owned TEST request', async () => {
  const f = fixture();
  const draft = { ...f.draft, paymentId: null };
  assert.equal((await f.resolver.resolve('owner', draft)).resolution, 'safe_to_discard');
  await assert.rejects(f.resolver.resolve('other', draft), { code: 'billing_migration_unresolved' });
  await assert.rejects(f.resolver.resolve('owner', { ...draft, requestId: crypto.randomUUID() }), { code: 'billing_migration_unresolved' });
});

test('live, ambiguous, missing, corrupt and falsely bound requests remain quarantined', async () => {
  const f = fixture();
  for (const change of [{ paymentId: 'wrong' }, { provider: 'robokassa' }, { mode: 'live' }, { merchantLogin: 'unknown-shop' }]) {
    await assert.rejects(f.resolver.resolve('owner', { ...f.draft, ...change }), { code: 'billing_migration_unresolved' });
  }
  for (const item of Object.values(f.ledger.attempts)) item.mode = 'live';
  for (const item of Object.values(f.ledger.subscriptions)) item.mode = 'live';
  await assert.rejects(f.resolver.resolve('owner', { ...f.draft, mode: 'test' }), { code: 'billing_migration_unresolved' });
  for (const read of [() => { throw new Error('private file path'); }, () => ({}), () => null]) {
    const resolver = createBillingMigration({ target, sources: [{ provider: 'yookassa', read }] });
    await assert.rejects(resolver.resolve('owner', f.draft), { code: 'billing_migration_unresolved', message: 'billing_migration_unresolved' });
  }
});

test('retired Robokassa TEST resolution verifies actual merchant and both ledger modes', async () => {
  const f = fixture();
  f.ledger.billingVersion = 2;
  f.ledger.identity = { provider: 'robokassa', merchant: 'slova', mode: 'test' };
  const a = Object.values(f.ledger.attempts)[0];
  Object.assign(a, { invoiceId: '2', provider: 'robokassa', merchant: 'slova' });
  const draft = { ...f.draft, provider: 'robokassa', protocol: 'robokassa-v1', merchantLogin: 'slova', mode: 'test', paymentId: '2' };
  const resolver = createBillingMigration({ target, sources: [{ provider: 'robokassa', read: () => f.ledger }] });
  assert.equal((await resolver.resolve('owner', draft)).reason, 'retired_test_payment');
  assert.equal((await resolver.resolve('owner', { ...draft, protocol: 'robokassa-v2' })).reason, 'retired_test_payment');
  assert.equal((await resolver.resolve('owner', { ...draft, protocol: 'robokassa-v3' })).reason, 'retired_test_payment');
  await assert.rejects(resolver.resolve('owner', { ...draft, protocol: 'robokassa-v4' }), { code: 'billing_migration_unresolved' });
  const sameTestTarget = createBillingMigration({ target: { ...target, mode: 'test' },
    sources: [{ provider: 'robokassa', read: () => f.ledger }] });
  const before = structuredClone(f.ledger);
  await assert.rejects(sameTestTarget.resolve('owner', draft), { code: 'billing_migration_unresolved' });
  assert.deepEqual(f.ledger, before);
  f.ledger.identity.mode = 'live';
  await assert.rejects(resolver.resolve('owner', draft), { code: 'billing_migration_unresolved' });
});

test('historical v1 and v2 operator approvals remain readable without approving a new v3 target', async () => {
  const f = fixture();
  const draft = { ...f.draft, provider: 'robokassa', protocol: 'robokassa-v1', merchantLogin: 'slova', mode: 'live' };
  const oldReview = { userId: 'owner', draft, target: { ...target, protocol: 'robokassa-v1' },
    disposition: 'closed_without_charge', evidence: 'Provider and ledger were reviewed without a completed charge', reviewedAt: '2026-10-11T12:00:00.000Z' };
  const oldV2Review = { ...oldReview, target: { ...target, protocol: 'robokassa-v2' } };
  const reviewed = { version: 1, resolutions: [oldReview, oldV2Review] };
  const resolver = createBillingMigration({ target, sources: [], reviewedRead: () => reviewed });
  await assert.rejects(resolver.resolve('owner', draft), { code: 'billing_migration_unresolved' });
  reviewed.resolutions.push({ ...oldReview, target });
  assert.equal((await resolver.resolve('owner', draft)).reason, 'operator_reviewed');
  await assert.rejects(resolver.resolve('owner', { ...draft, paymentId: 'another-live-payment' }), { code: 'billing_migration_unresolved' });
  const obsoleteTarget = createBillingMigration({ target: oldReview.target, reviewedRead: () => reviewed });
  await assert.rejects(obsoleteTarget.resolve('owner', draft), { code: 'billing_migration_unresolved' });
  await assert.rejects(createBillingMigration({ target: oldV2Review.target, reviewedRead: () => reviewed }).resolve('owner', draft), { code: 'billing_migration_unresolved' });
});

test('private operator decision requires exact owner, draft, target and no-charge evidence', async () => {
  const f = fixture();
  const record = { userId: 'owner', draft: f.draft, target, disposition: 'no_dispatch', evidence: 'Reviewed archived dispatch journal', reviewedAt: '2026-10-11T12:00:00.000Z' };
  const reviewed = { version: 1, resolutions: [record] };
  const resolver = createBillingMigration({ target, sources: [], reviewedRead: () => reviewed });
  assert.equal((await resolver.resolve('owner', f.draft)).reason, 'operator_reviewed');
  await assert.rejects(resolver.resolve('other', f.draft), { code: 'billing_migration_unresolved' });
  await assert.rejects(resolver.resolve('owner', { ...f.draft, paymentId: null }), { code: 'billing_migration_unresolved' });
  record.target = { ...target, merchantLogin: 'other' };
  await assert.rejects(resolver.resolve('owner', f.draft), { code: 'billing_migration_unresolved' });
});

test('HTTP migration resolution requires bearer and protocol and never uses a client-supplied owner', async () => {
  const f = fixture();
  const api = createApi({ store: createMemoryStore(), billing: { catalog: () => ({ ...target, available: false }) }, billingMigration: f.resolver });
  const request = { method: 'POST', url: '/api/billing/migration/resolve', body: JSON.stringify(f.draft), headers: { 'x-slova-billing-protocol': 'robokassa-v3' } };
  assert.equal((await api.handle(request)).status, 401);
  const bootstrap = JSON.parse((await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' })).body);
  request.headers.authorization = `Bearer ${bootstrap.authToken}`;
  assert.equal((await api.handle(request)).status, 409);
  Object.values(f.ledger.attempts)[0].userId = bootstrap.profile.userId;
  Object.values(f.ledger.subscriptions)[0].userId = bootstrap.profile.userId;
  const response = await api.handle(request);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).resolution, 'safe_to_discard');
  assert.equal((await api.handle({ ...request, body: JSON.stringify({ ...f.draft, userId: 'owner' }) })).status, 409);
  assert.equal((await api.handle({ ...request, headers: { authorization: request.headers.authorization } })).status, 409);
  assert.equal((await api.handle({ ...request, headers: { ...request.headers, 'x-slova-billing-protocol': 'robokassa-v1' } })).status, 409);
  assert.equal((await api.handle({ ...request, headers: { ...request.headers, 'x-slova-billing-protocol': 'robokassa-v2' } })).status, 409);
});

test('operator CLI records a reviewed no-charge decision locally once and rejects a paid disposition', () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-migration-'));
  const reviewPath = path.join(directory, 'review.json');
  const recordsPath = path.join(directory, 'records.json');
  try {
    const review = { userId: 'owner', draft: f.draft, target, disposition: 'no_dispatch', evidence: 'Checked complete archived ledger' };
    fs.writeFileSync(reviewPath, JSON.stringify(review));
    assert.deepEqual(approve(reviewPath, recordsPath, { platform: 'win32' }), { recorded: true, duplicate: false });
    assert.deepEqual(approve(reviewPath, recordsPath, { platform: 'win32' }), { recorded: true, duplicate: true });
    assert.equal(JSON.parse(fs.readFileSync(recordsPath, 'utf8')).resolutions.length, 1);
    fs.writeFileSync(reviewPath, JSON.stringify({ ...review, disposition: 'paid_live' }));
    assert.throws(() => approve(reviewPath, recordsPath));
  } finally {
    for (const filename of [reviewPath, recordsPath]) if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('Linux operator destination rejects unreadable, writable, symlinked or wrong-owner targets', () => {
  const directory = { uid: 0, gid: 1234, mode: 0o40750, isDirectory: () => true, isSymbolicLink: () => false };
  const file = { uid: 0, gid: 1234, mode: 0o100640, isFile: () => true, isSymbolicLink: () => false };
  assert.doesNotThrow(() => assertDestinationPolicy(directory, undefined, 1234, 0));
  assert.doesNotThrow(() => assertDestinationPolicy(directory, file, 1234, 0));
  for (const unsafe of [{ gid: 0 }, { uid: 1234 }, { mode: 0o40770 }, { mode: 0o40755 }, { isSymbolicLink: () => true }]) {
    assert.throws(() => assertDestinationPolicy({ ...directory, ...unsafe }, file, 1234, 0));
  }
  for (const unsafe of [{ gid: 0 }, { uid: 1234 }, { mode: 0o100600 }, { mode: 0o100644 }, { mode: 0o100660 }, { isSymbolicLink: () => true }]) {
    assert.throws(() => assertDestinationPolicy(directory, { ...file, ...unsafe }, 1234, 0));
  }
  assert.throws(() => assertDestinationPolicy(directory, file, 1234, 1234));
});

test('Linux atomic record replacement makes the temporary file root:slova 0640 before publishing it', () => {
  const events = [];
  const destination = path.resolve(os.tmpdir(), 'private-slova', 'records.json');
  const directory = path.dirname(destination);
  const disk = {
    lstatSync: (filename) => filename === directory
      ? { uid: 0, gid: 1234, mode: 0o40750, isDirectory: () => true, isSymbolicLink: () => false }
      : { uid: 0, gid: 1234, mode: 0o100640, isFile: () => true, isSymbolicLink: () => false },
    realpathSync: (filename) => filename,
    openSync: (filename, flags, mode) => { events.push(['open', flags, mode]); return filename === directory ? 2 : 1; },
    fchownSync: (fd, uid, gid) => events.push(['owner', fd, uid, gid]),
    fchmodSync: (fd, mode) => events.push(['mode', fd, mode]),
    writeFileSync: () => events.push(['write']), fsyncSync: () => {}, closeSync: () => {},
    renameSync: () => events.push(['publish']), existsSync: () => false,
  };
  protectedWriter(destination, { platform: 'linux', fs: disk, serviceGid: 1234, uid: 0 })({ version: 1, resolutions: [] });
  assert.deepEqual(events.slice(0, 5), [['open', 'wx', 0o600], ['owner', 1, 0, 1234], ['mode', 1, 0o640], ['write'], ['publish']]);
});
