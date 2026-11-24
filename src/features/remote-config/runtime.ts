import { AppState } from 'react-native';
import { getAttemptPolicy, getRuntimePolicy, type PolicyParameter } from '@/core/config/runtimePolicy';
import { getString, removeKey, setString } from '@/core/storage';
import { isAnalyticsCollectionEnabled, setAnalyticsContext, track, useAnalyticsPrefs } from '@/features/analytics';
import { analyticsKeyToken } from '@/features/analytics/dedupe';
import { exposeAnalyticsParameter, getAnalyticsExperimentAssignment, hasStoredAnalyticsAssignment, initializeAnalyticsExperiments } from '@/features/analytics/experiments';
import { createRemoteConfigCoordinator } from './coordinator';
import { REMOTE_CONFIG_ENABLED } from './config';

let controller: ReturnType<typeof createRemoteConfigCoordinator> | null = null;
let stopCurrent: (() => void) | null = null;
let runtimeGeneration = 0;
let safePoint: () => boolean = () => false;

/** Fire-and-forget startup. With the default flag, even the native transport is not queried. */
export function startRemoteConfig(): () => void {
  if (stopCurrent) return () => {};
  if (!REMOTE_CONFIG_ENABLED) {
    return () => {};
  }
  let stopped = false;
  const generation = ++runtimeGeneration;
  let ownedController: ReturnType<typeof createRemoteConfigCoordinator> | null = null;
  const transport = () => Promise.resolve().then(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../../modules/rustore-remote-config') as typeof import('../../../modules/rustore-remote-config');
  });
  const setAllowed = (allowed: boolean) => {
    void transport().then((native) => {
      if (generation === runtimeGeneration) native.setRemoteConfigAllowed(!stopped && allowed);
    }).catch(() => {});
  };
  let removeListeners = () => {};
  // The default/off policy and pure consumers do not import application stores or the native SDK.
  void Promise.resolve().then(() => {
    // Literal lazy requires keep optional app-state/native imports dormant and work in Metro and Jest.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const game = require('@/features/game/store') as typeof import('@/features/game/store');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profile = require('@/features/profile') as typeof import('@/features/profile');
    return [game, profile] as const;
  }).then(async ([game, profile]) => {
    if (stopped) return;
    const { useGame } = game, { useProfile } = profile;
    safePoint = () => !useGame.getState().play || useGame.getState().completion.status === 'finished';
    const current = createRemoteConfigCoordinator({
      enabled: true, now: Date.now,
      scope: () => 'profile_' + analyticsKeyToken(useProfile.getState().profile?.userId ?? 'guest'),
      consent: isAnalyticsCollectionEnabled, assignment: getAnalyticsExperimentAssignment, pinnedAssignment: hasStoredAnalyticsAssignment,
      fetch: async () => (await transport()).fetchRemotePolicy(),
      read: getString, write: (key, value) => { setString(key, value); return getString(key) === value; }, remove: removeKey,
      event: track, exposure: (snapshot, parameter, point) => exposeAnalyticsParameter(snapshot, parameter, point, getAttemptPolicy() === snapshot),
      context: (snapshot) => setAnalyticsContext({ configVersion: snapshot.configVersion }),
    });
    controller = current;
    ownedController = current;
    const refresh = () => {
      current.identityChanged(); setAllowed(isAnalyticsCollectionEnabled());
      void current.refresh().then(() => { if (!stopped) current.applyAtSafePoint(safePoint()); });
    };
    const stopPrefs = useAnalyticsPrefs.subscribe(() => refresh());
    const stopProfile = useProfile.subscribe((next, previous) => { if (next.profile?.userId !== previous.profile?.userId) refresh(); });
    const activity = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    const stopGame = useGame.subscribe((next) => {
      if (next.completion.status === 'finished') queueMicrotask(() => { if (!stopped) current.applyAtSafePoint(safePoint()); });
    });
    removeListeners = () => { stopPrefs(); stopProfile(); stopGame(); activity.remove(); };
    // Existing identifiers/assignment resolve without holding navigation or fonts.
    await initializeAnalyticsExperiments();
    if (stopped) return;
    current.start(); current.applyAtSafePoint(safePoint()); refresh();
  }).catch(() => {
    ownedController?.stop();
    if (controller === ownedController) controller = null;
  });
  stopCurrent = () => {
    if (stopped) return;
    stopped = true; removeListeners(); ownedController?.stop();
    controller = null; stopCurrent = null; safePoint = () => false; setAllowed(false);
  };
  return stopCurrent;
}

export function applyRemoteConfigAtSafePoint(): void {
  controller?.applyAtSafePoint(safePoint());
  controller?.syncContext();
}
export function recordRemoteParameterUse(parameter: PolicyParameter, point: string): void { controller?.used(parameter, point); }
export function syncRemotePolicyContext(): void {
  // The active attempt can be older than the most recently fetched configured snapshot.
  if (controller) setAnalyticsContext({ configVersion: getRuntimePolicy().configVersion });
}
