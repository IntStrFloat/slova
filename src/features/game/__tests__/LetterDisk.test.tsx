/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { colors } from '@/ui';

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const liveProps = (compute: () => Record<string, unknown>) => new Proxy({}, {
    get: (_target, key: string) => compute()[key],
    ownKeys: () => Object.keys(compute()),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
  return {
    ...require('react-native-reanimated/mock'),
    useReducedMotion: () => false,
    // UI shared values persist through the React updates caused by letter changes.
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(null);
      if (ref.current === null) {
        let value = initial;
        ref.current = {
          get value() { return value; },
          set value(next: unknown) { value = next; },
          get: () => value,
          set: (next: unknown) => {
            value = typeof next === 'function' ? next(value) : next;
          },
        };
      }
      return ref.current;
    },
    useDerivedValue: (compute: () => unknown) => ({ get: compute }),
    // UI SVG props and native view styles update without a React render.
    useAnimatedProps: liveProps,
    useAnimatedStyle: liveProps,
  };
});

jest.mock('react-native-worklets', () => ({
  ...require('react-native-worklets/src/mock'),
  scheduleOnRN: jest.fn((callback: (...args: any[]) => unknown, ...args: any[]) => callback(...args)),
}));

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/ui', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    AppText: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(Text, props, children),
    Icon: () => null,
    colors: {
      success: '#3FD27E',
      amber: '#EBA63D',
      onAmber: '#13202F',
      danger: '#FF6B6B',
      glassStrong: 'rgba(14,22,36,0.72)',
      glass: 'rgba(18,28,44,0.50)',
      gridHint: '#FFD37A',
      tileShadow: 'rgba(6,11,20,0.45)',
      tileActive: '#EBA63D',
      tile: '#FFFDF7',
      tileInk: '#13202F',
      linkLine: '#FFFFFF',
      goldBorder: '#FFE052',
      text: '#FFFFFF',
    },
    fonts: { tile: 'System' },
    radius: { pill: 999 },
  };
});

import { LetterDisk } from '../LetterDisk';
import { useGame } from '../store';

jest.mock('react-native-gesture-handler', () => {
  const handlers: Record<string, Record<string, (...args: any[]) => void>> = {};
  const make = (name: string) => {
    const callbacks: Record<string, (...args: any[]) => void> = {};
    handlers[name] = callbacks;
    const chain: Record<string, any> = {};
    for (const method of ['runOnJS', 'minDistance', 'maxDistance', 'maxDuration', 'shouldCancelWhenOutside']) {
      chain[method] = () => chain;
    }
    for (const method of ['onBegin', 'onTouchesDown', 'onTouchesMove', 'onTouchesUp', 'onFinalize', 'onStart', 'onUpdate', 'onEnd']) {
      chain[method] = (callback: (...args: any[]) => void) => {
        callbacks[method] = callback;
        return chain;
      };
    }
    return chain;
  };

  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: {
      Pan: () => make('pan'),
      Tap: () => make('tap'),
      Race: (...gestures: unknown[]) => gestures[0],
    },
    __gestureHandlers: handlers,
  };
});

jest.mock('@/features/audio', () => ({
  playSfx: jest.fn(),
}));

function pressByLabel(tree: ReactTestRenderer, label: string) {
  const node = tree.root.find((item) => item.props.accessibilityLabel === label);
  act(() => {
    node.props.onPress();
  });
}

function findByLabel(tree: ReactTestRenderer, label: string): ReactTestInstance {
  return tree.root.find((item) => item.props.accessibilityLabel === label);
}

function findText(tree: ReactTestRenderer, text: string): ReactTestInstance {
  return tree.root.find((node) => typeof node.props.children === 'string' && node.props.children === text);
}

function animatedSvgProps(tree: ReactTestRenderer, testID: string): Record<string, any> {
  const node = tree.root.findAllByProps({ testID }).find((item) => item.props.animatedProps);
  expect(node).toBeDefined();
  return { ...node!.props, ...node!.props.animatedProps };
}

