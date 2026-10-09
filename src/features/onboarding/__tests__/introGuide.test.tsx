import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';

import { storage } from '@/core/storage';

import {
  readFirstIndependentIntroCompletion,
  readIntroGuidance,
  recordFirstIndependentIntroCompletion,
  recordIntroDemoHelpUsed,
  setIntroGuidanceEnabled,
  useIntroGuide,
} from '../introGuide';

type Guide = ReturnType<typeof useIntroGuide>;

function Probe({ onUpdate, solvedCount = 0, active = true }: {
  onUpdate: (guide: Guide) => void; solvedCount?: number; active?: boolean;
}) {
  const guide = useIntroGuide({ active, levelId: 1, solvedCount });
  onUpdate(guide);
  return null;
}

beforeEach(() => {
  storage.clearAll();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});

afterEach(() => jest.restoreAllMocks());

test('failed, short and cancelled gestures return the demo until a target is accepted', () => {
  let guide!: Guide;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Probe onUpdate={(next) => { guide = next; }} />);
  });
  expect(guide.demoActive).toBe(true);
  expect(readIntroGuidance().firstValidInput).toBe(false);

  act(() => guide.onUserInteraction());
  expect(guide.demoActive).toBe(false);
  expect(readIntroGuidance().firstValidInput).toBe(false);
  act(() => guide.onInteractionEnd());
  expect(guide.demoActive).toBe(true);
  act(() => {
    guide.onUserInteraction();
    guide.markValidInput();
  });
  expect(guide.demoActive).toBe(false);
  expect(readIntroGuidance().firstValidInput).toBe(true);
  act(() => guide.onInteractionEnd());
  expect(guide.demoActive).toBe(true);
  act(() => {
    guide.onUserInteraction();
    guide.markTargetAccepted();
    guide.onInteractionEnd();
  });
  expect(guide.demoActive).toBe(false);
  expect(readIntroGuidance().firstTargetAccepted).toBe(true);
  act(() => tree.unmount());
  act(() => {
    tree = TestRenderer.create(<Probe onUpdate={(next) => { guide = next; }} />);
  });
  expect(guide.demoActive).toBe(false);
  act(() => tree.unmount());
});

test('backgrounding and leaving focus cancel unfinished input without suppressing the guide', () => {
  let change!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    change = callback;
    return { remove };
  });
  let guide!: Guide;
  let tree!: ReactTestRenderer;
  const onUpdate = (next: Guide) => { guide = next; };
  try {
    act(() => { tree = TestRenderer.create(<Probe onUpdate={onUpdate} />); });
    act(() => guide.onUserInteraction());
    expect(guide.demoActive).toBe(false);
    act(() => change('background'));
    expect(guide.demoActive).toBe(false);
    act(() => change('active'));
    expect(guide.demoActive).toBe(true);
    act(() => guide.onUserInteraction());
    act(() => tree.update(<Probe onUpdate={onUpdate} active={false} />));
    expect(guide.demoActive).toBe(false);
    act(() => tree.update(<Probe onUpdate={onUpdate} active />));
    expect(guide.demoActive).toBe(true);
  } finally {
    act(() => tree.unmount());
    listener.mockRestore();
  }
  expect(remove).toHaveBeenCalled();
});

test('the gesture respects the saved guidance setting and ends after the first solved word', () => {
  setIntroGuidanceEnabled(false);
  let guide!: Guide;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Probe onUpdate={(next) => { guide = next; }} />);
  });
  expect(guide.demoActive).toBe(false);
  setIntroGuidanceEnabled(true);
  act(() => guide.refreshGuidance());
  expect(guide.demoActive).toBe(true);
  act(() => tree.update(<Probe onUpdate={(next) => { guide = next; }} solvedCount={1} />));
  expect(guide.demoActive).toBe(false);
  act(() => tree.unmount());
});

test('demo-help state and first independent completion persist without changing guide preferences', () => {
  recordIntroDemoHelpUsed(2);
  recordIntroDemoHelpUsed(2);
  expect(readIntroGuidance().demoHelpedLevelIds).toEqual([2]);
  expect(readFirstIndependentIntroCompletion()).toBeNull();
  const first = recordFirstIndependentIntroCompletion({
    levelId: 3,
    attemptId: 'normal:3:first',
    completedAt: '2026-09-26T09:00:00.000Z',
  });
  const repeated = recordFirstIndependentIntroCompletion({
    levelId: 4,
    attemptId: 'normal:4:later',
    completedAt: '2026-09-26T10:00:00.000Z',
  });
  expect(repeated).toEqual(first);
  expect(readFirstIndependentIntroCompletion()).toEqual(first);
  expect(readIntroGuidance().guidanceEnabled).toBe(true);
});
