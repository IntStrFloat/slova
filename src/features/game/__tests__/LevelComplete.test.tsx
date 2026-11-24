import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler } from 'react-native';

import { landmarkUnlockedAt } from '@/core/config/worlds';
import { getFullscreenSnapshot, releaseFullscreen, tryAcquireFullscreen } from '@/core/fullscreen';
import { routeCardProgress } from '@/features/collection/routeProgress';
import { giftProgress } from '@/features/progression/store';
import { AppButton } from '@/ui';

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

describe('result menu navigation lock', () => {
  let tree: ReactTestRenderer | undefined;
  let hardwareBack: Parameters<typeof BackHandler.addEventListener>[1];

  beforeEach(() => {
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
      hardwareBack = listener;
      return { remove: jest.fn() };
    });
  });

  afterEach(() => {
    if (tree) act(() => tree!.unmount());
    tree = undefined;
    jest.restoreAllMocks();
  });

  function menuButton() {
    const button = tree!.root.findAll((node) =>
      node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === undefined
        && typeof node.props.onPress === 'function')[0];
    if (!button) throw new Error('Missing result menu button');
    return button;
  }

  function resultButton(label: string) {
    return tree!.root.findAllByProps({ accessibilityLabel: label })[0];
  }

  it.each(['menu button', 'hardware Back'] as const)(
    'restores result actions after %s refuses navigation during an update and the update is cancelled',
    async (source) => {
      const updateLease = tryAcquireFullscreen('update');
      expect(updateLease).not.toBeNull();
      const navigate = jest.fn();
      const onMenu = jest.fn(() => {
        if (getFullscreenSnapshot().owner !== null) return false;
        navigate();
        return true;
      });
      const onNext = jest.fn(() => false);
      const onDaily = jest.fn(() => false);
      const onDouble = jest.fn(async () => {});
      const onUpdate = jest.fn();

      try {
        await act(async () => {
          tree = TestRenderer.create(
            <LevelComplete coins={50} introComplete canDouble onMenu={onMenu} onNext={onNext}
              onDaily={onDaily} onDouble={onDouble}
              secondaryAction={<AppButton label="Обновить игру" onPress={onUpdate} />} />,
          );
        });
        await act(async () => {
          if (source === 'hardware Back') expect(hardwareBack()).toBe(true);
          else menuButton().props.onPress();
        });
        expect(onMenu).toHaveBeenCalledTimes(1);
        expect(navigate).not.toHaveBeenCalled();
        expect(releaseFullscreen(updateLease!)).toBe(true);

        expect(resultButton('Продолжить уровни').props.accessibilityState.disabled).toBe(false);
        expect(resultButton('Открыть кроссворд дня').props.accessibilityState.disabled).toBe(false);
        expect(resultButton('Удвоить монеты за уровень ×2').props.accessibilityState.disabled).toBe(false);
        expect(menuButton().props.accessibilityState.disabled).toBe(false);
        await act(async () => { resultButton('Обновить игру').props.onPress(); });
        expect(onUpdate).toHaveBeenCalledTimes(1);
        await act(async () => { resultButton('Продолжить уровни').props.onPress(); });
        expect(onNext).toHaveBeenCalledTimes(1);
        await act(async () => { resultButton('Открыть кроссворд дня').props.onPress(); });
        expect(onDaily).toHaveBeenCalledTimes(1);
        await act(async () => { resultButton('Удвоить монеты за уровень ×2').props.onPress(); });
        expect(onDouble).toHaveBeenCalledTimes(1);
        expect(showsCoinAmount(tree!, 50)).toBe(true);
        await act(async () => { menuButton().props.onPress(); });
        expect(navigate).toHaveBeenCalledTimes(1);
      } finally {
        releaseFullscreen(updateLease!);
      }
    },
  );

  it.each([
    ['explicit acceptance', (): boolean => true],
    ['legacy void', (): void => {}],
    ['legacy asynchronous void', async (): Promise<void> => {}],
  ] as const)('keeps actions locked until unmount after %s', async (_label, outcome) => {
    const onMenu = jest.fn(() => outcome());
    const onNext = jest.fn();
    await act(async () => {
      tree = TestRenderer.create(<LevelComplete coins={0} onMenu={onMenu} onNext={onNext}
        secondaryAction={<AppButton label="Обновить игру" onPress={jest.fn()} />} />);
    });
    await act(async () => { menuButton().props.onPress(); });
    expect(resultButton('Далее').props.accessibilityState.disabled).toBe(true);
    expect(menuButton().props.accessibilityState.disabled).toBe(true);
    expect(tree!.root.findAllByProps({ accessibilityLabel: 'Обновить игру' })).toHaveLength(0);
    await act(async () => {
      menuButton().props.onPress();
      expect(hardwareBack()).toBe(true);
    });
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('blocks repeated navigation while an async menu decision is pending, then unlocks on false', async () => {
    let resolve!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    const onMenu = jest.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(true);
    await act(async () => {
      tree = TestRenderer.create(<LevelComplete coins={0} onMenu={onMenu} onNext={jest.fn()}
        secondaryAction={<AppButton label="Обновить игру" onPress={jest.fn()} />} />);
    });
    await act(async () => { menuButton().props.onPress(); });
    expect(resultButton('Далее').props.accessibilityState.disabled).toBe(true);
    expect(tree!.root.findAllByProps({ accessibilityLabel: 'Обновить игру' })).toHaveLength(0);
    await act(async () => {
      menuButton().props.onPress();
      expect(hardwareBack()).toBe(true);
    });
    expect(onMenu).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(false); });
    expect(resultButton('Далее').props.accessibilityState.disabled).toBe(false);
    expect(menuButton().props.accessibilityState.disabled).toBe(false);
    expect(resultButton('Обновить игру').props.accessibilityState.disabled).toBe(false);
    await act(async () => { expect(hardwareBack()).toBe(true); });
    expect(onMenu).toHaveBeenCalledTimes(2);
    expect(resultButton('Далее').props.accessibilityState.disabled).toBe(true);
  });

  it.each([
    ['synchronous failure', () => { throw new Error('Navigation unavailable'); }],
    ['asynchronous rejection', async () => { throw new Error('Navigation unavailable'); }],
  ] as const)('restores result actions after %s', async (_label, outcome) => {
    const onMenu = jest.fn(() => outcome());
    const onNext = jest.fn();
    await act(async () => {
      tree = TestRenderer.create(<LevelComplete coins={0} onMenu={onMenu} onNext={onNext}
        secondaryAction={<AppButton label="Обновить игру" onPress={jest.fn()} />} />);
    });
    await act(async () => { menuButton().props.onPress(); });
    expect(resultButton('Далее').props.accessibilityState.disabled).toBe(false);
    expect(menuButton().props.accessibilityState.disabled).toBe(false);
    expect(resultButton('Обновить игру').props.accessibilityState.disabled).toBe(false);
    await act(async () => { resultButton('Далее').props.onPress(); });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(resultButton('Далее').props.accessibilityState.disabled).toBe(true);
    await act(async () => { expect(hardwareBack()).toBe(true); });
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
