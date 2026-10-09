import {
  disposeAudio,
  initAudio,
  isAudioAvailable,
  playSfx,
  startMusic,
  stopMusic,
  syncAudioSettings,
} from '@/features/audio';

describe('audio capability gate', () => {
  afterEach(() => disposeAudio());

  it('does not expose incomplete audio as a working feature', async () => {
    expect(isAudioAvailable()).toBe(false);
    await expect(initAudio()).resolves.toBeUndefined();
  });

  it('keeps all calls safe while the licensed asset manifest is absent', () => {
    expect(() => playSfx('select')).not.toThrow();
    expect(() => startMusic('map')).not.toThrow();
    expect(() => syncAudioSettings({ sound: false, music: false, haptics: true, notifications: false })).not.toThrow();
    expect(() => stopMusic()).not.toThrow();
  });
});