function animatedViewStyle(tree: ReactTestRenderer, testID: string): Record<string, any> {
  const node = tree.root.findAllByProps({ testID }).find((item) => item.props.style);
  expect(node).toBeDefined();
  return StyleSheet.flatten(node!.props.style);
}

function transformValue(style: Record<string, any>, name: string) {
  return style.transform?.find((item: Record<string, any>) => name in item)?.[name];
}

function fingerTrailProps(tree: ReactTestRenderer): Record<string, any> {
  const bar = animatedViewStyle(tree, 'finger-trail');
  const start = animatedViewStyle(tree, 'finger-trail-start');
  const end = animatedViewStyle(tree, 'finger-trail-end');
  const capCenter = (style: Record<string, any>) => ({
    x: (style.left ?? 0) + style.width / 2 + (transformValue(style, 'translateX') ?? 0),
    y: (style.top ?? 0) + style.height / 2 + (transformValue(style, 'translateY') ?? 0),
  });
  const from = capCenter(start);
  const to = capCenter(end);
  if (bar.opacity === 1) {
    // Prove the visible native rectangle meets both caps, rather than only
    // checking moving cap positions while a stale rectangle remains behind.
    const centerX = (bar.left ?? 0) + bar.width / 2 + (transformValue(bar, 'translateX') ?? 0);
    const centerY = (bar.top ?? 0) + bar.height / 2 + (transformValue(bar, 'translateY') ?? 0);
    const rotate = transformValue(bar, 'rotate') ?? transformValue(bar, 'rotateZ') ?? '0rad';
    const angle = parseFloat(rotate) * (String(rotate).endsWith('deg') ? Math.PI / 180 : 1);
    const length = bar.width * (transformValue(bar, 'scaleX') ?? 1);
    expect(centerX).toBeCloseTo((from.x + to.x) / 2);
    expect(centerY).toBeCloseTo((from.y + to.y) / 2);
    expect(centerX - Math.cos(angle) * length / 2).toBeCloseTo(from.x);
    expect(centerY - Math.sin(angle) * length / 2).toBeCloseTo(from.y);
    expect(centerX + Math.cos(angle) * length / 2).toBeCloseTo(to.x);
    expect(centerY + Math.sin(angle) * length / 2).toBeCloseTo(to.y);
  }
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y,
    opacity: bar.opacity, backgroundColor: bar.backgroundColor };
}

function diskTouches() {
  const center = 130;
  const radius = center - Math.max(21, Math.min(34, 260 * 0.106)) - 10;
  return [
    { id: 1, x: center, y: center - radius },
    { id: 1, x: center + Math.sin(Math.PI / 3) * radius, y: center + radius / 2 },
    { id: 1, x: center - Math.sin(Math.PI / 3) * radius, y: center + radius / 2 },
  ];
}

