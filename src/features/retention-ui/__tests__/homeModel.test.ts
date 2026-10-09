import { homePlayLabel, nextHomePostcard, normalLevelProgress, pendingNormalResultLevel, shouldAutoOpenIntro } from '../homeModel';
import { routeCardProgress } from '@/features/collection/routeProgress';
import type { CollectibleView } from '@/features/retention';
import { serializeGame, type GameSnapshot } from '@/features/game/persistence';
import { initPlayState, type Level } from '@/core/engine/types';

const snapshot = {
  mode: 'normal',
  globalLevel: 3,
  solvedWords: ['КОТ'],
  filled: { '0,0': 'К' },
  completion: { status: 'playing' },
} as unknown as GameSnapshot;

describe('intro home decisions', () => {
  it('returns to a saved victory only when its content identity and filled board are verified', () => {
    const level: Level = {
      id: 5, globalId: 5, world: 'world1', contentVersion: 'test-v1', fingerprint: 'test:5',
      letters: ['к', 'о', 'т'], grid: { rows: 1, cols: 3, cells: [
        { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
      ] }, answers: [{ word: 'кот', dir: 'H', cells: [
        { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
      ] }], bonusPool: [], difficulty: 1,
    };
    const saved = serializeGame(level, {
      ...initPlayState(level), filled: { '0,0': 'к', '0,1': 'о', '0,2': 'т' }, solvedWords: ['кот'],
    }, level.letters, 'normal', { status: 'completion_pending' });
    const load = jest.fn((id: number) => id === 5 ? level : null);
    expect(pendingNormalResultLevel(saved, load)).toBe(5);
    expect(pendingNormalResultLevel({ ...saved, completion: { status: 'reward_claimed' } }, load)).toBe(5);
    expect(homePlayLabel(5, false, false, true)).toBe('Результат уровня 5');
    expect(pendingNormalResultLevel({ ...saved, completion: { status: 'finished' } }, load)).toBeNull();
    expect(pendingNormalResultLevel({ ...saved, levelFingerprint: 'foreign' }, load)).toBeNull();
    expect(pendingNormalResultLevel({ ...saved, contentVersion: 'foreign' }, load)).toBeNull();
    expect(pendingNormalResultLevel({ ...saved, filled: {} }, load)).toBeNull();
    expect(pendingNormalResultLevel({ ...saved, attemptId: '' }, load)).toBeNull();
    expect(pendingNormalResultLevel({ ...saved, mode: 'daily' }, load)).toBeNull();
    expect(pendingNormalResultLevel({ ...saved, globalLevel: Number.NaN }, load)).toBeNull();
  });

  it('shows the nearer journey reward rather than a later route background', () => {
    const route = { ...routeCardProgress(5)!, remaining: 5, nextCardTitle: 'Фон' };
    const next: CollectibleView = { id: 'journey-2', kind: 'journey', artId: 'test', title: 'Награда', image: 2, owned: false, seen: false, threshold: 9 };
    const first: CollectibleView = { ...next, id: 'journey-1', owned: true, threshold: 5 };
    const journey = { nextCollectibleId: next.id, remaining: 4, nextPostcardAt: 9, completedAfterAnchor: 5 };
    expect(nextHomePostcard(route, journey, [first, next])).toEqual({ title: 'Награда', image: 2, remaining: 4, fraction: 0 });
    expect(nextHomePostcard({ ...route, remaining: 3 }, journey, [first, next])?.title).toBe('Фон');
    expect(nextHomePostcard(null, { ...journey, nextCollectibleId: null }, [first, next])).toBeNull();
  });
  it('starts a new assigned player in the game but honors a manual menu exit', () => {
    expect(shouldAutoOpenIntro(true, 0, null)).toBe(true);
    expect(shouldAutoOpenIntro(true, 2, 'game')).toBe(true);
    expect(shouldAutoOpenIntro(true, 2, 'menu')).toBe(false);
    expect(shouldAutoOpenIntro(true, 5, 'game')).toBe(false);
    expect(shouldAutoOpenIntro(false, 0, null)).toBe(false);
  });

  it('shows real partial progress only for the current unfinished level', () => {
    expect(normalLevelProgress(snapshot, 3, 2)).toEqual({
      hasPartialProgress: true,
      label: 'Найдено слов: 1 из 2. Прогресс сохранён.',
    });
    expect(normalLevelProgress(snapshot, 4, 2).hasPartialProgress).toBe(false);
    expect(normalLevelProgress({ ...snapshot, completion: { status: 'finished' } }, 3, 2).hasPartialProgress).toBe(false);
    expect(homePlayLabel(3, true, false)).toBe('Продолжить — уровень 3');
    expect(homePlayLabel(6, false, false)).toBe('Играть — уровень 6');
  });
});
