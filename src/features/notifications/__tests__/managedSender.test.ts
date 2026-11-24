import { sendAdmittedNotification } from '../managedSender';
import { parsePushMessage } from '../payload';
import type { RemoteAdmissionPort } from '../managedSender';
jest.mock('@/features/analytics', () => ({ track: jest.fn() }));
const message = parsePushMessage({ messageId: 'campaign-message', data: { route: '/daily', campaign_id: 'daily-reminder-v1' } },
  { nowMs: 1000, versionCode: 33, totalLevels: 1500, currentLevel: 600, unlockedRoutes: ['/daily'] });
const id = '1'.repeat(32);
function port(): RemoteAdmissionPort {
  return { reserve: jest.fn(() => ({ allowed: true, reason: 'accepted', id })), settle: jest.fn(() => true) };
}
test('managed sender first reserves the shared native budget, and accepted is distinct from received/opened', async () => {
  const admission = port(), send = jest.fn(async () => 'accepted' as const);
  expect(await sendAdmittedNotification(message, { send }, admission, { enabled: true, nowMs: 1000 })).toEqual({ result: 'accepted', reason: 'reservation_settled' });
  expect(send).toHaveBeenCalledWith({ messageId: message.id, campaignId: 'daily-reminder-v1', route: '/daily', admissionId: id, expiresAtMs: 121000 });
  expect(admission.settle).toHaveBeenCalledWith(id, true);
});
test('a collision, holdout/disabled or weekly limit never contacts the sender', async () => {
  const admission = port(), send = jest.fn();
  (admission.reserve as jest.Mock).mockReturnValue({ allowed: false, reason: 'weekly_limit' });
  expect(await sendAdmittedNotification(message, { send }, admission, { enabled: true })).toEqual({ result: 'suppressed', reason: 'weekly_limit' });
  expect(send).not.toHaveBeenCalled(); expect(admission.settle).not.toHaveBeenCalled();
});
test('a known rejection releases; unknown/network outcome conservatively consumes and does not retry', async () => {
  const admission = port();
  await sendAdmittedNotification(message, { send: async () => 'rejected' }, admission, { enabled: true });
  expect(admission.settle).toHaveBeenLastCalledWith(id, false);
  const send = jest.fn(async (): Promise<'accepted'> => { throw Error('contains-secret-token'); });
  expect(await sendAdmittedNotification(message, { send }, admission, { enabled: true })).toEqual({ result: 'unknown', reason: 'reservation_settled' });
  expect(admission.settle).toHaveBeenLastCalledWith(id, true); expect(send).toHaveBeenCalledTimes(1);
});
test('the local safe default retains the previous local mode without reserving or sending', async () => {
  const admission = port(), send = jest.fn();
  expect(await sendAdmittedNotification(message, { send }, admission)).toEqual({ result: 'suppressed', reason: 'disabled' });
  expect(admission.reserve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
