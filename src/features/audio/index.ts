import type { AudioPlayer } from 'expo-audio';

import { useSettings } from '@/features/settings';

/**
 * Аудио-менеджер SFX (спека 04/16). Абстракция поверх expo-audio: уважает
 * настройку sound, работает без ассетов (noop) — реальные файлы кладутся в
 * assets/sfx/* и регистрируются в SOURCES, после чего звуки заиграют без правок логики.
 */
export type SfxKey = 'select' | 'correct' | 'bonus' | 'error' | 'coin' | 'win';

// TODO(assets): добавить файлы и раскомментировать. Пока пусто → менеджер — noop.
const SOURCES: Partial<Record<SfxKey, number>> = {
  // select: require('../../../assets/sfx/select.mp3'),
  // correct: require('../../../assets/sfx/correct.mp3'),
  // bonus: require('../../../assets/sfx/bonus.mp3'),
  // error: require('../../../assets/sfx/error.mp3'),
  // coin: require('../../../assets/sfx/coin.mp3'),
  // win: require('../../../assets/sfx/win.mp3'),
};

const players: Partial<Record<SfxKey, AudioPlayer>> = {};

function getPlayer(key: SfxKey): AudioPlayer | null {
  const src = SOURCES[key];
  if (src == null) return null;
  if (!players[key]) {
    try {
      // Ленивый require: expo-audio не подтягивается на старте/в тестах, пока нет ассетов.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
      players[key] = createAudioPlayer(src);
    } catch {
      return null;
    }
  }
  return players[key] ?? null;
}

/** Проиграть короткий SFX. Без ассета/при выключенном звуке — тихо ничего не делает. */
export function playSfx(key: SfxKey): void {
  if (!useSettings.getState().sound) return;
  const p = getPlayer(key);
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch {
    // воспроизведение недоступно — не роняем игру
  }
}