describe('LetterDisk accessibility controls', () => {
  const rendered: ReactTestRenderer[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    rendered.length = 0;
    useGame.setState({
      play: null,
      level: null,
      mode: 'normal',
      coins: 0,
      disk: [],
      lastResult: null,
      completion: { status: 'playing' },
      snapshot: null,
      hintsUsed: [],
    });
  });

  afterEach(() => {
    rendered.splice(0).forEach((tree) => {
      act(() => {
        tree.unmount();
      });
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test('collects letters via accessible buttons and confirms the word', () => {
    const onWord = jest.fn((word: string) => {
      useGame.setState({
        lastResult: {
          kind: 'grid',
          word,
          cells: [],
          deltaCoins: 5,
          levelComplete: false,
        },
      });
      return 'grid' as const;
    });

    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);

    pressByLabel(tree, 'Буква К, позиция 1 из 3.');
    pressByLabel(tree, 'Буква О, позиция 2 из 3.');
    pressByLabel(tree, 'Буква Т, позиция 3 из 3.');
    pressByLabel(tree, 'Убрать последнюю букву.');
    pressByLabel(tree, 'Буква Т, позиция 3 из 3.');

    expect(findText(tree, 'Назад')).toBeTruthy();
    expect(findText(tree, 'Готово')).toBeTruthy();
    expect(findText(tree, 'Сброс')).toBeTruthy();

    const confirm = findByLabel(tree, 'Подтвердить слово КОТ.');
    expect(confirm.props.accessibilityState.disabled).toBe(false);

    act(() => {
      confirm.props.onPress();
    });

    expect(onWord).toHaveBeenCalledWith('кот');
    expect(findText(tree, 'Слово в сетке')).toBeTruthy();
    expect(findText(tree, 'Слово КОТ добавлено в сетку.')).toBeTruthy();
  });

  test('places a free shuffle action in the disk center and clears it during selection', () => {
    const onShuffle = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={jest.fn(() => 'grid')} onShuffle={onShuffle} size={260} />);
    });
    rendered.push(tree);
    const shuffle = findByLabel(tree, 'Перемешать буквы бесплатно');
    const style = shuffle.props.style({ pressed: false });
    expect(style[1].left).toBe(102);
    expect(style[1].top).toBe(102);
    pressByLabel(tree, 'Перемешать буквы бесплатно');
    expect(onShuffle).toHaveBeenCalledTimes(1);
    pressByLabel(tree, 'Буква К, позиция 1 из 3.');
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Перемешать буквы бесплатно')).toHaveLength(0);
  });

  test('ignores the previous result tap briefly, then accepts a deliberate new selection', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} interactionGuardMs={350} />);
    });
    rendered.push(tree);

    pressByLabel(tree, 'Буква К, позиция 1 из 3.');
    expect(tree.root.findAll((item) => item.props.accessibilityLabel === 'Подтвердить слово К.')).toHaveLength(0);

    act(() => { jest.advanceTimersByTime(351); });
    pressByLabel(tree, 'Буква К, позиция 1 из 3.');
    expect(findByLabel(tree, 'Подтвердить слово К.')).toBeTruthy();
    expect(onWord).not.toHaveBeenCalled();
  });

  test('shows ordered constraint feedback and clears the current selection', () => {
    const onWord = jest.fn((word: string) => {
      useGame.setState({
        lastResult: {
          kind: 'constraint',
          word,
          reason: 'wrong_order',
          expectedLength: 3,
        },
      });
      return 'constraint' as const;
    });

    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['т', 'о', 'к']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);

    pressByLabel(tree, 'Буква Т, позиция 1 из 3.');
    pressByLabel(tree, 'Буква О, позиция 2 из 3.');
    pressByLabel(tree, 'Буква К, позиция 3 из 3.');
    pressByLabel(tree, 'Подтвердить слово ТОК.');

    expect(findText(tree, 'Сначала слово из 3 букв')).toBeTruthy();
    expect(findText(tree, 'Сначала нужно слово из 3 букв.')).toBeTruthy();

    const amberPill = tree.root.find(
      (node) => node.props.style?.backgroundColor === colors.amber,
    );
    expect(amberPill).toBeTruthy();

    pressByLabel(tree, 'Буква Т, позиция 1 из 3.');
    pressByLabel(tree, 'Буква О, позиция 2 из 3.');
    pressByLabel(tree, 'Очистить выбор.');

    expect(
      tree.root.findAll((node) => node.props.accessibilityLabel === 'Подтвердить слово.'),
    ).toHaveLength(0);
  });

  test('tap input retains prior letters and allows backtracking one tile', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);
    const { __gestureHandlers } = require('react-native-gesture-handler');
    const tap = __gestureHandlers.tap;
    const pan = __gestureHandlers.pan;
    const radius = 130 - Math.max(21, Math.min(34, 260 * 0.106)) - 10;
    const points = [
      { x: 130, y: 130 - radius },
      { x: 130 + Math.sin(Math.PI / 3) * radius, y: 130 + radius / 2 },
      { x: 130 - Math.sin(Math.PI / 3) * radius, y: 130 + radius / 2 },
    ];
    const touch = (index: number) => {
      const point = points[index];
      act(() => {
        pan.onTouchesDown({ changedTouches: [{ id: index + 1, ...point }] });
        tap.onBegin();
        tap.onTouchesDown({ numberOfTouches: 1 });
        pan.onTouchesUp({ changedTouches: [{ id: index + 1, ...point }] });
        tap.onEnd({ ...point, numberOfPointers: 1 }, true);
        pan.onFinalize({}, false);
      });
    };

    touch(0);
    touch(1);
    touch(2);
    expect(findByLabel(tree, 'Подтвердить слово КОТ.')).toBeTruthy();
    act(() => {
      tap.onBegin();
      tap.onTouchesDown({ numberOfTouches: 1 });
      tap.onTouchesDown({ numberOfTouches: 2 });
      tap.onEnd({ ...points[0], numberOfPointers: 1 }, true);
    });
    expect(findByLabel(tree, 'Подтвердить слово КОТ.')).toBeTruthy();
    touch(1);
    expect(findByLabel(tree, 'Подтвердить слово КО.')).toBeTruthy();
    touch(2);
    pressByLabel(tree, 'Подтвердить слово КОТ.');
    expect(onWord).toHaveBeenCalledTimes(1);
    expect(onWord).toHaveBeenCalledWith('кот');
  });

  test('drag follows only the first pointer, backtracks, and submits outside the disk once', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);
    const { __gestureHandlers } = require('react-native-gesture-handler');
    const pan = __gestureHandlers.pan;
    const radius = 130 - Math.max(21, Math.min(34, 260 * 0.106)) - 10;
    const p0 = { id: 1, x: 130, y: 130 - radius };
    const p1 = { id: 1, x: 130 + Math.sin(Math.PI / 3) * radius, y: 130 + radius / 2 };
    const p2 = { id: 1, x: 130 - Math.sin(Math.PI / 3) * radius, y: 130 + radius / 2 };
    act(() => {
      pan.onTouchesDown({ changedTouches: [p0] });
      pan.onStart({ ...p0, numberOfPointers: 1 });
      pan.onTouchesMove({ allTouches: [p1] });
      pan.onTouchesMove({ allTouches: [p2] });
      pan.onTouchesMove({ allTouches: [p1] });
      pan.onTouchesMove({ allTouches: [p2] });
      pan.onTouchesDown({ changedTouches: [{ id: 2, x: p0.x, y: p0.y }] });
      pan.onTouchesMove({ allTouches: [p2, { id: 2, x: p0.x, y: p0.y }] });
      pan.onUpdate({ ...p0, numberOfPointers: 2 });
      pan.onTouchesUp({ changedTouches: [{ id: 1, x: 400, y: 400 }] });
      pan.onEnd({ numberOfPointers: 1 });
      pan.onFinalize({}, true);
    });

    expect(onWord).toHaveBeenCalledTimes(1);
    expect(onWord).toHaveBeenCalledWith('кот');
  });

  test('the live trail follows the pointer between letters without scheduling React updates', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);
    const pan = require('react-native-gesture-handler').__gestureHandlers.pan;
    const scheduleOnRN = require('react-native-worklets').scheduleOnRN as jest.Mock;
    const playSfx = require('@/features/audio').playSfx as jest.Mock;
    const [first] = diskTouches();
    act(() => {
      pan.onTouchesDown({ changedTouches: [first], allTouches: [first], numberOfTouches: 1 });
      pan.onStart({ ...first, numberOfPointers: 1 });
    });
    expect(findByLabel(tree, 'Выбрано 1 буква. Текущее слово: К.')).toBeTruthy();
    scheduleOnRN.mockClear();
    playSfx.mockClear();
    const timing = jest.spyOn(require('react-native-reanimated'), 'withTiming');
    try {
      for (const point of [{ x: 160, y: 85 }, { x: 150, y: 90 }, { x: 140, y: 95 }]) {
        act(() => {
          pan.onTouchesMove({ allTouches: [{ id: 1, ...point }], numberOfTouches: 1 });
          pan.onUpdate({ ...point, numberOfPointers: 1 });
        });
        const trail = fingerTrailProps(tree);
        expect(trail.x1).toBeCloseTo(first.x);
        expect(trail.y1).toBeCloseTo(first.y);
        expect(trail.x2).toBe(point.x);
        expect(trail.y2).toBe(point.y);
        expect(trail.opacity).toBe(1);
      }
      expect(timing).not.toHaveBeenCalled();
    } finally {
      timing.mockRestore();
    }
    expect(scheduleOnRN).not.toHaveBeenCalled();
    expect(playSfx).not.toHaveBeenCalled();
    expect(onWord).not.toHaveBeenCalled();
    expect(findByLabel(tree, 'Выбрано 1 буква. Текущее слово: К.')).toBeTruthy();
  });

  test('secondary fingers cannot move the trail or take over after the primary release', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);
    const pan = require('react-native-gesture-handler').__gestureHandlers.pan;
    const [first, second, third] = diskTouches();
    const primary = { id: 1, x: 150, y: 100 };
    const secondary = { ...third, id: 2 };
    act(() => {
      pan.onTouchesDown({ changedTouches: [first], allTouches: [first], numberOfTouches: 1 });
      pan.onStart({ ...first, numberOfPointers: 1 });
      pan.onTouchesDown({ changedTouches: [secondary], allTouches: [primary, secondary], numberOfTouches: 2 });
      pan.onTouchesMove({ allTouches: [secondary, primary], numberOfTouches: 2 });
      pan.onUpdate({ ...secondary, numberOfPointers: 2 });
    });
    expect(fingerTrailProps(tree)).toMatchObject({ x2: primary.x, y2: primary.y });
    expect(findByLabel(tree, 'Выбрано 1 буква. Текущее слово: К.')).toBeTruthy();
    act(() => {
      pan.onTouchesMove({ allTouches: [second, secondary], numberOfTouches: 2 });
      pan.onTouchesMove({ allTouches: [third, secondary], numberOfTouches: 2 });
      pan.onTouchesUp({ changedTouches: [third], allTouches: [secondary], numberOfTouches: 1 });
      pan.onTouchesMove({ allTouches: [{ ...first, id: 2 }], numberOfTouches: 1 });
      pan.onUpdate({ ...first, numberOfPointers: 1 });
      pan.onEnd({ numberOfPointers: 1 });
      pan.onFinalize({}, true);
    });
    expect(onWord).toHaveBeenCalledTimes(1);
    expect(onWord).toHaveBeenCalledWith('кот');
    expect(fingerTrailProps(tree).opacity).toBe(0);
  });

  test('trail and completed connections use the same opaque gold stroke as the letter outline', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={jest.fn(() => 'grid')} size={260} />);
    });
    rendered.push(tree);
    const pan = require('react-native-gesture-handler').__gestureHandlers.pan;
    const [first, second] = diskTouches();
    act(() => {
      pan.onTouchesDown({ changedTouches: [first], allTouches: [first], numberOfTouches: 1 });
      pan.onStart({ ...first, numberOfPointers: 1 });
      pan.onTouchesMove({ allTouches: [second], numberOfTouches: 1 });
      pan.onTouchesMove({ allTouches: [{ id: 1, x: 150, y: 115 }], numberOfTouches: 1 });
    });
    const trail = fingerTrailProps(tree);
    const connection = animatedSvgProps(tree, 'selection-connection-0');
    const outline = animatedViewStyle(tree, 'selection-outline-0');
    expect(trail.backgroundColor).toBe(colors.goldBorder);
    expect(trail.opacity).toBe(1);
    expect(outline.backgroundColor).toBe(trail.backgroundColor);
    expect(outline.borderColor).toBe(trail.backgroundColor);
    expect(outline.opacity).toBe(1);
    expect(outline.left + outline.width / 2).toBeCloseTo(first.x);
    expect(outline.top + outline.height / 2).toBeCloseTo(first.y);
    expect(outline.borderRadius).toBe(outline.width / 2);
    expect(connection.stroke).toBe(outline.borderColor);
    expect(connection.strokeOpacity ?? 1).toBe(1);
    expect(connection.opacity).toBe(1);
    expect(connection.x1).toBeCloseTo(first.x);
    expect(connection.y1).toBeCloseTo(first.y);
    expect(connection.x2).toBeCloseTo(second.x);
    expect(connection.y2).toBeCloseTo(second.y);
  });

  test('letter fill and native trail stay the same opaque gold while the entry animation begins', () => {
    const reanimated = require('react-native-reanimated');
    const timing = jest.spyOn(reanimated, 'withTiming').mockImplementation((target: unknown) =>
      Array.isArray(target) ? target.map(() => 0) : target);
    try {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={jest.fn(() => 'grid')} size={260} />);
      });
      rendered.push(tree);
      const pan = require('react-native-gesture-handler').__gestureHandlers.pan;
      const [first] = diskTouches();
      act(() => {
        pan.onTouchesDown({ changedTouches: [first], allTouches: [first], numberOfTouches: 1 });
        pan.onStart({ ...first, numberOfPointers: 1 });
        pan.onTouchesMove({ allTouches: [{ id: 1, x: 150, y: 100 }], numberOfTouches: 1 });
      });
      const highlight = animatedViewStyle(tree, 'selection-outline-0');
      expect(highlight.backgroundColor).toBe(colors.goldBorder);
      expect(highlight.borderColor).toBe(colors.goldBorder);
      expect(highlight.opacity).toBe(1);
      expect(highlight.width).toBeGreaterThan(0);
      expect(highlight.height).toBe(highlight.width);
      expect(transformValue(highlight, 'scale')).toBeCloseTo(0.92);
      for (const testID of ['finger-trail', 'finger-trail-start', 'finger-trail-end']) {
        const style = animatedViewStyle(tree, testID);
        expect(style.backgroundColor).toBe(highlight.backgroundColor);
        expect(style.opacity ?? 1).toBe(1);
      }
      expect(fingerTrailProps(tree)).toMatchObject({ x2: 150, y2: 100, opacity: 1 });
    } finally {
      timing.mockRestore();
    }
  });

  test('cancelling an active drag hides the finger trail and never submits the word', () => {
    const onWord = jest.fn(() => 'grid' as const);
    const onEnd = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord}
        onUserInteractionEnd={onEnd} size={260} />);
    });
    rendered.push(tree);
    const pan = require('react-native-gesture-handler').__gestureHandlers.pan;
    const [first, second, third] = diskTouches();
    act(() => {
      pan.onTouchesDown({ changedTouches: [first], allTouches: [first], numberOfTouches: 1 });
      pan.onStart({ ...first, numberOfPointers: 1 });
      pan.onTouchesMove({ allTouches: [second], numberOfTouches: 1 });
      pan.onTouchesMove({ allTouches: [third], numberOfTouches: 1 });
      pan.onTouchesMove({ allTouches: [{ id: 1, x: 150, y: 115 }], numberOfTouches: 1 });
    });
    expect(fingerTrailProps(tree).opacity).toBe(1);
    act(() => {
      pan.onFinalize({}, false);
    });
    expect(fingerTrailProps(tree).opacity).toBe(0);
    expect(onWord).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test('a queued release cannot submit after the disk unmounts', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} size={260} />);
    });
    rendered.push(tree);
    const pan = require('react-native-gesture-handler').__gestureHandlers.pan;
    const scheduleOnRN = require('react-native-worklets').scheduleOnRN as jest.Mock;
    const [first, second, third] = diskTouches();
    act(() => {
      pan.onTouchesDown({ changedTouches: [first], allTouches: [first], numberOfTouches: 1 });
      pan.onStart({ ...first, numberOfPointers: 1 });
      pan.onTouchesMove({ allTouches: [second], numberOfTouches: 1 });
      pan.onTouchesMove({ allTouches: [third], numberOfTouches: 1 });
    });
    expect(findByLabel(tree, 'Выбрано 3 буквы. Текущее слово: КОТ.')).toBeTruthy();
    const queued: (() => void)[] = [];
    scheduleOnRN.mockImplementation((callback: (...args: any[]) => unknown, ...args: any[]) => {
      queued.push(() => callback(...args));
    });
    try {
      act(() => {
        pan.onTouchesUp({ changedTouches: [third], allTouches: [], numberOfTouches: 0 });
        pan.onEnd({ numberOfPointers: 0 });
        pan.onFinalize({}, true);
      });
      expect(queued.length).toBeGreaterThan(0);
      expect(onWord).not.toHaveBeenCalled();
      act(() => { tree.unmount(); });
      rendered.splice(rendered.indexOf(tree), 1);
      act(() => { queued.forEach((callback) => callback()); });
      expect(onWord).not.toHaveBeenCalled();
    } finally {
      scheduleOnRN.mockImplementation((callback: (...args: any[]) => unknown, ...args: any[]) => callback(...args));
    }
  });

  test('decorative demo never submits and is cancelled by the first real touch', () => {
    const onWord = jest.fn(() => 'grid' as const);
    const onUserInteraction = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <LetterDisk
          letters={['к', 'о', 'т']}
          onWord={onWord}
          size={260}
          demoWord="кот"
          demoRequestId={1}
          onUserInteraction={onUserInteraction}
        />,
      );
    });
    rendered.push(tree);
    // The initial drawing effect may complete synchronously in the Reanimated mock.
    expect(onWord).not.toHaveBeenCalled();
    const { __gestureHandlers } = require('react-native-gesture-handler');
    act(() => {
      __gestureHandlers.pan.onTouchesDown({ changedTouches: [{ id: 1, x: 130, y: 40 }] });
      jest.runOnlyPendingTimers();
    });
    expect(onUserInteraction).toHaveBeenCalledTimes(1);
    expect(onWord).not.toHaveBeenCalled();
  });

  test('first-level gesture loop starts without a replay request and yields to touch', () => {
    const onWord = jest.fn(() => 'grid' as const);
    const onUserInteraction = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <LetterDisk
          letters={['к', 'о', 'т']}
          onWord={onWord}
          size={260}
          demoWord="кот"
          demoLoop
          onUserInteraction={onUserInteraction}
        />,
      );
    });
    rendered.push(tree);
    const handCount = () => tree.root.findAllByProps({ importantForAccessibility: 'no-hide-descendants' }).length;
    expect(handCount()).toBeGreaterThan(0);
    expect(onWord).not.toHaveBeenCalled();

    const { __gestureHandlers } = require('react-native-gesture-handler');
    act(() => {
      __gestureHandlers.pan.onTouchesDown({ changedTouches: [{ id: 1, x: 130, y: 40 }] });
    });
    expect(handCount()).toBe(0);
    expect(onUserInteraction).toHaveBeenCalledTimes(1);
    expect(onWord).not.toHaveBeenCalled();
  });

  test('a cancelled short touch restores a looping guide even when React batches input', () => {
    const onWord = jest.fn(() => 'invalid' as const);
    const onEnd = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord}
        demoWord="кот" demoLoop onUserInteractionEnd={onEnd} />);
    });
    rendered.push(tree);
    const handlers = require('react-native-gesture-handler').__gestureHandlers;
    const initialGuides = tree.root.findAllByProps({ testID: 'intro-gesture-guide' }).length;
    expect(initialGuides).toBeGreaterThan(0);
    act(() => {
      handlers.pan.onTouchesDown({ changedTouches: [{ id: 1, x: 130, y: 40 }], numberOfTouches: 1 });
      handlers.pan.onFinalize({}, false);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByProps({ testID: 'intro-gesture-guide' })).toHaveLength(initialGuides);
    expect(onWord).not.toHaveBeenCalled();
  });

  test('changing the remaining target does not automatically replay a demo', () => {
    const onWord = jest.fn(() => 'grid' as const);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} demoWord="кот" demoRequestId={0} />);
    });
    rendered.push(tree);
    const handCount = () => tree.root.findAllByProps({ importantForAccessibility: 'no-hide-descendants' }).length;
    expect(handCount()).toBe(0);

    act(() => {
      tree.update(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} demoWord="кот" demoRequestId={1} />);
    });
    expect(handCount()).toBeGreaterThan(0);

    act(() => {
      tree.update(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} demoWord="ток" demoRequestId={1} />);
    });
    expect(handCount()).toBe(0);

    act(() => {
      tree.update(<LetterDisk letters={['к', 'о', 'т']} onWord={onWord} demoWord="ток" demoRequestId={2} />);
    });
    expect(handCount()).toBeGreaterThan(0);
    expect(onWord).not.toHaveBeenCalled();
  });
});
