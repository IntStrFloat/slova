import { useGame } from '@/features/game/store';
import { loadGameSnapshot, SNAPSHOT_VERSION } from '@/features/game/persistence';
import { useRewardRecovery } from '@/features/monetization/rewardRecovery';
import { useWheel } from '@/features/wheel';

/** Reuses the actual durable result and effect owners. No update-specific save or reward ledger. */
export function isSavedUpdateSafePoint(locallyReady: boolean): boolean {
  if (!locallyReady) return false;
  try {
    const game = useGame.getState(), recovery = useRewardRecovery.getState(), wheel = useWheel.getState();
    const snapshot = game.snapshot;
    if (!game.level || !snapshot || snapshot.version !== SNAPSHOT_VERSION || game.completion.status !== 'reward_claimed'
      || snapshot.completion.status !== 'reward_claimed' || recovery.checking || recovery.readFailed || recovery.pendingIds.length
      || wheel.pendingSpin || wheel.preparedReward) return false;
    const saved = loadGameSnapshot(game.mode, game.level, game.dailyDate ?? undefined);
    return saved?.attemptId === snapshot.attemptId && saved.revision === snapshot.revision && saved.completion.status === 'reward_claimed';
  } catch { return false; }
}
