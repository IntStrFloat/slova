/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { act, create } from 'react-test-renderer';

import type { Level } from '@/core/engine/types';

jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
    createAnimatedComponent: (component: unknown) => component,
    useReducedMotion: () => false,
  };
});

jest.mock('@/ui', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    AppText: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(Text, props, children),
    colors: {
      cream: '#fff6d9',
      creamDeep: '#f5e6be',
      goldBorder: '#d9b735',
      plum: '#4b175e',
      plumDeep: '#351142',
    },
    fonts: { tile: 'System' },
  };
});

import { CrosswordGrid } from '../CrosswordGrid';

const level: Level = {
  id: 1,
  world: 'world1',
  letters: ['к', 'о', 'т'],
  difficulty: 1,
  grid: {
    rows: 1,
    cols: 3,
    cells: [
      { row: 0, col: 0, ch: 'к' },
      { row: 0, col: 1, ch: 'о' },
      { row: 0, col: 2, ch: 'т' },
    ],
  },
  answers: [
    {
      word: 'кот',
      dir: 'H',
      cells: [
        { row: 0, col: 0, ch: 'к' },
        { row: 0, col: 1, ch: 'о' },
        { row: 0, col: 2, ch: 'т' },
      ],
    },
  ],
  bonusPool: ['ток'],
};

describe('CrosswordGrid accessibility', () => {
  test('exposes a single progress summary and hides visual descendants', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <CrosswordGrid level={level} filled={{ '0,0': 'к', '0,1': 'о' }} maxWidth={240} />,
      );
    });

    const summary = tree.root.find(
      (node) => node.props.accessibilityLabel === 'Кроссворд: заполнено 2 из 3 клеток. Собрано 0 из 1 слова.',
    );
    expect(summary.props.accessibilityValue).toEqual({ min: 0, max: 3, now: 2 });

    const hiddenVisual = tree.root.find(
      (node) => node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(hiddenVisual).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });
});
