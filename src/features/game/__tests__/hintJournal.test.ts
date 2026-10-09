/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine';

const level: Level = {
  id: 1, globalId: 1, world: 'world1', letters: ['к', 'о', 'т'], difficulty: 1,
  grid: { rows: 1, cols: 3, cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] },
  answers: [{ word: 'кот', dir: 'H', cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] }],
  bonusPool: [],
};

describe('letter hint transaction', () => {
  beforeEach(() => jest.resetModules());

  test('a debit committed before a crash reveals once and every further letter costs coins', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { useGame } = require('../store');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      useGame.getState().start(level, 'normal');
      const firstId = `hint:campaign:1:${useGame.getState().snapshot.attemptId}:0,0`;

      storage.set(KEYS.pendingHint, JSON.stringify({
        version: 1, puzzleKey: 'campaign:1', cell: '0,0', effectId: firstId, payment: 'coins',
      }));
      expect(useCurrency.getState().spendOnce(firstId, 'coins', 50)).toBe('spent');
      expect(replayPendingLetterHint('campaign:1')).toBe('applied');
      expect(useGame.getState().play.filled['0,0']).toBe('к');
      expect(useCurrency.getState().coins).toBe(10);
      expect(replayPendingLetterHint('campaign:1')).toBeNull();

      expect(revealLetter('campaign:1')).toBe('insufficient');
      expect(useGame.getState().play.filled['0,1']).toBeUndefined();
      expect(useCurrency.getState().addOnce('earned:1', 'coins', 50)).toBe(true);
      expect(revealLetter('campaign:1')).toBe('applied');
      expect(useGame.getState().play.filled['0,1']).toBe('о');
      expect(useCurrency.getState().coins).toBe(10);
      expect(revealLetter('campaign:1')).toBe('insufficient');
      expect(useGame.getState().play.filled['0,2']).toBeUndefined();
    });
  });

  test('an interrupted old free hint is cancelled before any cell is revealed', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      const intro = require('@/features/onboarding/introPack').getIntroLevel(2);
      useGame.getState().start(intro, 'normal');
      const key = '0,0';
      storage.set(KEYS.pendingHint, JSON.stringify({
        version: 1, puzzleKey: 'campaign:2', cell: key,
        effectId: `hint:campaign:2:${useGame.getState().snapshot.attemptId}:${key}`,
        payment: 'free',
      }));

      expect(replayPendingLetterHint('campaign:2')).toBeNull();
      expect(useGame.getState().play.filled[key]).toBeUndefined();
      expect(useCurrency.getState().coins).toBe(60);
      expect(revealLetter('campaign:2')).toBe('applied');
      expect(useCurrency.getState().coins).toBe(10);
      expect(useGame.getState().play.filled[key]).toBe(intro.grid.cells[0].ch);
    });
  });

  test('an old spent ticket becomes one coin refund, never a ticket-funded reveal', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 20, gems: 0 }));
      const { useGame } = require('../store');
      useGame.getState().start(level, 'normal');
      const id = `hint:campaign:1:${useGame.getState().snapshot.attemptId}:0,0`;
      const { makeInitialSnapshot } = require('@/features/retention/model');
      const old = makeInitialSnapshot({ newProfile: false });
      old.ticketSpendIds[id] = 1;
      storage.set(KEYS.retention, JSON.stringify(old));
      storage.set(KEYS.pendingHint, JSON.stringify({
        version: 1, puzzleKey: 'campaign:1', cell: '0,0', effectId: id, payment: 'ticket',
      }));
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('@/features/retention');
      const { replayPendingLetterHint, revealLetter } = require('../hintJournal');

      expect(replayPendingLetterHint('campaign:1')).toBeNull();
      expect(useGame.getState().play.filled['0,0']).toBeUndefined();
      expect(useCurrency.getState().coins).toBe(70);
      expect(useRetention.getState().rewardGrants[`hint-recovery:${id}`]).toMatchObject({
        kind: 'coins', amount: 50,
      });
      expect(replayPendingLetterHint('campaign:1')).toBeNull();
      expect(useCurrency.getState().coins).toBe(70);
      expect(revealLetter('campaign:1')).toBe('applied');
      expect(useCurrency.getState().coins).toBe(20);
    });
  });

  test('a foreign debited coin intent refunds once if its cell was not applied', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { replayPendingLetterHint } = require('../hintJournal');
      useGame.getState().start(level, 'normal');
      const id = `hint:campaign:1:${useGame.getState().snapshot.attemptId}:0,0`;
      storage.set(KEYS.pendingHint, JSON.stringify({
        version: 1, puzzleKey: 'campaign:1', cell: '0,0', effectId: id, payment: 'coins',
      }));
      expect(useCurrency.getState().spendOnce(id, 'coins', 50)).toBe('spent');
      expect(useCurrency.getState().coins).toBe(10);
      useGame.getState().start(require('@/features/onboarding/introPack').getIntroLevel(2), 'normal');

      expect(replayPendingLetterHint('campaign:2')).toBeNull();
      expect(useCurrency.getState().coins).toBe(60);
      expect(replayPendingLetterHint('campaign:2')).toBeNull();
      expect(useCurrency.getState().coins).toBe(60);
      expect(useCurrency.getState().hasApplied(`hint-recovery:${id}`)).toBe(true);
    });
  });

  test('cleanup failure cannot charge twice or block the next paid letter', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      const originalRemove = storage.remove.bind(storage);
      storage.remove = (key: string) => {
        if (key === KEYS.pendingHint) throw new Error('remove failed');
        return originalRemove(key);
      };
      try {
        useGame.getState().start(level, 'normal');
        expect(revealLetter('campaign:1')).toBe('applied');
        expect(useCurrency.getState().coins).toBe(10);
        expect(JSON.parse(storage.getString(KEYS.pendingHint)).status).toBe('applied');
        expect(replayPendingLetterHint('campaign:1')).toBe('applied');
        expect(useCurrency.getState().coins).toBe(10);
        useCurrency.getState().addOnce('earned:next', 'coins', 50);
        expect(revealLetter('campaign:1')).toBe('applied');
        expect(useCurrency.getState().coins).toBe(10);
        expect(useGame.getState().play.filled['0,1']).toBe('о');
      } finally {
        storage.remove = originalRemove;
      }
    });
  });

  test.each([1, 2, 3, 4, 5])('assigned intro level %i reveals letters with an empty wallet', (id) => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 0, gems: 0 }));
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      expect(assignIntroPackForCurrentProfile()).toBe(true);
      const { readIntroGuidance } = require('@/features/onboarding/introGuide');
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter } = require('../hintJournal');
      const intro = getIntroLevel(id);
      useGame.getState().start(intro, 'normal');
      for (const cell of intro.grid.cells) {
        expect(revealLetter(`campaign:${id}`)).toBe('applied');
        expect(useGame.getState().play.filled[`${cell.row},${cell.col}`]).toBe(cell.ch);
      }
      expect(revealLetter(`campaign:${id}`)).toBe('unavailable');
      expect(useCurrency.getState().coins).toBe(0);
      expect(useCurrency.getState().appliedRewards).toEqual({});
      expect(useGame.getState().play.solvedWords).toEqual([]);
      expect(useGame.getState().completion.status).toBe('playing');
      expect(readIntroGuidance().demoHelpedLevelIds).toEqual([id]);
    });
  });

  test('an interrupted new free intent replays once without charging or granting currency', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      assignIntroPackForCurrentProfile();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      const intro = getIntroLevel(2);
      useGame.getState().start(intro, 'normal');
      const ledgerBefore = { ...useCurrency.getState().appliedRewards };
      const write = storage.set.bind(storage);
      const failSnapshot = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
        if (key === KEYS.gameCurrentNormal) throw new Error('snapshot failed');
        write(key, value);
      });
      expect(() => revealLetter('campaign:2')).toThrow('snapshot failed');
      const intent = JSON.parse(storage.getString(KEYS.pendingHint));
      expect(intent).toMatchObject({ version: 2, payment: 'intro-free', levelId: 2 });
      expect(useGame.getState().play.filled[intent.cell]).toBeUndefined();
      failSnapshot.mockRestore();
      useGame.getState().start(intro, 'normal');
      expect(replayPendingLetterHint('campaign:2')).toBe('applied');
      expect(replayPendingLetterHint('campaign:2')).toBeNull();
      expect(useGame.getState().hintsUsed).toEqual(['bulb']);
      expect(useCurrency.getState().coins).toBe(60);
      expect(useCurrency.getState().appliedRewards).toEqual(ledgerBefore);
    });
  });

  test('a saved legacy intro keeps free help, while its old raw free intent is cancelled', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { INTRO_PACK_ASSIGNMENT_KEY } = require('@/features/onboarding/introPack');
      storage.set(INTRO_PACK_ASSIGNMENT_KEY, 'intro-v1');
      const { intro } = require('../../../../assets/content/legacy-early-levels.json');
      const fifth = intro.find((candidate: Level) => candidate.id === 5);
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      useGame.getState().start(fifth, 'normal');
      storage.set(KEYS.pendingHint, JSON.stringify({
        version: 1, puzzleKey: 'campaign:5', cell: '0,0',
        effectId: `hint:campaign:5:${useGame.getState().snapshot.attemptId}:0,0`, payment: 'free',
      }));
      expect(replayPendingLetterHint('campaign:5')).toBeNull();
      expect(useGame.getState().play.filled).toEqual({});
      expect(revealLetter('campaign:5')).toBe('applied');
      expect(useCurrency.getState().coins).toBe(60);
      expect(useGame.getState().play.filled['0,0']).toBe('к');
    });
  });

  test('a free reveal committed before an assistance journal failure replays without another reveal', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      assignIntroPackForCurrentProfile();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { readIntroGuidance } = require('@/features/onboarding/introGuide');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      useGame.getState().start(getIntroLevel(2), 'normal');
      const write = storage.set.bind(storage);
      const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
        if (key === 'onboarding.guide.intro-v1') throw new Error('assistance journal failed');
        write(key, value);
      });
      expect(() => revealLetter('campaign:2')).toThrow('assistance journal failed');
      expect(useGame.getState().play.filled['0,0']).toBe('с');
      expect(useGame.getState().hintsUsed).toEqual(['bulb']);
      failure.mockRestore();
      expect(replayPendingLetterHint('campaign:2')).toBe('applied');
      expect(replayPendingLetterHint('campaign:2')).toBeNull();
      expect(readIntroGuidance().demoHelpedLevelIds).toEqual([2]);
      expect(useGame.getState().hintsUsed).toEqual(['bulb']);
      expect(useCurrency.getState().coins).toBe(60);
    });
  });

  test.each(['attempt', 'fingerprint', 'profile', 'key', 'effect', 'cell'] as const)(
    'a free intent with a mismatched %s cannot authorize a reveal', (mismatch) => {
      jest.isolateModules(() => {
        const { storage, KEYS } = require('@/core/storage');
        storage.clearAll();
        const { assignIntroPackForCurrentProfile, getIntroLevel, INTRO_PACK_ASSIGNMENT_KEY } = require('@/features/onboarding/introPack');
        assignIntroPackForCurrentProfile();
        const { useGame } = require('../store');
        const { useCurrency } = require('@/features/currency');
        const { replayPendingLetterHint } = require('../hintJournal');
        const intro = getIntroLevel(2);
        useGame.getState().start(intro, 'normal');
        const attempt = useGame.getState().snapshot.attemptId;
        const intent = {
          version: 2, puzzleKey: 'campaign:2', cell: '0,0',
          effectId: `hint:campaign:2:${attempt}:0,0`, payment: 'intro-free',
          attemptId: attempt, levelId: 2, contentVersion: intro.contentVersion,
          levelFingerprint: intro.fingerprint,
        };
        if (mismatch === 'attempt') intent.attemptId = 'older-attempt';
        if (mismatch === 'fingerprint') intent.levelFingerprint = 'different-content';
        if (mismatch === 'profile') storage.remove(INTRO_PACK_ASSIGNMENT_KEY);
        if (mismatch === 'key') intent.puzzleKey = 'campaign:3';
        if (mismatch === 'effect') intent.effectId = 'foreign-effect';
        if (mismatch === 'cell') intent.cell = '99,99';
        storage.set(KEYS.pendingHint, JSON.stringify(intent));
        expect(replayPendingLetterHint('campaign:2')).toBeNull();
        expect(useGame.getState().play.filled).toEqual({});
        expect(useGame.getState().hintsUsed).toEqual([]);
        expect(useCurrency.getState().coins).toBe(60);
      });
    },
  );

  test('failed free-intent cleanup still reveals the next letter once', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      assignIntroPackForCurrentProfile();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
      useGame.getState().start(getIntroLevel(2), 'normal');
      const remove = storage.remove.bind(storage);
      const failure = jest.spyOn(storage, 'remove').mockImplementation((key) => {
        if (key === KEYS.pendingHint) throw new Error('cleanup failed');
        return remove(key);
      });
      try {
        expect(revealLetter('campaign:2')).toBe('applied');
        expect(replayPendingLetterHint('campaign:2')).toBe('applied');
        expect(revealLetter('campaign:2')).toBe('applied');
        expect(useGame.getState().hintsUsed).toEqual(['bulb', 'bulb']);
        expect(useCurrency.getState().coins).toBe(60);
        expect(JSON.parse(storage.getString(KEYS.pendingHint)).status).toBe('applied');
      } finally {
        failure.mockRestore();
      }
    });
  });

  test.each(['daily', 'foreign-key', 'unassigned'] as const)('intro-looking %s content still pays coins', (variant) => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
      if (variant !== 'unassigned') assignIntroPackForCurrentProfile();
      const { useGame } = require('../store');
      const { useCurrency } = require('@/features/currency');
      const { revealLetter } = require('../hintJournal');
      const mode = variant === 'daily' ? 'daily' : 'normal';
      useGame.getState().start(getIntroLevel(2), mode, '2026-10-03');
      const key = variant === 'daily' ? 'daily:2026-10-03'
        : variant === 'foreign-key' ? 'campaign:99' : 'campaign:2';
      expect(revealLetter(key)).toBe('applied');
      expect(useCurrency.getState().coins).toBe(10);
    });
  });
});
