import { MARATHON } from '@/core/config/marathon';
import { makeInitialSnapshot, productDayAt, type RetentionSnapshot } from '@/features/retention/model';

import {
  makeInitialMarathonSnapshot, marathonFinalRewardId, marathonStageRewardId,
  reduceMarathonCompletion, reduceMarathonRecovery, type MarathonCompletionAction,
} from '../model';
import { getMarathonStatus } from '../selectors';

const day = MARATHON.startDay;
const start = MARATHON.startAtMs;

function campaign(puzzleKey: string, at = start): MarathonCompletionAction {
  return { mode: 'campaign', puzzleKey, actionDay: productDayAt(at), completedAtMs: at };
}

function proof(action: MarathonCompletionAction) {
  return {
    campaignCompletions: action.mode === 'campaign' ? { [action.puzzleKey]: action.actionDay } : {},
    dailyCompletions: action.mode === 'daily' ? { [action.puzzleKey]: action.actionDay } : {},
  };
}

describe('shared word marathon', () => {
  test.each([
    [start - 1, false], [start, true], [MARATHON.endAtMs - 1, true], [MARATHON.endAtMs, false],
  ])('uses exact inclusive start and exclusive end: %s', (at, accepted) => {
    const action = campaign('1', at);
    const result = reduceMarathonCompletion(makeInitialMarathonSnapshot(), action, proof(action));
    expect(result.accepted).toBe(accepted);
    expect(Object.keys(result.snapshot.completions)).toHaveLength(accepted ? 1 : 0);
  });

  test('Moscow boundaries are pinned independently of the device calendar', () => {
    expect(start).toBe(Date.parse('2026-10-25T21:00:00.000Z'));
    expect(MARATHON.endAtMs).toBe(Date.parse('2026-11-01T21:00:00.000Z'));
    const action = campaign('1');
    expect(action.actionDay).toBe('2026-10-26');
    expect(() => reduceMarathonCompletion(makeInitialMarathonSnapshot(), {
      ...action, actionDay: '2026-10-25',
    }, proof(action))).toThrow('timestamp and product day disagree');
  });

  test('newcomers participate on their very first campaign win without unlocking retention gates', () => {
    const retention = makeInitialSnapshot({ newProfile: true });
    retention.campaignCompletions['1'] = day;
    const original = JSON.stringify(retention);
    const result = reduceMarathonCompletion(makeInitialMarathonSnapshot(), campaign('1'), retention);
    expect(result.accepted).toBe(true);
    expect(result.snapshot.claimedTiers).toEqual([1]);
    expect(result.effects).toEqual([{ id: marathonStageRewardId(1), kind: 'coins', amount: 10, source: 'marathon' }]);
    expect(JSON.stringify(retention)).toBe(original);
  });

  test('replaying a stable puzzle key replays only that puzzle reward, with no additional progress', () => {
    const action = campaign('1');
    const first = reduceMarathonCompletion(makeInitialMarathonSnapshot(), action, proof(action));
    const secondAction = campaign('2');
    const second = reduceMarathonCompletion(first.snapshot, secondAction, proof(secondAction));
    expect(second.effects).toEqual([]);
    expect(reduceMarathonCompletion(second.snapshot, action, proof(action))).toEqual({
      snapshot: second.snapshot, accepted: false, effects: first.effects,
    });
    expect(reduceMarathonCompletion(second.snapshot, secondAction, proof(secondAction)).effects).toEqual([]);
    expect(Object.keys(second.snapshot.completions)).toHaveLength(2);
  });

  test('rejects missing or old first-completion evidence and an archive daily', () => {
    const empty = makeInitialMarathonSnapshot();
    const action = campaign('4');
    for (const completedDay of [undefined, 'legacy', '2026-10-25', '2026-11-02']) {
      const retention: Pick<RetentionSnapshot, 'campaignCompletions' | 'dailyCompletions'> = {
        campaignCompletions: completedDay ? { '4': completedDay } : {}, dailyCompletions: {},
      };
      expect(reduceMarathonCompletion(empty, action, retention).accepted).toBe(false);
    }
    const archive: MarathonCompletionAction = { mode: 'daily', puzzleKey: '2026-10-25', actionDay: day, completedAtMs: start };
    expect(reduceMarathonCompletion(empty, archive, proof(archive)).accepted).toBe(false);
    const today = { ...archive, puzzleKey: day };
    expect(reduceMarathonCompletion(empty, today, proof(today)).accepted).toBe(true);
    expect(() => reduceMarathonCompletion(empty, { ...today, puzzleDay: '2026-10-25' }, proof(today))).toThrow('dates disagree');
  });

  test('seven cumulative stages can all be completed on one day and grant exactly 150 coins', () => {
    let snapshot = makeInitialMarathonSnapshot();
    for (let id = 1; id <= 25; id++) {
      const action = campaign(String(id));
      const result = reduceMarathonCompletion(snapshot, action, proof(action));
      snapshot = result.snapshot;
      const threshold = MARATHON.thresholds.find((target) => target === id);
      expect(result.effects.reduce((sum, effect) => sum + (effect.amount ?? 0), 0)).toBe(id === 21 ? 90 : threshold ? 10 : 0);
    }
    expect(snapshot.claimedTiers).toEqual([1, 3, 6, 9, 13, 17, 21]);
    expect(Object.values(snapshot.pendingCoinGrants).reduce((sum, amount) => sum + amount, 0)).toBe(150);
    expect(snapshot.rewardGrants[marathonFinalRewardId()].amount).toBe(80);
    expect(getMarathonStatus(snapshot, start).tiers[6]).toMatchObject({ target: 21, rewardCoins: 90, completed: true, remaining: 0 });
  });

  test('recovery after expiry uses real first-completion dates and preserves other events and grants', () => {
    const retention = makeInitialSnapshot({ newProfile: false });
    retention.campaignCompletions = { '1': 'legacy', '2': '2026-10-25', '3': day, '4': day, '5': day, '6': '2026-11-02' };
    retention.dailyCompletions = { '2026-10-27': '2026-10-27', '2026-10-28': '2026-10-29' };
    retention.eventInstances.existing = { id: 'existing', startDay: day, endDay: MARATHON.endDay, points: 25, tiers: [] };
    retention.ownedCollectibles.existing = { source: 'event', earnedDay: day };
    retention.rewardGrants.existing = { id: 'existing', kind: 'coins', amount: 10, source: 'week' };
    const original = JSON.stringify(retention);
    const first = reduceMarathonRecovery(makeInitialMarathonSnapshot(), retention);
    expect(Object.keys(first.snapshot.completions)).toEqual(['campaign:3', 'campaign:4', 'campaign:5', 'daily:2026-10-27']);
    expect(first.effects.map((reward) => reward.id)).toEqual([marathonStageRewardId(1), marathonStageRewardId(3)]);
    expect(getMarathonStatus(first.snapshot, MARATHON.endAtMs + 86_400_000)).toMatchObject({ status: 'ended', completionCount: 4, earnedCoins: 20 });
    expect(reduceMarathonRecovery(first.snapshot, retention)).toEqual({ snapshot: first.snapshot, accepted: false, effects: [] });
    expect(JSON.stringify(retention)).toBe(original);
  });

  test('UI exposes all stages before launch, during the window and after expiry', () => {
    const snapshot = makeInitialMarathonSnapshot();
    expect(getMarathonStatus(snapshot, start - 1).status).toBe('upcoming');
    expect(getMarathonStatus(snapshot, start).status).toBe('active');
    expect(getMarathonStatus(snapshot, MARATHON.endAtMs).status).toBe('ended');
    expect(getMarathonStatus(snapshot, start)).toMatchObject({
      id: MARATHON.id, title: 'Марафон слов', completionCount: 0, earnedCoins: 0, totalRewardCoins: 150,
      startDay: '2026-10-26', endDay: '2026-11-02',
    });
    expect(getMarathonStatus(snapshot, start).tiers.map((tier) => tier.remaining)).toEqual([1, 3, 6, 9, 13, 17, 21]);
  });
});
