/* eslint-disable @typescript-eslint/no-require-imports */

describe('semantic clue payment', () => {
  beforeEach(() => jest.resetModules());

  test('the same clue unlocks once in the wallet ledger; a new answer costs again', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { purchaseSemanticClue, SEMANTIC_CLUE_COST } = require('../index');
      expect(SEMANTIC_CLUE_COST).toBe(30);
      expect(purchaseSemanticClue('campaign:1', 'revision-a', 'кот')).toBe('unlocked');
      expect(useCurrency.getState().coins).toBe(30);
      expect(purchaseSemanticClue('campaign:1', 'revision-a', 'кот')).toBe('unlocked');
      expect(useCurrency.getState().coins).toBe(30);
      expect(purchaseSemanticClue('campaign:1', 'revision-a', 'ток')).toBe('unlocked');
      expect(useCurrency.getState().coins).toBe(0);
      expect(purchaseSemanticClue('campaign:2', 'revision-a', 'кот')).toBe('insufficient');
      expect(useCurrency.getState().coins).toBe(0);
      expect(useCurrency.getState().hasApplied('semantic-clue:campaign:1:revision-a:кот')).toBe(true);
      expect(useCurrency.getState().hasApplied('semantic-clue:campaign:2:revision-a:кот')).toBe(false);
    });
  });

  test.each([1, 2, 3, 4, 5])('assigned intro level %i unlocks clues durably with no currency effects', (id) => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 0, gems: 0 }));
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      assignIntroPackForCurrentProfile();
      const { useGame } = require('@/features/game/store');
      const { useCurrency } = require('@/features/currency');
      const { readIntroGuidance } = require('@/features/onboarding/introGuide');
      const { purchaseSemanticClue } = require('../index');
      const intro = getIntroLevel(id);
      useGame.getState().start(intro, 'normal');
      for (const answer of intro.answers) {
        expect(purchaseSemanticClue(`campaign:${id}`, intro.fingerprint, answer.word)).toBe('unlocked');
        expect(purchaseSemanticClue(`campaign:${id}`, intro.fingerprint, answer.word)).toBe('unlocked');
      }
      const unlocks = JSON.parse(storage.getString('onboarding.semantic-clues.intro-v1'));
      expect(unlocks.version).toBe(1);
      expect(unlocks.ids).toHaveLength(intro.answers.length);
      expect(useCurrency.getState().coins).toBe(0);
      expect(useCurrency.getState().appliedRewards).toEqual({});
      expect(readIntroGuidance().demoHelpedLevelIds).toEqual([id]);
      expect(useGame.getState().play.filled).toEqual({});
      expect(useGame.getState().play.solvedWords).toEqual([]);
    });
  });

  test.each(['profile', 'daily', 'key', 'revision', 'word'] as const)(
    'an intro-looking clue with a mismatched %s retains paid behavior', (mismatch) => {
      jest.isolateModules(() => {
        const { storage } = require('@/core/storage');
        storage.clearAll();
        const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
        if (mismatch !== 'profile') assignIntroPackForCurrentProfile();
        const { useGame } = require('@/features/game/store');
        const { useCurrency } = require('@/features/currency');
        const { purchaseSemanticClue } = require('../index');
        const intro = getIntroLevel(2);
        useGame.getState().start(intro, mismatch === 'daily' ? 'daily' : 'normal', '2026-10-03');
        const key = mismatch === 'daily' ? 'daily:2026-10-03'
          : mismatch === 'key' ? 'campaign:99' : 'campaign:2';
        const revision = mismatch === 'revision' ? 'foreign-content' : intro.fingerprint;
        const word = mismatch === 'word' ? 'чужой' : intro.answers[0].word;
        expect(purchaseSemanticClue(key, revision, word)).toBe('unlocked');
        expect(useCurrency.getState().coins).toBe(30);
        expect(useCurrency.getState().hasApplied(`semantic-clue:${key}:${revision}:${word}`)).toBe(true);
        expect(storage.getString('onboarding.semantic-clues.intro-v1')).toBeUndefined();
      });
    },
  );

  test('an unlock interrupted before assistance classification retries without granting coins', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      assignIntroPackForCurrentProfile();
      const { useGame } = require('@/features/game/store');
      const { useCurrency } = require('@/features/currency');
      const { readIntroGuidance } = require('@/features/onboarding/introGuide');
      const { purchaseSemanticClue } = require('../index');
      const intro = getIntroLevel(2);
      useGame.getState().start(intro, 'normal');
      const ledgerBefore = { ...useCurrency.getState().appliedRewards };
      const write = storage.set.bind(storage);
      const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
        if (key === 'onboarding.guide.intro-v1') throw new Error('classification save failed');
        write(key, value);
      });
      expect(() => purchaseSemanticClue('campaign:2', intro.fingerprint, 'сон'))
        .toThrow('classification save failed');
      failure.mockRestore();
      expect(purchaseSemanticClue('campaign:2', intro.fingerprint, 'сон')).toBe('unlocked');
      expect(readIntroGuidance().demoHelpedLevelIds).toEqual([2]);
      expect(JSON.parse(storage.getString('onboarding.semantic-clues.intro-v1')).ids).toHaveLength(1);
      expect(useCurrency.getState().coins).toBe(60);
      expect(useCurrency.getState().appliedRewards).toEqual(ledgerBefore);
    });
  });

  test('a damaged free-unlock ledger fails closed and does not spend coins as a fallback', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      assignIntroPackForCurrentProfile();
      const { useGame } = require('@/features/game/store');
      const { useCurrency } = require('@/features/currency');
      const { purchaseSemanticClue } = require('../index');
      const intro = getIntroLevel(2);
      useGame.getState().start(intro, 'normal');
      storage.set('onboarding.semantic-clues.intro-v1', '{broken');
      expect(() => purchaseSemanticClue('campaign:2', intro.fingerprint, 'сон')).toThrow();
      expect(useCurrency.getState().coins).toBe(60);
      expect(storage.getString('onboarding.semantic-clues.intro-v1')).toBe('{broken');
    });
  });
});
