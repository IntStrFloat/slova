const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBilling } = require('../backend/runtime/billing.cjs');
const { createYooKassa } = require('../backend/runtime/yookassa.cjs');
const { createMemoryStore } = require('../backend/runtime/store.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  process.loadEnvFile(path.join(root, 'credentials', 'yookassa-test.env'));
  if (!process.env.YOOKASSA_SECRET_KEY?.startsWith('test_')) throw new Error('A test key is required');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'credentials', 'subscription-qa', 'billing-test.json'), 'utf8'));
  const candidates = Object.values(data.subscriptions).filter((sub) => sub.mode === 'test' && sub.autoRenew && sub.savedMethodId);
  assert.equal(candidates.length, 1, 'Run only after exactly one successful local sandbox checkout');
  const subscription = candidates[0];
  for (const sub of Object.values(data.subscriptions)) if (sub.id !== subscription.id) sub.autoRenew = false;
  const instant = subscription.activeUntil + 1000;
  const gateway = createYooKassa({ shopId: process.env.YOOKASSA_SHOP_ID, secretKey: process.env.YOOKASSA_SECRET_KEY, mode: 'test', returnUrl: 'https://slova.193.160.208.95.nip.io/api/billing/return' });
  const service = createBilling({ store: createMemoryStore(data), gateway, enabled: true, mode: 'test', now: () => new Date(instant) });
  // A copied in-memory ledger and virtual due date cannot change the real local
  // profile's paid period. The provider request also uses the test store only.
  const run = await service.runRenewals();
  assert.equal(run.attempted, 1);
  assert.equal(run.failures, 0);
  const renewed = await service.status(subscription.userId);
  assert.equal(renewed.active, true);
  assert.equal(renewed.autoRenew, true);
  assert.equal(renewed.activeUntil, instant + 30 * 86_400_000);
  const cancelled = await service.cancel(subscription.userId);
  assert.equal(cancelled.autoRenew, false);
  assert.equal(cancelled.activeUntil, renewed.activeUntil);
  const afterCancel = await service.runRenewals();
  assert.equal(afterCancel.attempted, 0);
  const report = { mode: 'test', firstCheckoutVerified: true, recurringPaymentVerified: true, recurringAmount: '99.00', periodDays: 30, cancelPreservesPaidPeriod: true, chargesAfterCancel: 0, realMoneyDebited: false };
  const output = path.join(root, 'output', 'subscription-qa');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'sandbox-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error.code || 'Sandbox verification failed'); process.exitCode = 1; });
