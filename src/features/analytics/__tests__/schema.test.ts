import { EVENT_CONTRACTS, sanitizeProperties, validateEventProperties } from '../schema';

test.each(['not_in_dictionary', 'not_constructible', 'manual_deny', 'wrong_order'])('word reason %s survives schema3 without word text', (reason) => {
  expect(validateEventProperties('word_submit_outcome', { kind: reason === 'wrong_order' ? 'constraint' : 'invalid',
    reason, raw_word: 'секрет', len: 5 })).toMatchObject({
    valid: true, rejected: 1, properties: { reason, len: 5 },
  });
});

test('word reason is an enum rather than an arbitrary text channel', () => {
  expect(validateEventProperties('word_submit_outcome', { reason: 'secret_word' })).toMatchObject({ properties: {}, rejected: 1 });
});

test('help eligibility retains explicit availability and frozen completion history without inferring unknown history', () => {
  const request = { interaction_id: 'tap1', hint_type: 'letter', is_available: true, previously_completed: false };
  expect(validateEventProperties('hint_requested', request))
    .toEqual({ properties: request, valid: true, rejected: 0, missing: [] });
  expect(validateEventProperties('hint_rejected', { ...request, reason: 'insufficient_coins' }))
    .toMatchObject({ valid: true, rejected: 0, properties: { ...request, reason: 'insufficient_coins' } });
  expect(validateEventProperties('hint_requested', { interaction_id: 'tap1', hint_type: 'letter' }).properties)
    .not.toHaveProperty('previously_completed');
  expect(validateEventProperties('hint_requested', { ...request, previously_completed: 'false' }))
    .toMatchObject({ valid: true, rejected: 1, properties: { is_available: true } });
});

test.each(['constructor', 'toString', '__proto__'])('inherited object key %s is not an event contract', (event) => {
  expect(validateEventProperties(event, { reason: 'unknown' }))
    .toEqual({ properties: {}, valid: false, rejected: 1, missing: [] });
});

test('attempt metadata is typed and cannot bloat or expose the manual word outcome', () => {
  const fields = { difficulty_tier: 4, difficulty_role: 'hard', mechanic: 'ordered', letter_count: 6, target_count: 4 };
  expect(validateEventProperties('puzzle_started', fields)).toMatchObject({ valid: true, properties: fields, rejected: 0 });
  expect(validateEventProperties('puzzle_resumed', fields)).toMatchObject({ valid: true, properties: fields, rejected: 0 });
  expect(validateEventProperties('word_submit_outcome', { ...fields, kind: 'invalid', reason: 'not_in_dictionary' }))
    .toMatchObject({ valid: true, properties: { kind: 'invalid', reason: 'not_in_dictionary' }, rejected: 5 });
  expect(validateEventProperties('puzzle_started', { difficulty_tier: 'hard', letter_count: 'six' }))
    .toMatchObject({ properties: {}, rejected: 2 });
});

