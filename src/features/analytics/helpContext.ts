import { sanitizeProperties } from './schema';

/** A bounded local operation snapshot; raw hint/word text never belongs in this context. */
export interface HelpAnalyticsContext extends Record<string, unknown> {
  origin_interaction_id?: string;
  interaction_id?: string;
  modal_id?: string;
  attemptId?: string;
  levelKey?: string;
  levelId?: number;
  mode?: 'campaign' | 'daily';
  dateKey?: string;
  contentVersion?: string;
  content_fingerprint?: string;
  requested_hint?: 'letter' | 'semantic';
  displayed_cost?: number;
  balance?: number;
  entry_source?: string;
  previously_completed?: boolean;
}

const FIELDS = new Set(['origin_interaction_id', 'interaction_id', 'modal_id', 'attemptId', 'levelKey', 'levelId',
  'mode', 'dateKey', 'contentVersion', 'content_fingerprint', 'requested_hint', 'displayed_cost', 'balance', 'entry_source', 'previously_completed']);
const NUMBERS = new Set(['levelId', 'displayed_cost', 'balance']);

export function selectHelpContext(input?: Record<string, unknown> | HelpAnalyticsContext): HelpAnalyticsContext {
  const properties = sanitizeProperties(input as Record<string, unknown> | undefined);
  const selected: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!FIELDS.has(key)) continue;
    if (NUMBERS.has(key)) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) continue;
    } else if (key === 'previously_completed') {
      if (typeof value !== 'boolean') continue;
    } else if (typeof value !== 'string') continue;
    if (key === 'content_fingerprint' && typeof value === 'string'
      && !/^fp_[a-f0-9]{16}$/i.test(value) && !/^[a-f0-9]{64}$/i.test(value)) continue;
    if (key === 'levelKey' && typeof value === 'string'
      && !/^(campaign:[1-9]\d*|daily:\d{4}-\d{2}-\d{2})$/.test(value)) continue;
    if (key === 'mode' && value !== 'campaign' && value !== 'daily') continue;
    if (key === 'requested_hint' && value !== 'letter' && value !== 'semantic') continue;
    selected[key] = value;
  }
  return selected as HelpAnalyticsContext;
}
