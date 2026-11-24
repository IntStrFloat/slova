/* eslint-disable @typescript-eslint/no-require-imports */
import type { GameSnapshot } from '../persistence';

describe('first independent introduction completion', () => {
  beforeEach(() => {
    jest.resetModules();
    // Intro settlement assertions run before the calendar marathon starts.
    jest.useFakeTimers({ now: Date.parse('2026-10-25T12:00:00.000Z') });
  });
  afterEach(() => jest.useRealTimers());

  test.each(['none', 'letter', 'demo', 'semantic'] as const)('records only unassisted completion: %s', (help) => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { getIntroLevel } = require('@/features/onboarding/introPack');
      const {
        readFirstIndependentIntroCompletion,
        recordIntroDemoHelpUsed,
      } = require('@/features/onboarding/introGuide');
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('@/features/retention');
      const { ECONOMY } = require('@/core/config/economy');
      const { useGame } = require('../store');
      const { revealLetter } = require('../hintJournal');
      const { isIndependentIntroCompletion, settlePuzzleCompletion } = require('../settlement');
      expect(useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
      expect(useCurrency.getState().coins).toBe(ECONOMY.starterCoins + ECONOMY.starterHintCoins);
      const level = getIntroLevel(2);
      useGame.getState().start(level, 'normal');
      if (help === 'letter') expect(revealLetter('campaign:2')).toBe('applied');
      if (help === 'demo' || help === 'semantic') recordIntroDemoHelpUsed(2);
      expect(useGame.getState().submit('сон').kind).toBe('grid');
      expect(useGame.getState().submit('нос').kind).toBe('grid');
      const snapshot = useGame.getState().snapshot as GameSnapshot;
      expect(snapshot.completion.status).toBe('completion_pending');
      expect(isIndependentIntroCompletion(level, 'normal', snapshot, true)).toBe(help === 'none');
      expect(isIndependentIntroCompletion(level, 'daily', snapshot, true)).toBe(false);
      expect(isIndependentIntroCompletion(level, 'normal', snapshot, false)).toBe(false);
      expect(isIndependentIntroCompletion(level, 'normal', { ...snapshot, wordDates: {} }, true)).toBe(false);
      const balanceBefore = useCurrency.getState().coins;
      const settled = settlePuzzleCompletion(level, 'normal', snapshot, true);
      const first = readFirstIndependentIntroCompletion();
      expect(first?.levelId ?? null).toBe(help === 'none' ? 2 : null);
      expect(settled.effects.some((effect: { source: string }) => effect.source === 'intro-independent')).toBe(false);
      expect(useCurrency.getState().coins).toBe(balanceBefore);
      if (help === 'none') {
        expect(first?.attemptId).toBe(snapshot.attemptId);
        settlePuzzleCompletion(level, 'normal', snapshot, true);
        expect(readFirstIndependentIntroCompletion()).toEqual(first);
        expect(useCurrency.getState().coins).toBe(balanceBefore);
      }
    });
  });

  test('first-level completion never enters the independent 2–5 record', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { getIntroLevel } = require('@/features/onboarding/introPack');
      const { readFirstIndependentIntroCompletion } = require('@/features/onboarding/introGuide');
      const { useGame } = require('../store');
      const { settlePuzzleCompletion, isIndependentIntroCompletion } = require('../settlement');
      const level = getIntroLevel(1);
      useGame.getState().start(level, 'normal');
      for (const answer of level.answers) useGame.getState().submit(answer.word);
      const snapshot = useGame.getState().snapshot;
      expect(isIndependentIntroCompletion(level, 'normal', snapshot, true)).toBe(false);
      expect(() => settlePuzzleCompletion(level, 'normal', snapshot, true)).not.toThrow();
      expect(readFirstIndependentIntroCompletion()).toBeNull();
    });
  });

  test('an assisted second level can be followed by the first independent third level', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { getIntroLevel } = require('@/features/onboarding/introPack');
      const { readFirstIndependentIntroCompletion } = require('@/features/onboarding/introGuide');
      const { useGame } = require('../store');
      const { revealLetter } = require('../hintJournal');
      const { settlePuzzleCompletion } = require('../settlement');
      const second = getIntroLevel(2);
      useGame.getState().start(second, 'normal');
      expect(revealLetter('campaign:2')).toBe('applied');
      useGame.getState().submit('сон');
      useGame.getState().submit('нос');
      settlePuzzleCompletion(second, 'normal', useGame.getState().snapshot, true);
      expect(readFirstIndependentIntroCompletion()).toBeNull();

      const third = getIntroLevel(3);
      useGame.getState().start(third, 'normal');
      useGame.getState().submit('дело');
      useGame.getState().submit('лед');
      settlePuzzleCompletion(third, 'normal', useGame.getState().snapshot, true);
      expect(readFirstIndependentIntroCompletion()?.levelId).toBe(3);
    });
  });
});
