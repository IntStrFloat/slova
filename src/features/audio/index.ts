import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { Settings } from '@/features/settings';
import { useSettings } from '@/features/settings';

/**
 * Audio is deliberately unavailable until every required asset and its licence
 * are bundled. A visible toggle over a no-op player is worse than no toggle:
 * it makes a release claim a feature it cannot provide.
 *
 * When the licensed files are added, replace this gate with static Metro
 * `require` entries for all keys below and keep the lifecycle API unchanged.
 */
const AUDIO_ASSETS_READY = false;

export type SfxKey =
  | 'select'
  | 'correct'
  | 'bonus'
  | 'error'
  | 'coin'
  | 'hint'
  | 'shuffle'
  | 'win';

export type MusicScene = 'map' | 'game';

let activeScene: MusicScene | null = null;

/** Whether the signed bundle contains the complete, licensed audio set. */
export function isAudioAvailable(): boolean {
  return AUDIO_ASSETS_READY;
}

/**
 * Reserved for preload once the complete asset manifest is available. It is
 * intentionally non-blocking so audio can never hold up the splash screen.
 */
export async function initAudio(): Promise<void> {
  if (!AUDIO_ASSETS_READY) return;
  // Add bounded player creation/preload here with the static asset manifest.
}

/** Play a short effect. Disabled/missing audio is intentionally silent. */
export function playSfx(_key: SfxKey): void {
  if (!AUDIO_ASSETS_READY || !useSettings.getState().sound) return;
  // A bounded player pool belongs here once real sources are supplied.
}

/** Select the only active music scene; repeated calls must not create loops. */
export function startMusic(scene: MusicScene): void {
  if (!AUDIO_ASSETS_READY || !useSettings.getState().music) return;
  if (activeScene === scene) return;
  activeScene = scene;
  // Create/play the scene player here once real sources are supplied.
}

/** Stop the active music loop, if one exists. */
export function stopMusic(): void {
  activeScene = null;
  // Pause the active player here once real sources are supplied.
}

/** Apply settings immediately; this makes future player wiring restart-free. */
export function syncAudioSettings(settings: Settings): void {
  if (!AUDIO_ASSETS_READY || !settings.music) stopMusic();
}

/** Release all players exactly once during the root teardown. */
export function disposeAudio(): void {
  stopMusic();
  // Release every manually-created expo-audio player here.
}

/**
 * The sole audio lifecycle owner. It preloads after critical UI, pauses on
 * backgrounding and never enables background playback/foreground services.
 */
export function AudioRoot() {
  useEffect(() => {
    void initAudio();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopMusic();
    });

    return () => {
      subscription.remove();
      disposeAudio();
    };
  }, []);

  return null;
}
