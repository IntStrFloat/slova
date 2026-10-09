/** Only aggregate values and identifiers from verified game content may leave the device. */
const numericKeys = new Set([
  'answerIndex',
  'activeDays', 'activeTimeMs', 'amount', 'balance', 'cost', 'day', 'durationSec', 'errors', 'found',
  'hintsUsed', 'id', 'len', 'levelId', 'openedCells', 'policyRevision', 'progress', 'remaining', 'reward',
  'startupMs', 'streak', 'target', 'visibleTimeMs', 'world',
  'occurredAtMs', 'createdAtMs', 'fireAtMs',
]);

const booleanKeys = new Set([
  'active', 'daily', 'enabled', 'firstTime', 'hasHelp', 'isResume', 'manual', 'rewarded', 'assisted',
  'solved', 'claimable',
]);

const categoryKeys = new Set([
  'action', 'autoOrManual', 'entrySource', 'format', 'inputType', 'kind', 'mode',
  'paidWith', 'placement', 'reason', 'result', 'screen', 'setting', 'source',
  'trigger', 'type', 'assistanceType', 'completionSource', 'entryKind',
]);

const identifierKeys = new Set([
  'actionDay', 'collectibleId', 'completionId', 'contentVersion', 'dateKey', 'eventInstanceId', 'id',
  'levelId', 'levelKey', 'onboardingVersion', 'policyRevision', 'promptId',
  'periodId', 'puzzleInstanceId', 'rewardId', 'templateId', 'variantId', 'attemptId',
]);

const identifier = /^[a-z0-9][a-z0-9_.:-]{0,95}$/i;
const category = /^[a-z][a-z0-9_-]{0,47}$/i;

/** Drop unknown keys, nested objects, arbitrary text, word strings and touch paths. */
export function sanitizeProperties(input?: Record<string, unknown>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!input) return result;
  for (const [key, value] of Object.entries(input)) {
    if (numericKeys.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
    } else if (booleanKeys.has(key) && typeof value === 'boolean') {
      result[key] = value;
    } else if (categoryKeys.has(key) && typeof value === 'string' && category.test(value)) {
      result[key] = value;
    } else if (identifierKeys.has(key) && typeof value === 'string' && identifier.test(value)) {
      result[key] = value;
    }
  }
  return result;
}

export function safeAnalyticsId(value: string): boolean {
  return identifier.test(value);
}

export function safeEventName(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}
