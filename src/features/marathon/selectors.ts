import { MARATHON } from '@/core/config/marathon';

import type { MarathonSnapshot } from './model';

export interface MarathonTierStatus {
  id: string;
  title: string;
  target: number;
  rewardCoins: number;
  completed: boolean;
  remaining: number;
}

export interface MarathonStatus {
  id: string;
  title: string;
  startDay: string;
  endDay: string;
  startAtMs: number;
  endAtMs: number;
  status: 'upcoming' | 'active' | 'ended';
  completionCount: number;
  earnedCoins: number;
  totalRewardCoins: number;
  tiers: MarathonTierStatus[];
}

export function getMarathonStatus(snapshot: MarathonSnapshot, nowMs: number): MarathonStatus {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid marathon clock');
  const count = Object.keys(snapshot.completions).length;
  return {
    id: MARATHON.id,
    title: MARATHON.title,
    startDay: MARATHON.startDay,
    endDay: MARATHON.endDay,
    startAtMs: MARATHON.startAtMs,
    endAtMs: MARATHON.endAtMs,
    status: nowMs < MARATHON.startAtMs ? 'upcoming' : nowMs < MARATHON.endAtMs ? 'active' : 'ended',
    completionCount: count,
    earnedCoins: Object.values(snapshot.rewardGrants).reduce((sum, reward) => sum + (reward.amount ?? 0), 0),
    totalRewardCoins: MARATHON.totalRewardCoins,
    tiers: MARATHON.thresholds.map((target, index) => ({
      id: `stage-${target}`,
      title: `Этап ${index + 1}`,
      target,
      rewardCoins: MARATHON.stageCoins + (index === MARATHON.thresholds.length - 1 ? MARATHON.finalBonusCoins : 0),
      completed: snapshot.claimedTiers.includes(target),
      remaining: Math.max(0, target - count),
    })),
  };
}
