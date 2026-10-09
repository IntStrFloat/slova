import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { landmarkUnlockedAt } from '@/core/config/worlds';
import { routeCardProgress } from '@/features/collection/routeProgress';
import { giftProgress } from '@/features/progression/store';

import { LevelComplete } from '../LevelComplete';

jest.mock('@/ui/Icon', () => ({ Icon: () => null }));

function showsCoinAmount(tree: ReactTestRenderer, amount: number): boolean {
  return tree.root.findAll((node) =>
    Array.isArray(node.props.children) && node.props.children.join('') === `+${amount}`).length > 0;
}

describe('campaign victory progress', () => {
  it('reveals the fifth-win postcard with a daily reason and separate campaign/daily choices', async () => {
    const card = landmarkUnlockedAt('world1', 5)!;
    const onNext = jest.fn();
    const onDaily = jest.fn(async () => false);
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<LevelComplete coins={0} introComplete heroImage={card.image} heroCaption={card.title} onNext={onNext} onDaily={onDaily} />);
    });
    expect(tree.root.findAllByProps({ accessibilityLabel: card.title }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Открыть' })).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Завтра вас ждёт');
    await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'Открыть кроссворд дня' })[0].props.onPress(); });
    expect(onDaily).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'Продолжить уровни' })[0].props.onPress(); });
    expect(onNext).toHaveBeenCalledTimes(1);
  });
  it('shows both next rewards and their remaining levels after a regular win', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <LevelComplete
          coins={0}
          cardProgress={routeCardProgress(1)}
          giftProgress={giftProgress(1)}
          onNext={jest.fn()}
        />,
      );
    });

    const labels = tree.root.findAll((node) => typeof node.props.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);
    expect(labels.some((label) => label.includes('Следующий фон') && label.includes('Осталось 4 уровня'))).toBe(true);
    expect(labels.some((label) => label.includes('Следующий подарок') && label.includes('Осталось 9 уровней'))).toBe(true);
    expect(labels).not.toContain('Уровень пройден');
    expect(tree.root.findAllByProps({ children: 'готово' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Далее' }).length).toBeGreaterThan(0);
    expect(showsCoinAmount(tree, 0)).toBe(false);
    expect(tree.root.findAllByProps({ children: 'монет' })).toHaveLength(0);
  });

  it('shows countdown first, then the earned postcard before advancing', async () => {
    const onNext = jest.fn();
    const card = landmarkUnlockedAt('world1', 5)!;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <LevelComplete
          coins={0}
          heroImage={card.image}
          heroCaption={card.title}
          cardProgress={routeCardProgress(5)}
          giftProgress={giftProgress(5)}
          nextLabel="На карту"
          onNext={onNext}
        />,
      );
    });

    expect(tree.root.findAllByProps({ accessibilityLabel: 'Открыть' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: card.title })).toHaveLength(0);
    await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'Открыть' })[0].props.onPress(); });
    expect(onNext).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ accessibilityLabel: card.title }).length).toBeGreaterThan(0);
    expect(showsCoinAmount(tree, 0)).toBe(false);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'На карту' }).length).toBeGreaterThan(0);
    await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'На карту' })[0].props.onPress(); });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('still shows coins earned from a route gift', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <LevelComplete
          coins={50}
          cardProgress={routeCardProgress(10)}
          giftProgress={giftProgress(10)}
          onNext={jest.fn()}
        />,
      );
    });
    expect(showsCoinAmount(tree, 50)).toBe(true);
    expect(tree.root.findAllByProps({ children: 'монет' }).length).toBeGreaterThan(0);
  });
});
