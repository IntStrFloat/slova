import type { Level } from '@/core/engine/types';
import { cellKey } from '@/core/engine/types';
import { isIntroFreeLetterLevel } from '@/core/engine/hints';
import { dayKey } from '@/core/time';
import { trackOnce } from '@/features/analytics';
import { trackPuzzleCompletion } from '@/features/analytics/puzzleLifecycle';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { useCollection } from '@/features/collection';
import { useCurrency } from '@/features/currency';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { totalLevelCount, useLevels } from '@/features/levels';
import { getMarathonCompletionRewards, recordMarathonCompletion, reconcileMarathonRewards, useMarathon } from '@/features/marathon';
import { loadAdsMeta, recordCampaignLevelComplete, saveAdsMeta } from '@/features/monetization';
import { cancelDailyReminderForDate, syncDailyReminders } from '@/features/notifications';
import {
  readIntroGuidance,
  recordFirstIndependentIntroCompletion,
} from '@/features/onboarding/introGuide';
import { claimMilestoneReward } from '@/features/progression';
import { getCompletionRewards, productDayAt, recordCompletion, reconcileRewards, useRetention, type RewardGrant } from '@/features/retention';

import type { GameSnapshot, PlayMode } from './persistence';
import { levelObjectiveProgress } from './objectives';
import { applyMarathonCoinsOnce } from './marathonRewards';

export interface SettlementResult {
  puzzleKey: string;
  firstCompletion: boolean;
  effects: RewardGrant[];
  collectibleIds: string[];
}

export function getSavedPuzzleRewards(mode: 'campaign' | 'daily', puzzleKey: string): RewardGrant[] {
  return [
    ...getCompletionRewards(useRetention.getState(), mode, puzzleKey),
    ...getMarathonCompletionRewards(useMarathon.getState(), mode, puzzleKey),
  ];
}

function acceptedWords(level: Level, snapshot: GameSnapshot, fallbackDay: string) {
  const rewardedBonus = level.rewardedBonus ?? level.bonusPool;
  return Object.entries(snapshot.wordDates ?? {}).flatMap(([key, actionDay]) => {
    const divider = key.indexOf(':');
    const kind = key.slice(0, divider);
    const word = key.slice(divider + 1);
    if (divider < 0 || !word || (kind !== 'grid' && kind !== 'bonus')) return [];
    return [{ word, bonus: kind === 'bonus' && rewardedBonus.includes(word), manual: true, actionDay: actionDay || fallbackDay }];
  });
}

/** A demonstrated or revealed answer is still a valid win, but not an independent one. */
export function isIndependentIntroCompletion(
  level: Level,
  mode: PlayMode,
  snapshot: GameSnapshot,
  introPlayer: boolean,
): boolean {
  const id = level.globalId ?? level.id;
  return introPlayer
    && id >= 2 && id <= 5
    && mode === 'normal'
    && snapshot.mode === 'normal'
    && isIntroFreeLetterLevel(level)
    && snapshot.globalLevel === id
    && snapshot.levelFingerprint === level.fingerprint
    && snapshot.contentVersion === level.contentVersion
    && snapshot.completion.status !== 'playing'
    && snapshot.completion.source === 'submit'
    && Array.isArray(snapshot.hintsUsed)
    && snapshot.hintsUsed.length === 0
    && !snapshot.semanticHelpUsed
    && !readIntroGuidance().demoHelpedLevelIds.includes(id)
    && level.grid.cells.every((cell) => snapshot.filled[cellKey(cell)] === cell.ch)
    && level.answers.every((answer) => snapshot.solvedWords.includes(answer.word)
      && typeof snapshot.wordDates?.[`grid:${answer.word}`] === 'string');
}

