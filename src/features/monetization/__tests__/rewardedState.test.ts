import { rewardedFailureReason, rewardedStateMessage } from '../rewardedState';

test('classifies explicit SDK network/no-fill evidence without guessing mediation numeric codes', () => {
  expect(rewardedFailureReason(new Error('{"code":1,"description":"No fill."}'))).toBe('no_fill');
  expect(rewardedFailureReason(new Error('{"code":2,"description":"Network error"}'))).toBe('network_error');
  expect(rewardedFailureReason({ code: 2 })).toBe('load_error');
  expect(rewardedFailureReason({ description: 'Network error', code: '2' }, 'show_error')).toBe('network_error');
  expect(rewardedFailureReason({ description: 'No fill.', code: '1' }, 'show_error')).toBe('no_fill');
  expect(rewardedFailureReason(new Error('internal error'), 'show_error')).toBe('show_error');
  expect(rewardedFailureReason(null)).toBe('load_error');
});

test.each(['loading', 'not_ready', 'no_fill', 'fullscreen_busy', 'background', 'load_error',
  'show_error', 'save_failed', 'offer_save_failed', 'reward_check_failed', 'daily_limit', 'cancelled', 'pending'] as const)('%s does not blame connectivity', (state) => {
  expect(rewardedStateMessage(state)).not.toContain('Проверьте подключение');
});

test('unknown journal check and unearned offer preparation do not promise an earned entitlement', () => {
  for (const state of ['reward_check_failed', 'offer_save_failed'] as const) {
    expect(rewardedStateMessage(state)).not.toContain('повторный просмотр не нужен');
    expect(rewardedStateMessage(state)).not.toContain('Выдача ожидает');
  }
});

test('only confirmed network failure requests checking connectivity', () => {
  expect(rewardedStateMessage('network_error')).toContain('Проверьте подключение');
});
