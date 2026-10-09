import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { useLevels } from '@/features/levels/store';
import { useSettings } from '@/features/settings';

import { startLevelExpansionAudienceSync } from '../levelExpansionAudience';
import { getPush, isPushAvailable } from '../provider';

jest.mock('../provider', () => ({ getPush: jest.fn(), isPushAvailable: jest.fn() }));

const sync = jest.fn(() => Promise.resolve());
const removeListener = jest.fn();
let onAppState: (state: AppStateStatus) => void;

beforeEach(() => {
  jest.clearAllMocks();
  useLevels.setState({ currentLevel: 500 });
  useSettings.setState({ notifications: true });
  (isPushAvailable as jest.Mock).mockReturnValue(true);
  (getPush as jest.Mock).mockReturnValue({ syncLevelExpansionAudience: sync });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onAppState = listener;
    return { remove: removeListener };
  });
});

it('syncs persisted progress, later progress, consent and foreground changes', () => {
  const stop = startLevelExpansionAudienceSync();
  try {
    expect(sync).toHaveBeenLastCalledWith(500, true);
    useLevels.setState({ currentLevel: 501 });
    expect(sync).toHaveBeenLastCalledWith(501, true);
    useSettings.setState({ notifications: false });
    expect(sync).toHaveBeenLastCalledWith(501, false);
    onAppState('active');
    expect(sync).toHaveBeenCalledTimes(4);
    useSettings.setState({ sound: false });
    onAppState('background');
    expect(sync).toHaveBeenCalledTimes(4);
  } finally {
    stop();
  }
  useLevels.setState({ currentLevel: 1001 });
  expect(sync).toHaveBeenCalledTimes(4);
  expect(removeListener).toHaveBeenCalledTimes(1);
});

it('does not register listeners or sync in an unavailable build', () => {
  (isPushAvailable as jest.Mock).mockReturnValue(false);
  startLevelExpansionAudienceSync()();
  expect(sync).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
});