/** Replayed for a pending result on launch; every grant uses a stable puzzle key. */
export function settlePuzzleCompletion(
  level: Level,
  mode: PlayMode,
  snapshot: GameSnapshot,
  introPlayer: boolean,
): SettlementResult {
  const campaignId = level.globalId ?? level.id;
  const puzzleKey = mode === 'daily' ? snapshot.dailyId : String(campaignId);
  if (!puzzleKey) throw new Error('A daily result requires its pinned puzzle date');
  if (mode === 'daily') {
    const pinned = useDailyPuzzle.getState().instances[puzzleKey];
    if (!pinned || pinned.level.fingerprint !== level.fingerprint) {
      throw new Error('A daily result requires its verified pinned puzzle');
    }
  }

  const completedAtMs = Date.parse(snapshot.completion.completedAt ?? snapshot.updatedAt);
  const actionDay = Number.isFinite(completedAtMs) ? productDayAt(completedAtMs) : dayKey();
  const completion = recordCompletion({
    mode: mode === 'daily' ? 'daily' : 'campaign',
    puzzleKey,
    puzzleDay: mode === 'daily' ? puzzleKey : undefined,
    actionDay,
    completedAtMs: Number.isFinite(completedAtMs) ? completedAtMs : Date.now(),
    acceptedWords: acceptedWords(level, snapshot, actionDay),
  });
  const effects = completion.accepted
    ? [...completion.effects]
    : getCompletionRewards(useRetention.getState(), mode === 'daily' ? 'daily' : 'campaign', puzzleKey);

  if (mode === 'daily') {
    useDailyPuzzle.getState().completeDaily(puzzleKey);
    if (!useDailyPuzzle.getState().isDone(puzzleKey)) {
      throw new Error('Daily completion is not durable yet');
    }
    void cancelDailyReminderForDate(puzzleKey).then(() => syncDailyReminders());
  } else {
    // Existing profiles keep the released objective rewards. Gifts belong to
    // every campaign player, including profiles that began with the intro.
    const wasCompleted = useLevels.getState().completed.includes(campaignId);
    if (!introPlayer && !wasCompleted) {
      const rewardedBonus = level.rewardedBonus ?? level.bonusPool;
      const objective = levelObjectiveProgress(level, {
        foundBonus: snapshot.foundBonus.filter((word) => rewardedBonus.includes(word)).length,
        hintsUsed: snapshot.hintsUsed.length,
        mistakes: snapshot.mistakes ?? 0,
        solvedWords: snapshot.solvedWords.length,
      });
      if (objective?.reward) {
        const id = `legacy:campaign:${campaignId}:objective`;
        useCurrency.getState().addOnce(id, 'coins', objective.reward);
        effects.push({ id, kind: 'coins', amount: objective.reward, source: 'legacy-objective' });
      }
    }
    const amount = claimMilestoneReward(`campaign:${campaignId}`, campaignId);
    if (amount > 0) {
      // Keep the original wallet key so a restored pending result cannot pay
      // a second copy to players who received this gift before the redesign.
      const id = `legacy:campaign:${campaignId}:milestone`;
      useCurrency.getState().addOnce(id, 'coins', amount);
      effects.push({ id, kind: 'coins', amount, source: 'legacy-milestone' });
    }
    useLevels.getState().completeLevelOnce(`campaign:${campaignId}:progress`, campaignId);
    useCollection.getState().maybeUnlockAtLevel(level.world, campaignId);
    saveAdsMeta(recordCampaignLevelComplete(loadAdsMeta(), campaignId));
    const total = totalLevelCount();
    if (campaignId === total && useLevels.getState().completed.length >= total) {
      const catalogVersion = `campaign-${total}-${snapshot.contentVersion}`;
      trackOnce('campaign_completed', catalogVersion, {
        catalog_version: catalogVersion, last_level_id: total,
        completed_count: useLevels.getState().completed.length,
        content_version: snapshot.contentVersion,
        occurredAtMs: completedAtMs,
      });
    }
  }

  if (isIndependentIntroCompletion(level, mode, snapshot, introPlayer)) {
    const first = recordFirstIndependentIntroCompletion({
      levelId: campaignId,
      attemptId: snapshot.attemptId,
      completedAt: snapshot.completion.completedAt ?? snapshot.updatedAt,
    });
    trackOnce('independent_level_completed', 'intro:first-independent:v1', {
      levelId: first.levelId,
      levelKey: `campaign:${first.levelId}`,
      attemptId: first.attemptId,
      contentVersion: first.attemptId === snapshot.attemptId ? snapshot.contentVersion : 'unknown',
      occurredAtMs: Date.parse(first.completedAt),
      assisted: false,
    });
  }

  const marathon = recordMarathonCompletion({
    mode: mode === 'daily' ? 'daily' : 'campaign', puzzleKey, actionDay,
    completedAtMs: Number.isFinite(completedAtMs) ? completedAtMs : Date.now(),
  }, useRetention.getState());
  effects.push(...marathon.effects);
  reconcileMarathonRewards(applyMarathonCoinsOnce);
  reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
  trackObservedRetentionMilestones(useRetention.getState());
  const demoHelped = introPlayer && readIntroGuidance().demoHelpedLevelIds.includes(campaignId);
  const assisted = snapshot.hintsUsed.length > 0 || snapshot.semanticHelpUsed === true
    || demoHelped || snapshot.completion.source !== 'submit';
  trackPuzzleCompletion(level, snapshot, {
    introPlayer,
    assisted,
    assistanceType: snapshot.hintsUsed.length > 0
      ? snapshot.hintsUsed.some((hint) => hint !== 'bulb') ? 'word_reveal' : 'letter'
      : snapshot.semanticHelpUsed ? 'semantic' : demoHelped ? 'intro_help'
      : snapshot.completion.source !== 'submit' ? snapshot.completion.source ?? 'unknown' : 'none',
    dailyActionDays: Object.values(useRetention.getState().dailyCompletions),
  });
  if (introPlayer && mode !== 'daily' && campaignId === 5) {
    trackOnce('intro_completed', 'intro-v1', {
      levelId: campaignId, onboardingVersion: snapshot.contentVersion,
      contentVersion: snapshot.contentVersion, attemptId: snapshot.attemptId,
      occurredAtMs: completedAtMs,
    });
  }
  for (const effect of effects) {
    trackOnce('reward_granted', effect.id, {
      rewardId: effect.id,
      amount: effect.amount ?? 0,
      source: effect.source,
    });
  }
  return {
    puzzleKey,
    firstCompletion: completion.accepted,
    effects,
    collectibleIds: effects.flatMap((effect) => effect.collectibleId ? [effect.collectibleId] : []),
  };
}
