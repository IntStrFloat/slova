import { ECONOMY } from '@/core/config/economy';
import { storage } from '@/core/storage';
import { trackOnce } from '@/features/analytics';
import { validateEventProperties } from '@/features/analytics/schema';
import { useWheel } from '../index';

jest.mock('@/features/analytics', () => ({ trackOnce: jest.fn(() => 'e_wheel') }));
const track = jest.mocked(trackOnce);
const origin = { origin_interaction_id: 'origin1', interaction_id: 'tap1', modal_id: 'modal1',
  attemptId: 'attempt1', levelKey: 'campaign:6', levelId: 6, mode: 'campaign',
  requested_hint: 'letter', displayed_cost: 50, balance: 20, entry_source: 'no_coins', raw_word: 'PRIVATE_WORD' };

beforeEach(() => { storage.clearAll(); useWheel.getState().reset(); track.mockClear(); });

test.each([false, true])('spin viaRewarded=%s carries one frozen origin across pending/granted revisions', (rewarded) => {
  const context = { ...origin };
  const observation = rewarded ? { opportunityId: 'ao1', requestId: 'ar1' } : undefined;
  if (rewarded) {
    const receipt = useWheel.getState().prepareRewarded(context)!;
    expect(useWheel.getState().confirmRewarded(receipt, observation, Date.now())).toBe(true);
  } else useWheel.getState().spin(false, undefined, context);
  const spin = useWheel.getState().pendingSpin!;
  context.interaction_id = 'changed_tap'; context.balance = 999;
  expect(useWheel.getState().claimPending(spin.effectId)).toBe(true);
  expect(useWheel.getState().claimPending(spin.effectId)).toBe(false);
  const events = track.mock.calls.map(([event, key, properties]) => ({ event, key, properties }));
  expect(events.map(({ event }) => event)).toEqual(['wheel_spin_started', 'wheel_spin_result', 'wheel_spin_result']);
  const results = events.filter(({ event }) => event === 'wheel_spin_result');
  expect(results.map(({ properties }) => properties?.result_revision)).toEqual([1, 2]);
  expect(results.map(({ properties }) => properties?.grant_state)).toEqual(['pending', 'granted']);
  for (const { event, properties } of events) {
    expect(properties).toMatchObject({ origin_interaction_id: 'origin1', interaction_id: 'tap1', modal_id: 'modal1',
      attemptId: 'attempt1', requested_hint: 'letter', displayed_cost: 50, balance: 20,
      spin_id: spin.effectId, free_or_rewarded: rewarded ? 'rewarded' : 'free' });
    if (rewarded) expect(properties).toMatchObject({ opportunity_id: 'ao1', request_id: 'ar1' });
    expect(validateEventProperties(event, properties)).toMatchObject({ valid: true, rejected: 0 });
  }
  for (const { properties } of results) expect(properties).toMatchObject({ rewardId: spin.effectId, amount: spin.value });
  expect(ECONOMY.wheel.sectors).toContain(spin.value);
  expect(JSON.stringify(events)).not.toContain('PRIVATE_WORD');
});
