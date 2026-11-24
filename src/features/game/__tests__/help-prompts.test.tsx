import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import * as Reanimated from 'react-native-reanimated';

import type { Level } from '@/core/engine/types';

import { CompactBonusObjective } from '../CompactBonusObjective';
import { HintNudge } from '../HintNudge';

jest.mock('@/ui/Icon', () => ({ Icon: () => null }));

const chest: Level = {
  id: 20, globalId: 20, world: 'world1', letters: ['р', 'о', 'б', 'г'],
  grid: { rows: 1, cols: 3, cells: [] },
  answers: [{ word: 'рог', cells: [], dir: 'H' }],
  bonusPool: ['гроб'], rewardedBonus: ['гроб'], bonusTarget: 1,
  difficulty: 2, mechanic: 'bonus_chest',
};

describe('compact gameplay help', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps chest progress and the real earned reward while clue remains independently actionable', () => {
    const onCluePress = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CompactBonusObjective level={chest} foundBonus={1} bankUnits={3}
        clue="Подсказка" cluePrice={30} onCluePress={onCluePress} />);
    });
    const summaries = tree.root.findAll((node) => node.props.accessibilityRole === 'summary');
    expect(summaries[0].props.accessibilityLabel).toBe('Бонусный сундук. 1/1 бонусных слов, награда 30 монет, копилка 3 из 10.');
    const action = tree.root.findAllByProps({ accessibilityLabel: 'Смысловая наводка, 30 монет' })[0];
    expect(action.props.accessibilityLabel).toBe('Смысловая наводка, 30 монет');
    act(() => action.props.onPress());
    expect(onCluePress).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('does not imply a reward before the objective completes and labels an owned clue as free', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CompactBonusObjective level={chest} foundBonus={0}
        clue="Подсказка" cluePrice={0} clueOpen onCluePress={jest.fn()} />);
    });
    const summary = tree.root.findAll((node) => node.props.accessibilityRole === 'summary')[0];
    expect(summary.props.accessibilityLabel).not.toContain('награда');
    expect(summary.props.accessibilityLabel).toContain('0/1');
    const action = tree.root.findAllByProps({ accessibilityLabel: 'Смысловая наводка, бесплатно' })[0];
    expect(action).toBeDefined();
    expect(action.props.accessibilityState.expanded).toBe(true);
    act(() => tree.unmount());
  });

  it('does not expose a hidden nudge action and lets the visible nudge open the same hint', () => {
    const onPress = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<HintNudge visible={false} onPress={onPress} />); });
    expect(tree.toJSON()).toBeNull();
    act(() => { tree.update(<HintNudge visible onPress={onPress} />); });
    act(() => tree.root.findAllByProps({ accessibilityLabel: 'Не идёт слово? Попробуйте подсказку' })[0].props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => { tree.update(<HintNudge visible={false} onPress={onPress} />); });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  it('omits entrance and exit animation when reduced motion is enabled', () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<HintNudge visible onPress={jest.fn()} />); });
    const nudge = tree.root.findAllByProps({ testID: 'hint-nudge' })[0];
    expect(nudge.props.entering).toBeUndefined();
    expect(nudge.props.exiting).toBeUndefined();
    act(() => tree.unmount());
  });
});
