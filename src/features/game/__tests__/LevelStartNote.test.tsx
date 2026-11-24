import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import * as Reanimated from 'react-native-reanimated';
import type { Level } from '@/core/engine';

import { LevelStartNote } from '../LevelStartNote';

const level = { letters: ['к', 'о', 'т'], difficultyTier: 1, difficultyRole: 'easy' } as Level;

test('shows the requested numerical social-proof copy and never intercepts play', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<LevelStartNote level={level} visible />); });
  const output = JSON.stringify(tree.toJSON());
  expect(output).toContain('95% игроков прошли этот уровень. А вы?');
  expect(tree.root.findByProps({ testID: 'level-start-note' }).props.pointerEvents).toBe('none');
  act(() => { tree.update(<LevelStartNote level={level} visible={false} />); });
  expect(tree.toJSON()).toBeNull();
  act(() => { tree.unmount(); });
});

test('reduced motion preserves all copy without entrance or exit animation', () => {
  const reduced = jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  let tree!: ReactTestRenderer;
  try {
    act(() => { tree = TestRenderer.create(<LevelStartNote level={{ ...level, difficultyTier: 5, difficultyRole: 'baseline' }} visible />); });
    const note = tree.root.findByProps({ testID: 'level-start-note' });
    expect(note.props.entering).toBeUndefined();
    expect(note.props.exiting).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).toContain('35% игроков прошли этот уровень. Примете вызов?');
    expect(note.props.accessibilityLabel).toBe('35% игроков прошли этот уровень. Примете вызов?');
  } finally {
    act(() => { tree.unmount(); });
    reduced.mockRestore();
  }
});
