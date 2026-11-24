/** Analytics v3 contracts. IDs/categories are bounded; free text and gesture paths are never accepted. */
export type AnalyticsValue = string | number | boolean;
type Contract = { fields: readonly string[]; required?: readonly string[] };
const numeric = new Set(`answerIndex activeDays activeTimeMs amount balance cost day durationSec errors found hintsUsed len openedCells progress remaining reward startupMs streak target visibleTimeMs world periodDays occurredAtMs createdAtMs fireAtMs observedAtMs revision gameplay_visible_ms idle_adjusted_ms idle_threshold_ms ad_ms screen_ms startup_ms last_success_elapsed_ms hints_count displayed_cost charged_amount balance_before balance_after attempt_no retry_no pending_age_ms free_remaining rewarded_remaining result_revision points threshold latency_ms amount_minor attempts successes failures queue_dropped schema_rejected oldest_pending_ms handoff_failures durable_write_failures queue_size visibility_ms visible_fraction completed_count last_level_id max_progress final_progress allocation_version exposure_version elapsed_ms schema_version`.split(/\s+/));
const signed = new Set(['delta', 'intended_delta', 'points_delta']);
const booleans = new Set(`active daily enabled firstTime hasHelp isResume manual rewarded assisted solved claimable retryable already_owned pending_spin free_available recovery timeKnown is_test granted success has_pending background bonus_reward_eligible`.split(/\s+/));
const categories = new Set(`action autoOrManual entrySource format inputType kind mode paidWith placement reason result screen setting source trigger type assistanceType completionSource entryKind stage status summary_scope last_action launch_kind restore_result previous_screen entry_source element_id outcome blocked_reason exit_reason last_outcome restore_state hint_type requested_hint currency sink free_or_rewarded outcome_type grant_state feature terminal_result event_type environment binding_state old_status new_status normalized_reason operation normalized_code provider destination unit_type exposure_point variant selected_state launch_source producer policy_result close_reason permission source_kind summary_kind scope`.split(/\s+/));
const identifiers = new Set(`actionDay collectibleId completionId contentVersion dateKey eventInstanceId id levelId levelKey onboardingVersion policyRevision promptId periodId puzzleInstanceId rewardId templateId variantId attemptId content_fingerprint route_id pause_id exit_id operation_id interaction_id practice_id step_id assistance catalog_version launch_id screen_visit_id modal_id transaction_id spin_id eligibility_version anchor_day end_day contribution_id milestone_id opportunity_id request_id callback_id impression_id impression_id_if_available server_event_id pseudonymous_payment_key product_id entitlement_revision policy_version prompt_id_or_campaign_id prompt_id campaign_id open_id message_id_hash experiment_id assignment_id window_id summary_id analytics_session_id content_version config_version onboarding_version payload_version reason_id reward_id submission_id landmarkId checkout_id offer_id`.split(/\s+/));
const times = new Set(['occurred_at', 'observed_at', 'effective_at']);
// World IDs are numeric in legacy payloads and stable strings in newer content. Practice assistance is a boolean.
numeric.delete('world'); identifiers.add('world'); booleans.add('assistance');
numeric.add('error_code'); numeric.add('final_status_revision'); categories.add('time_coverage'); categories.add('visibility_rule');
numeric.add('queue_expired'); numeric.add('handoff_exhausted');
for (const field of ['missing_required', 'dropped_properties', 'dedupe_hits']) numeric.add(field);
numeric.add('config_schema_version');
booleans.add('fallback_used'); categories.add('age_bucket');
categories.add('exposure_window');
categories.add('rewarded_state'); numeric.add('wait_ms');
categories.add('channel');
identifiers.add('origin_interaction_id');
for (const field of ['difficulty_tier', 'letter_count', 'target_count']) numeric.add(field);
for (const field of ['difficulty_role', 'mechanic']) categories.add(field);
booleans.add('is_available');
booleans.add('previously_completed');
booleans.add('first_eligible_request'); identifiers.add('eligibility_epoch'); categories.add('measurement_phase');
identifiers.add('trial_plan_fingerprint');
for (const field of ['ready_at_entry', 'rewarded_eligible', 'left_before_ready']) booleans.add(field);
const identity = `attemptId levelId levelKey mode world screen contentVersion content_fingerprint route_id completionId onboardingVersion policyRevision variantId dateKey actionDay eventInstanceId periodId puzzleInstanceId occurredAtMs createdAtMs observedAtMs occurred_at observed_at recovery timeKnown time_coverage previously_completed`.split(/\s+/);
const contracts: Record<string, Contract> = {};
function register(names: string, fields: string, required?: string): void {
  const contract = { fields: [...identity, ...fields.split(/\s+/).filter(Boolean)], required: required?.split(/\s+/).filter(Boolean) };
  for (const name of names.split(/\s+/).filter(Boolean)) contracts[name] = contract;
}
register('app_open session_start game_session_start first_open', 'source screen launch_source');
register('onboarding_assigned onboarding_field_ready tutorial_prompt_shown tutorial_prompt_dismissed onboarding_step onboarding_done', 'source screen stage promptId step_id startupMs activeTimeMs result manual assistanceType assistance');
register('puzzle_started puzzle_resumed puzzle_completed level_start level_complete level_completed level_reward_claimed first_level_completed fifth_level_completed independent_level_completed intro_completed intro_milestone_completed level_abandon', 'entrySource isResume firstTime completionSource assisted assistanceType activeTimeMs durationSec hintsUsed found target errors reward hasHelp source reason progress openedCells hints_count difficulty_tier difficulty_role mechanic letter_count target_count');
register('gameplay_action word_submit_outcome target_word_accepted first_target_word_accepted word_found wrong_word word_submitted', 'action result kind len answerIndex manual inputType assistanceType found errors target reward rewardId source firstTime outcome submission_id bonus_reward_eligible activeTimeMs remaining reason');
register('help_offer_shown help_used help_progressed hint_used semantic_clue_opened shuffle_used', 'type trigger source assistanceType autoOrManual len inputType answerIndex openedCells cost paidWith hintsUsed manual result reason activeTimeMs interaction_id origin_interaction_id modal_id hint_type requested_hint displayed_cost balance already_owned charged_amount transaction_id balance_before balance_after entry_source found errors progress target');
register('home_viewed home_primary_action home_secondary_action', 'action source entrySource screen levelId claimable active remaining found target');
register('daily_entry_seen daily_entry_clicked daily_menu_viewed daily_entered daily_eligible daily_started daily_completed daily_repeat_completed daily_carry_replaced daily_album_action', 'entryKind entrySource source action firstTime active claimable progress streak target result reason templateId');
register('daily_bonus_seen daily_bonus_claimed daily_claim wheel_spin streak_break', 'day streak claimable amount reward balance source rewardId result active');
register('weekly_day_qualified weekly_milestone_granted weekly_period_closed quest_created quest_completed quest_set_completed event_eligible event_progressed event_milestone_granted event_finished collectible_unlocked album_completed', 'templateId collectibleId id kind source target progress activeDays reward amount result reason anchor_day end_day eligibility_version threshold rewardId status completionSource');
register('quest_screen_viewed quest_action_selected event_screen_viewed event_action_selected feature_exposed', 'action source screen feature kind target progress remaining claimable active stage status screen_visit_id visibility_ms visible_fraction visibility_rule eligibility_version origin_interaction_id interaction_id modal_id element_id requested_hint displayed_cost balance entry_source is_available rewarded_state blocked_reason free_or_rewarded free_available rewarded_remaining');
register('album_help_seen album_opened collection_opened collectible_opened route_card_opened cover_selected reward_presentation_seen', 'id collectibleId landmarkId kind world source action target progress rewardId selected_state');
register('coins_earned coins_spent currency_change reward_granted', 'amount balance source sink kind currency delta cost rewardId transaction_id result reason type firstTime origin_interaction_id interaction_id modal_id requested_hint displayed_cost entry_source');
register('interstitial_eligible interstitial_skipped interstitial_shown rewarded_requested rewarded_completed ad_failed ad_impression ad_click ad_reward', 'format placement reason result source reward amount visibleTimeMs activeTimeMs opportunity_id request_id stage latency_ms is_test');
register('marathon_entry_clicked marathon_screen_viewed marathon_play_clicked', 'source status progress target active result screen action');
register('notification_opt_in_clicked notification_permission_result notification_soft_ask_result reminder_scheduled reminder_delivered reminder_opened reminder_gameplay reminder_consent', 'promptId source result reason enabled fireAtMs trigger stage action provider destination permission active');
register('setting_changed review_flow_finished save_failed', 'setting enabled result reason source stage type operation operation_id retryable attempt_no active');
register('review_eligibility review_prepare_result review_launch_attempt',
  'result reason source stage operation_id attempt_no completed_count', 'result reason');