const fixtures: [string, Record<string, unknown>][] = [
  ['app_ready', { launch_id: 'launch1', startup_ms: 12, launch_kind: 'cold', screen: 'home', restore_result: 'ready' }],
  ['screen_viewed', { screen: 'game', screen_visit_id: 'v1', previous_screen: 'home', entry_source: 'direct' }],
  ['ui_action', { interaction_id: 'tap1', screen: 'home', element_id: 'continue', action: 'press', outcome: 'accepted' }],
  ['gameplay_session_summary', { analytics_session_id: 's1', revision: 1, gameplay_visible_ms: 1000, idle_adjusted_ms: 500, idle_threshold_ms: 60000, ad_ms: 0, screen_ms: 1, last_action: 'word_submitted', reason: 'background' }],
  ['puzzle_paused', { attemptId: 'a1', pause_id: 'p1', reason: 'background', revision: 1, errors: 0, found: 1, target: 2, hints_count: 0 }],
  ['puzzle_exited', { attemptId: 'a1', exit_id: 'x1', exit_reason: 'home', revision: 2, errors: 1, found: 1, target: 2, last_outcome: 'invalid' }],
  ['puzzle_checkpoint', { attemptId: 'a1', revision: 3, reason: 'timer', activeTimeMs: 1000, time_coverage: 'full_attempt' }],
  ['puzzle_blocked', { operation_id: 'op1', reason: 'content_unavailable', retryable: true }],
  ['campaign_completed', { catalog_version: 'catalog1', completed_count: 1500, last_level_id: 1500 }],
  ['hint_requested', { interaction_id: 'tap2', hint_type: 'semantic', displayed_cost: 30, already_owned: false }],
  ['hint_rejected', { interaction_id: 'tap2', hint_type: 'semantic', reason: 'insufficient' }],
  ['no_coins_shown', { modal_id: 'modal1', screen: 'game', requested_hint: 'semantic', cost: 30, balance: 0, available_actions: 'rewarded_wheel_close' }],
  ['no_coins_action', { modal_id: 'modal1', interaction_id: 'tap3', action: 'rewarded', outcome: 'accepted' }],
  ['wallet_transaction', { transaction_id: 'tx1', currency: 'coins', delta: -30, balance_before: 60, balance_after: 30, sink: 'hint' }],
  ['wallet_transaction_failed', { operation_id: 'op2', attempt_no: 1, reason: 'storage', intended_delta: -30 }],
  ['reward_grant_failed', { rewardId: 'r1', attempt_no: 1, reason: 'storage', pending_age_ms: 10 }],
  ['wheel_opened', { screen_visit_id: 'v2', free_available: true, rewarded_remaining: 5, pending_spin: false }],
  ['wheel_spin_started', { spin_id: 'spin1', free_or_rewarded: 'free', free_remaining: 0 }],
  ['wheel_spin_result', { spin_id: 'spin1', result_revision: 1, outcome_type: 'coins', amount: 50, grant_state: 'pending' }],
  ['feature_eligible', { feature: 'daily', eligibility_version: 'v1', progress: 5 }],
  ['weekly_period_started', { periodId: 'week1', anchor_day: '2026-11-01', end_day: '2026-11-08' }],
  ['marathon_progressed', { eventInstanceId: 'event1', contribution_id: 'c1', points_delta: 1, progress: 3 }],
  ['marathon_milestone_reached', { eventInstanceId: 'event1', milestone_id: 'm1', threshold: 3 }],
  ['marathon_reward_granted', { eventInstanceId: 'event1', rewardId: 'r2', milestone_id: 'm1', amount: 10 }],
  ['marathon_finished', { eventInstanceId: 'event1', result: 'expired', final_status_revision: 1, final_progress: 3, max_progress: 21 }],
  ['ad_lifecycle', { opportunity_id: 'o1', request_id: 'ar1', callback_id: 'ar1:reward:1', format: 'rewarded', placement: 'coins', stage: 'reward', result: 'rewarded', error_code: 1 }],
  ['subscription_server_event', { server_event_id: 'sv1', event_type: 'paid', amount_minor: 9900, currency: 'rub', binding_state: 'unlinked' }],
  ['subscription_manage_action', { operation_id: 'op3', action: 'restore', stage: 'result', result: 'failed', normalized_reason: 'network', mode: 'live' }],
  ['subscription_entitlement_changed', { entitlement_revision: 'ent1', old_status: 'inactive', new_status: 'active', policy_version: 'server_verified_v1' }],
  ['profile_action', { operation_id: 'op4', action: 'create', result: 'created', latency_ms: 12 }],
  ['practice_lifecycle', { practice_id: 'pr1', stage: 'start', assistance: false }],
  ['notification_route_result', { open_id: 'open1', prompt_id_or_campaign_id: 'p1', provider: 'local', destination: 'daily', result: 'opened' }],
  ['push_lifecycle', { message_id_hash: 'msg1', stage: 'opened', provider: 'rustore' }],
  ['technical_operation', { stage: 'summary', operation: 'game_save', summary_id: 'save1', revision: 2, attempts: 3, successes: 2, failures: 1 }],
  ['experiment_assigned', { experiment_id: 'exp1', assignment_id: 'asg1', variant: 'control', allocation_version: 1, unit_type: 'sdk_install' }],
  ['experiment_exposed', { experiment_id: 'exp1', assignment_id: 'asg1', variant: 'control', exposure_point: 'home_card', exposure_version: 1 }],
  ['analytics_health_summary', { window_id: 's1', queue_dropped: 0, schema_rejected: 1, handoff_failures: 0, oldest_pending_ms: 0 }],
];

test.each(fixtures)('%s preserves the reviewed complete payload', (event, input) => {
  const result = validateEventProperties(event, input);
  expect(result).toEqual({ properties: input, valid: true, rejected: 0, missing: [] });
});
test('the proposed 37 new event names are distinct and registered', () => {
  expect(new Set(fixtures.map(([event]) => event)).size).toBe(37);
  for (const [event] of fixtures) expect(EVENT_CONTRACTS[event]).toBeDefined();
});

test('observes opening wallet stock without fabricating a credit transaction', () => {
  const input = { balance: 60, currency: 'coins', source: 'bootstrap', window_id: 'balance_epoch1' };
  expect(validateEventProperties('wallet_balance_observed', input))
    .toEqual({ properties: input, valid: true, rejected: 0, missing: [] });
  expect(validateEventProperties('wallet_balance_observed', { balance: 60 }).valid).toBe(false);
});
test('optional undefined fields are absent rather than corrupt, while required missing fields fail validation', () => {
  expect(validateEventProperties('practice_lifecycle', { practice_id: 'p1', stage: 'start', step_id: undefined }))
    .toEqual({ properties: { practice_id: 'p1', stage: 'start' }, valid: true, rejected: 0, missing: [] });
  expect(validateEventProperties('puzzle_paused', { attemptId: 'a1', pause_id: 'p1' }).missing).toEqual(['reason']);
});

test('health reports bounded transport losses without accepting retry state or raw errors', () => {
  const result = validateEventProperties('analytics_health_summary', {
    window_id: 's1', queue_expired: 2, handoff_exhausted: 1, handoffAttempts: 8, raw_error: 'secret',
  });
  expect(result).toEqual({ properties: { window_id: 's1', queue_expired: 2, handoff_exhausted: 1 }, valid: true, rejected: 2, missing: [] });
});
test('accepts both generations of world ID and refuses unsafe values and free text', () => {
  expect(sanitizeProperties({ world: 1, assistance: true })).toEqual({ world: 1, assistance: true });
  expect(sanitizeProperties({ world: 'paris' })).toEqual({ world: 'paris' });
  expect(sanitizeProperties({ amount: Infinity, balance: -1, rawInput: 'cat', reason: 'me@example.com',
    delta: -30, occurred_at: '2026-11-01T12:00:00+03:00' })).toEqual({ delta: -30, occurred_at: '2026-11-01T12:00:00+03:00' });
});

