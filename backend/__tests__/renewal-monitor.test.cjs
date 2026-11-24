const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenewalMonitor } = require('../runtime/renewal-monitor.cjs');

function fixture() {
  const lines = [];
  let calls = 0;
  const result = { attempted: 0, reconciled: 0, failures: 1, blockedNotices: 0 };
  const diagnostics = { pendingPayments: 0, failedPayments: 0, manualReconciliationPayments: 0,
    overdueSubscriptions: 0, invalidEmails: 0, notices: { pending: 0, failed: 0, quarantined: 0 } };
  const billing = { catalog: () => ({ available: true }),
    runRenewals: async () => { calls++; return result; }, diagnostics: () => diagnostics };
  return { billing, result, diagnostics, lines, calls: () => calls,
    tick: createRenewalMonitor({ billing, warn: (line) => lines.push(line) }) };
}

test('returned renewal failures are logged once per changed summary and recovery is visible', async () => {
  const f = fixture();
  await f.tick();
  await f.tick();
  assert.equal(f.lines.length, 1);
  assert.match(f.lines[0], /"failures":1/);
  f.result.failures = 0;
  await f.tick();
  assert.equal(f.lines.length, 2);
  assert.match(f.lines[1], /"failures":0/);
});

test('paused sales still surface quarantined notices without calling the payment provider', async () => {
  const f = fixture();
  f.billing.catalog = () => ({ available: false });
  f.diagnostics.notices.quarantined = 1;
  await f.tick();
  assert.equal(f.calls(), 0);
  assert.match(f.lines[0], /"quarantined":1/);
});

test('fresh pending checkout stays quiet but stale pending checkout is reported once, even with paused sales', async () => {
  const f = fixture();
  f.billing.catalog = () => ({ available: false });
  f.diagnostics.pendingPayments = 1;
  f.diagnostics.stalePendingPayments = 0;
  await f.tick();
  assert.equal(f.lines.length, 0);
  f.diagnostics.stalePendingPayments = 1;
  await f.tick();
  await f.tick();
  assert.equal(f.calls(), 0);
  assert.equal(f.lines.length, 1);
  assert.match(f.lines[0], /"stalePendingPayments":1/);
});

test('unknown errors and unexpected diagnostic fields cannot leak private values into logs', async () => {
  const f = fixture();
  f.result.email = 'player@example.com';
  f.diagnostics.secret = 'private-secret';
  f.diagnostics.notices.private = 'saved-method';
  await f.tick();
  f.billing.runRenewals = async () => { throw new Error('private-secret player@example.com'); };
  await f.tick();
  assert.equal(f.lines.length, 2);
  assert.match(f.lines[1], /"reconciliationUnavailable":true/);
  assert.doesNotMatch(f.lines.join(''), /player@example|private-secret|saved-method/);
});

test('an unreadable ledger is reported without preventing later ticks', async () => {
  const f = fixture();
  const diagnostics = f.billing.diagnostics;
  f.billing.diagnostics = () => { throw new Error('private filesystem path'); };
  await f.tick();
  assert.match(f.lines[0], /"diagnosticsUnavailable":true/);
  assert.doesNotMatch(f.lines[0], /filesystem/);
  f.billing.diagnostics = diagnostics;
  await f.tick();
  assert.equal(f.lines.length, 2);
});

test('manual NPD receipt work stays visible with paused sales and recovery is logged without receipt details', async () => {
  const f = fixture();
  f.result.failures = 0;
  f.billing.catalog = () => ({ available: false });
  f.diagnostics.manualReceiptCorrections = 1;
  f.diagnostics.receiptReference = 'private-receipt-reference';
  await f.tick();
  await f.tick();
  assert.equal(f.calls(), 0);
  assert.equal(f.lines.length, 1);
  assert.match(f.lines[0], /"manualReceiptCorrections":1/);
  assert.doesNotMatch(f.lines[0], /private-receipt-reference/);
  f.diagnostics.manualReceiptCorrections = 0;
  await f.tick();
  assert.equal(f.lines.length, 2);
  assert.match(f.lines[1], /"manualReceiptCorrections":0/);
});