// Existing offline v3 completion events had no required reason; retain that contract.
register('review_flow_finished', 'result reason source stage operation_id attempt_no completed_count');
for (const field of ['installed_version_code', 'previous_version_code', 'target_version_code']) identifiers.add(field);
register('update_check_result update_flow_result update_download_state update_version_observed',
  'result reason source stage operation_id attempt_no error_code installed_version_code previous_version_code target_version_code');
register('leaderboard_view event_join team_join iap_view iap_purchase', 'id source kind scope product_id amount currency result');
register(`subscription_offer_shown subscription_offer_clicked subscription_offer_dismissed subscription_shop_viewed subscription_form_opened subscription_checkout_started subscription_invoice_created subscription_browser_opened subscription_payment_pending subscription_payment_confirmed subscription_payment_failed subscription_payment_canceled subscription_error`, 'source mode stage reason trigger result amount periodDays product_id checkout_id offer_id operation_id interaction_id');
register('app_ready', 'launch_id launch_kind startup_ms screen restore_result', 'launch_id');
register('screen_viewed', 'screen previous_screen screen_visit_id entry_source', 'screen screen_visit_id');
register('ui_action', 'interaction_id origin_interaction_id modal_id screen screen_visit_id element_id action outcome blocked_reason rewarded_state ready_at_entry rewarded_eligible left_before_ready wait_ms requested_hint displayed_cost balance entry_source', 'interaction_id screen element_id action');
register('gameplay_session_summary', 'analytics_session_id summary_scope revision gameplay_visible_ms idle_adjusted_ms idle_threshold_ms ad_ms screen_ms last_action reason', 'revision');
register('puzzle_paused', 'pause_id revision reason found target errors hints_count activeTimeMs last_success_elapsed_ms', 'attemptId pause_id reason');
register('puzzle_exited', 'exit_id revision exit_reason reason found target errors hints_count activeTimeMs last_success_elapsed_ms last_outcome', 'attemptId exit_id exit_reason');
register('puzzle_checkpoint', 'revision found target errors hints_count activeTimeMs last_success_elapsed_ms reason', 'attemptId revision');
register('puzzle_blocked', 'operation_id reason retryable restore_state', 'operation_id reason');
register('campaign_completed', 'catalog_version last_level_id completed_count content_version', 'catalog_version');
register('hint_requested', 'interaction_id origin_interaction_id modal_id hint_type requested_hint displayed_cost balance entry_source already_owned is_available rewarded_state rewarded_eligible first_eligible_request eligibility_version measurement_phase eligibility_epoch trial_plan_fingerprint', 'interaction_id hint_type');
register('hint_rejected', 'interaction_id origin_interaction_id modal_id hint_type requested_hint reason balance cost displayed_cost entry_source already_owned is_available rewarded_state rewarded_eligible first_eligible_request eligibility_version measurement_phase eligibility_epoch trial_plan_fingerprint', 'interaction_id hint_type reason');
register('no_coins_shown', 'modal_id origin_interaction_id interaction_id screen requested_hint cost displayed_cost balance entry_source available_actions rewarded_state ready_at_entry rewarded_eligible blocked_reason', 'modal_id screen');
register('no_coins_action', 'interaction_id origin_interaction_id modal_id action outcome available_actions screen requested_hint cost displayed_cost balance entry_source rewarded_state blocked_reason', 'interaction_id modal_id action');
register('wallet_transaction', 'transaction_id currency delta balance_before balance_after source sink rewardId origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'transaction_id currency delta balance_before balance_after');
register('wallet_balance_observed', 'balance currency source window_id', 'balance currency window_id');
register('wallet_transaction_failed', 'operation_id attempt_no intended_delta currency source sink reason retryable origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'operation_id attempt_no reason');
register('reward_grant_failed', 'rewardId operation_id attempt_no source reason normalized_reason retryable pending_age_ms origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'rewardId attempt_no reason');
register('wheel_opened', 'screen_visit_id free_available rewarded_remaining pending_spin rewarded_state blocked_reason ready_at_entry rewarded_eligible origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'screen_visit_id');
register('wheel_spin_started', 'spin_id free_or_rewarded free_remaining rewarded_remaining opportunity_id request_id origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'spin_id free_or_rewarded');
register('wheel_spin_result', 'spin_id result_revision outcome_type amount rewardId grant_state transaction_id free_or_rewarded opportunity_id request_id origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'spin_id result_revision outcome_type');
register('feature_eligible', 'feature eligibility_version progress', 'feature eligibility_version');
register('weekly_period_started', 'anchor_day end_day eligibility_version', 'periodId anchor_day end_day');
register('marathon_progressed', 'contribution_id points_delta progress', 'eventInstanceId contribution_id');
register('marathon_milestone_reached', 'milestone_id progress threshold', 'eventInstanceId milestone_id');
register('marathon_reward_granted', 'milestone_id rewardId amount', 'eventInstanceId rewardId');
register('marathon_finished', 'result final_progress max_progress final_status_revision', 'eventInstanceId result');
register('ad_lifecycle', 'opportunity_id request_id callback_id impression_id impression_id_if_available format placement stage operation operation_id outcome reason result normalized_reason blocked_reason latency_ms error_code is_test rewardId transaction_id origin_interaction_id interaction_id modal_id requested_hint displayed_cost balance entry_source', 'opportunity_id format placement stage');
register('subscription_server_event', 'server_event_id pseudonymous_payment_key event_type amount_minor currency environment product_id effective_at binding_state', 'server_event_id event_type');
register('subscription_manage_action', 'operation_id action stage result normalized_reason trigger source mode', 'operation_id action stage');
register('subscription_entitlement_changed', 'entitlement_revision old_status new_status source policy_version', 'entitlement_revision old_status new_status');
register('profile_action', 'operation_id action result reason latency_ms', 'operation_id action result');
register('practice_lifecycle', 'practice_id stage step_id activeTimeMs assistance', 'practice_id stage');
register('notification_route_result', 'open_id prompt_id_or_campaign_id prompt_id campaign_id provider destination result reason launch_kind', 'open_id provider destination result');
register('push_lifecycle', 'message_id_hash campaign_id stage provider binding_state', 'message_id_hash stage provider');
register('notification_permission_result', 'provider result reason', 'provider result');
register('push_registration_result', 'provider result reason operation', 'provider result operation');
register('notification_meaningful_return', 'message_id_hash campaign_id provider channel action', 'message_id_hash provider channel action');
register('notification_admission_result', 'provider channel result reason', 'provider channel result reason');
register('technical_operation', 'stage operation operation_id attempt_no result normalized_code latency_ms recovery summary_id analytics_session_id revision attempts successes failures', 'stage operation');
register('experiment_assigned', 'experiment_id assignment_id variant allocation_version unit_type eligibility_version measurement_phase eligibility_epoch origin_interaction_id trial_plan_fingerprint', 'experiment_id assignment_id variant');
register('experiment_exposed', 'experiment_id assignment_id variant allocation_version exposure_point exposure_version config_version exposure_window eligibility_version measurement_phase eligibility_epoch origin_interaction_id interaction_id screen_visit_id trial_plan_fingerprint', 'experiment_id assignment_id variant exposure_point');
register('config_fetch_result config_apply_result', 'result reason config_schema_version config_version fallback_used age_bucket', 'result reason config_schema_version fallback_used');
register('analytics_health_summary', 'window_id queue_dropped queue_expired handoff_exhausted schema_rejected missing_required dropped_properties dedupe_hits oldest_pending_ms handoff_failures durable_write_failures queue_size schema_version', 'window_id');

export const EVENT_CONTRACTS: Readonly<Record<string, Contract>> = contracts;
export const ANALYTICS_SCHEMA_VERSION = 3;
export function safeAnalyticsId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(value);
}
export function safeEventName(value: string): boolean { return /^[a-z][a-z0-9_]{0,63}$/.test(value); }
function safeValue(key: string, value: unknown): value is AnalyticsValue {
  if (key === 'measurement_phase') return value === 'baseline' || value === 'trial';
  if (key === 'trial_plan_fingerprint') return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  if (['installed_version_code', 'previous_version_code', 'target_version_code'].includes(key)) {
    return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && (value.length < 19 || value <= '9223372036854775807');
  }
  if (booleans.has(key)) return typeof value === 'boolean';
  if (numeric.has(key) || signed.has(key)) return typeof value === 'number' && Number.isFinite(value)
    && Math.abs(value) <= Number.MAX_SAFE_INTEGER && (signed.has(key) || value >= 0);
  if (identifiers.has(key)) return typeof value === 'string' && safeAnalyticsId(value)
    || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (times.has(key)) return typeof value === 'string' && value.length <= 40
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (key === 'available_actions') return typeof value === 'string' && /^[a-z][a-z0-9_,:-]{0,127}$/i.test(value);
  return categories.has(key) && typeof value === 'string' && /^[a-z][a-z0-9_.:-]{0,95}$/i.test(value);
}
export function sanitizeProperties(input?: Record<string, unknown>): Record<string, AnalyticsValue> {
  const safe: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(input ?? {})) if (safeValue(key, value)) safe[key] = value;
  return safe;
}
export function validateEventProperties(event: string, input?: Record<string, unknown>): {
  properties: Record<string, AnalyticsValue>; valid: boolean; rejected: number; missing: readonly string[];
} {
  const contract = Object.hasOwn(contracts, event) ? contracts[event] : undefined;
  if (!contract) return { properties: {}, valid: false, rejected: 1, missing: [] };
  const allowed = new Set(contract.fields);
  const properties: Record<string, AnalyticsValue> = {};
  let rejected = 0;
  const wordReasons = new Set(['empty', 'too_short', 'too_long', 'malformed', 'not_constructible',
    'not_in_dictionary', 'wrong_order', 'profanity', 'slur_or_insult', 'proper_name',
    'abbreviation', 'non_lemma', 'low_quality', 'manual_deny']);
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined) continue;
    if (event === 'word_submit_outcome' && key === 'reason' && !wordReasons.has(String(value))) rejected += 1;
    else if (allowed.has(key) && safeValue(key, value)) properties[key] = value;
    else rejected += 1;
  }
  const missing = (contract.required ?? []).filter((key) => properties[key] === undefined);
  return { properties, valid: missing.length === 0, rejected, missing };
}

