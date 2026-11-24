import type { Level } from '@/core/engine/types';
import { getAnalyticsConsentEpoch, trackOnce } from '@/features/analytics';
import { selectHelpContext } from '@/features/analytics/helpContext';
import { puzzleIdentity } from '@/features/analytics/puzzleLifecycle';
import type { AppliedHintPayment } from '@/features/game/hintJournal';
import type { GameSnapshot } from '@/features/game/persistence';

/** Only a real applied hint may publish this fact; a debit alone does not establish progress. */
export function trackAppliedHelp(level: Level, snapshot: GameSnapshot, payment: AppliedHintPayment, options: {
  kind: 'letter' | 'semantic'; displayedCost?: number; alreadyOwned?: boolean; recovery?: boolean;
}): void {
  try {
    const context = selectHelpContext(payment.context);
    const identity = puzzleIdentity(level, snapshot);
    // A stale/legacy payment cannot relabel a different restored attempt as the original request.
    for (const field of ['attemptId', 'levelKey', 'levelId', 'mode', 'contentVersion', 'content_fingerprint'] as const) {
      if (context[field] !== undefined && context[field] !== identity[field]) return;
    }
    const transaction = payment.transaction;
    const sameOrigin = Boolean(context.origin_interaction_id
      && transaction?.context?.origin_interaction_id === context.origin_interaction_id);
    const sameAction = Boolean(context.interaction_id && transaction?.context?.interaction_id === context.interaction_id);
    const epoch = typeof getAnalyticsConsentEpoch === 'function' ? getAnalyticsConsentEpoch() : null;
    const debit = transaction && transaction.delta < 0 && transaction.currency === 'coins'
      && (payment.chargedNow > 0 || sameOrigin || sameAction)
      && (epoch === null || transaction.occurredAtMs >= epoch) ? transaction : null;
    // A legacy filled journal can prove fulfillment without its original clock.
    // Never replace that unknown time with the SDK handoff/restart time.
    if (options.recovery && !payment.timeKnown) return;
    const displayedCost = options.displayedCost ?? context.displayed_cost;
    const charged = debit ? -debit.delta : Math.max(0, payment.chargedNow);
    const fact = debit?.id ?? context.interaction_id
      ?? `${snapshot.attemptId}:${options.kind}:${payment.appliedAtMs ?? 'unknown'}`;
    const properties = {
      ...context, ...identity,
      type: options.kind, hint_type: options.kind, requested_hint: options.kind,
      ...(displayedCost === undefined ? {} : { cost: displayedCost, displayed_cost: displayedCost }),
      charged_amount: charged, already_owned: options.alreadyOwned ?? false,
      paidWith: charged > 0 ? 'coins' : options.alreadyOwned ? 'owned' : displayedCost === 0 ? 'free' : 'unknown',
      ...(debit ? { transaction_id: debit.id, balance_before: debit.balanceBefore, balance_after: debit.balanceAfter } : {}),
      ...(payment.timeKnown && payment.appliedAtMs !== undefined ? { occurredAtMs: payment.appliedAtMs } : {}),
      timeKnown: payment.timeKnown, recovery: options.recovery === true,
      source: options.recovery ? 'restore' : 'explicit',
    };
    trackOnce(options.kind === 'letter' ? 'hint_used' : 'semantic_clue_opened', `help:${fact}`, properties);
    trackOnce('help_used', `help:${fact}`, properties);
  } catch { /* Optional measurement cannot change a committed debit or opened help. */ }
}
