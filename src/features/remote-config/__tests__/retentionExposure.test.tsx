import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { RETENTION } from '@/core/config/retention';
import { DEFAULT_POLICY, resetRuntimePolicy, setConfiguredPolicy, setRuntimePolicyGuard } from '@/core/config/runtimePolicy';
import { getFeatureGates, makeInitialSnapshot, type RetentionSnapshot } from '@/features/retention/model';
import { recordRemoteParameterUse } from '../runtime';
import { useRetentionPolicyExposure } from '../useRetentionPolicyExposure';

let mockState: RetentionSnapshot;
const mockListeners = new Set<() => void>();
jest.mock('../runtime', () => ({ recordRemoteParameterUse: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => {
  const React = jest.requireActual('react'); React.useEffect(callback, [callback]);
} }));
jest.mock('@/features/retention', () => ({ useRetention: () => {
  const React = jest.requireActual('react');
  return React.useSyncExternalStore((listener: () => void) => {
    mockListeners.add(listener); return () => mockListeners.delete(listener);
  }, () => mockState);
} }));
const flags = RETENTION.featureFlags as { quests: boolean; event: boolean };
function Surface() {
  useRetentionPolicyExposure('home');
  const gates = getFeatureGates(mockState); // The screen really computes its eligibility before committing exposure.
  return React.createElement('gate', { quests: gates.quests, event: gates.event });
}
let view: ReturnType<typeof renderer.create> | null = null;
beforeEach(() => {
  jest.clearAllMocks(); mockListeners.clear(); resetRuntimePolicy();
  mockState = makeInitialSnapshot({ newProfile: false }); flags.quests = true; flags.event = true;
  setRuntimePolicyGuard(() => true);
  setConfiguredPolicy({ ...DEFAULT_POLICY, configVersion: 'quest_fixture', profileScope: 'profile_a',
    assignment: { experiment_id: 'quest_unlock', assignment_id: 'assigned_quest', variant: 'candidate', allocation_version: 1 },
    parameter: 'retention_quests_unlock_wins', values: { ...DEFAULT_POLICY.values, retention_quests_unlock_wins: 20 } });
});
afterEach(async () => { if (view) await act(async () => { view!.unmount(); }); view = null; flags.quests = true; flags.event = true; });

test('an already started activity short-circuits the threshold and creates no screen exposure', async () => {
  mockState.questInstances.already = {} as RetentionSnapshot['questInstances'][string];
  await act(async () => { view = renderer.create(<Surface />); });
  expect(recordRemoteParameterUse).not.toHaveBeenCalled();
});

test('a disabled feature creates no exposure; unopened threshold use is recorded once and observes retention changes', async () => {
  flags.quests = false;
  await act(async () => { view = renderer.create(<Surface />); });
  expect(recordRemoteParameterUse).not.toHaveBeenCalled();
  flags.quests = true;
  await act(async () => {
    mockState = { ...mockState, questInstances: {} };
    for (const listener of mockListeners) listener();
  });
  expect(recordRemoteParameterUse).toHaveBeenCalledTimes(1);
  expect(recordRemoteParameterUse).toHaveBeenCalledWith('retention_quests_unlock_wins', 'retention_gate');
  await act(async () => { view!.update(<Surface />); });
  expect(recordRemoteParameterUse).toHaveBeenCalledTimes(1);
});
