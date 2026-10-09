import { MARATHON } from '@/core/config/marathon';
import { epochDay } from '@/features/retention/model';
import type { CompletionAction, RetentionSnapshot, RewardGrant } from '@/features/retention/model';

export type MarathonCompletionAction = Pick<CompletionAction,
  'mode' | 'puzzleKey' | 'actionDay' | 'completedAtMs' | 'puzzleDay'>;

export interface MarathonSnapshot {
  version: 1;
  eventId: string;
  /** First completions only, keyed by campaign global ID or today's daily date. */
  completions: Record<string, string>;
  claimedTiers: number[];
  rewardGrants: Record<string, RewardGrant>;
  completionEffectIds: Record<string, string[]>;
  pendingCoinGrants: Record<string, number>;
}

export interface MarathonTransition {
  snapshot: MarathonSnapshot;
  accepted: boolean;
  effects: RewardGrant[];
}

export function makeInitialMarathonSnapshot(): MarathonSnapshot {
  return {
    version: 1,
    eventId: MARATHON.id,
    completions: {},
    claimedTiers: [],
    rewardGrants: {},
    completionEffectIds: {},
    pendingCoinGrants: {},
  };
}

export function marathonStageRewardId(target: number): string {
  return `marathon:${MARATHON.id}:stage:${target}`;
}

export function marathonFinalRewardId(): string {
  return `marathon:${MARATHON.id}:finish`;
}

export function isMarathonDay(day: string): boolean {
  try { epochDay(day); } catch { return false; }
  return day >= MARATHON.startDay && day < MARATHON.endDay;
}

function actionKey(action: MarathonCompletionAction): string {
  if (action.mode === 'campaign') {
    if (!/^[1-9]\d*$/.test(action.puzzleKey)) throw new Error('Marathon campaign key must be a global level ID');
    return `campaign:${action.puzzleKey}`;
  }
  if (action.mode !== 'daily') throw new Error('Invalid marathon puzzle mode');
  epochDay(action.puzzleKey);
  if (action.puzzleDay !== undefined && action.puzzleDay !== action.puzzleKey) {
    throw new Error('Marathon daily puzzle dates disagree');
  }
  return `daily:${action.puzzleKey}`;
}

export function isMarathonCompletionKey(key: string, day: string): boolean {
  if (!isMarathonDay(day)) return false;
  if (/^campaign:[1-9]\d*$/.test(key)) return true;
  return key === `daily:${day}`;
}

function rewardsForCompletion(snapshot: MarathonSnapshot, key: string): RewardGrant[] {
  return (snapshot.completionEffectIds[key] ?? []).flatMap((id) =>
    snapshot.rewardGrants[id] ? [snapshot.rewardGrants[id]] : []);
}

/** Restore the original result presentation without re-granting its rewards. */
export function getMarathonCompletionRewards(snapshot: MarathonSnapshot, mode: CompletionAction['mode'], puzzleKey: string): RewardGrant[] {
  return rewardsForCompletion(snapshot, `${mode}:${puzzleKey}`);
}

function advance(snapshot: MarathonSnapshot, key: string, day: string): MarathonTransition {
  if (snapshot.completions[key]) {
    return { snapshot, accepted: false, effects: rewardsForCompletion(snapshot, key) };
  }
  const draft = JSON.parse(JSON.stringify(snapshot)) as MarathonSnapshot;
  draft.completions[key] = day;
  const count = Object.keys(draft.completions).length;
  const effects: RewardGrant[] = [];
  const grant = (id: string, amount: number) => {
    if (draft.rewardGrants[id]) return;
    const reward: RewardGrant = { id, kind: 'coins', amount, source: 'marathon' };
    draft.rewardGrants[id] = reward;
    draft.pendingCoinGrants[id] = amount;
    effects.push(reward);
  };
  for (const target of MARATHON.thresholds) {
    if (count < target || draft.claimedTiers.includes(target)) continue;
    draft.claimedTiers.push(target);
    grant(marathonStageRewardId(target), MARATHON.stageCoins);
    if (target === MARATHON.thresholds[MARATHON.thresholds.length - 1]) {
      grant(marathonFinalRewardId(), MARATHON.finalBonusCoins);
    }
  }
  draft.completionEffectIds[key] = effects.map((effect) => effect.id);
  return { snapshot: draft, accepted: true, effects };
}

/** The original durable gesture time decides eligibility, including result replay. */
export function reduceMarathonCompletion(
  snapshot: MarathonSnapshot,
  action: MarathonCompletionAction,
  retention: Pick<RetentionSnapshot, 'campaignCompletions' | 'dailyCompletions'>,
): MarathonTransition {
  epochDay(action.actionDay);
  if (!Number.isFinite(action.completedAtMs)
    || new Date(action.completedAtMs + MARATHON.utcOffsetMinutes * 60_000).toISOString().slice(0, 10) !== action.actionDay) {
    throw new Error('Marathon completion timestamp and product day disagree');
  }
  const key = actionKey(action);
  const completedDay = action.mode === 'campaign'
    ? retention.campaignCompletions[action.puzzleKey]
    : retention.dailyCompletions[action.puzzleKey];
  if (completedDay !== action.actionDay
    || action.completedAtMs < MARATHON.startAtMs || action.completedAtMs >= MARATHON.endAtMs
    || action.mode === 'daily' && action.puzzleKey !== action.actionDay) {
    return { snapshot, accepted: false, effects: [] };
  }
  return advance(snapshot, key, action.actionDay);
}

/** Full Moscow-day bounds let durable first-completion dates recover after expiry. */
export function reduceMarathonRecovery(
  snapshot: MarathonSnapshot,
  retention: Pick<RetentionSnapshot, 'campaignCompletions' | 'dailyCompletions'>,
): MarathonTransition {
  const candidates = [
    ...Object.entries(retention.campaignCompletions).map(([key, day]) => [`campaign:${key}`, day] as const),
    ...Object.entries(retention.dailyCompletions).map(([key, day]) => [`daily:${key}`, day] as const),
  ].filter(([key, day]) => isMarathonCompletionKey(key, day))
    .sort(([, aDay], [, bDay]) => aDay.localeCompare(bDay));
  let next = snapshot;
  const effects: RewardGrant[] = [];
  for (const [key, day] of candidates) {
    if (next.completions[key]) continue;
    const result = advance(next, key, day);
    next = result.snapshot;
    effects.push(...result.effects);
  }
  return { snapshot: next, accepted: next !== snapshot, effects };
}
