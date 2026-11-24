import type { RewardedState } from './types';

/** Only explicit SDK evidence classifies a network failure; numeric mediation codes vary. */
export function rewardedFailureReason(error: unknown, fallback: 'load_error' | 'show_error' = 'load_error'): RewardedState {
  if (!error || typeof error !== 'object') return fallback;
  const details = error as { message?: unknown; description?: unknown };
  let message = details.description ?? details.message;
  if (typeof message !== 'string' || message.length > 8_192) return fallback;
  try {
    const parsed = JSON.parse(message) as { description?: unknown; message?: unknown };
    message = parsed.description ?? parsed.message ?? message;
  } catch { /* SDKs can also provide an ordinary Error. Never send its text. */ }
  if (typeof message !== 'string') return fallback;
  if (/\bno[ _-]?fill\b|\bno ads available\b/i.test(message)) return 'no_fill';
  if (/\bnetwork[ _-]error\b|\bno internet connection\b|\bunable to resolve host\b/i.test(message)) return 'network_error';
  return fallback;
}

export function rewardedStateMessage(state: RewardedState | 'daily_limit' | 'cancelled' | 'pending'): string {
  switch (state) {
    case 'ready': return 'Реклама готова к просмотру';
    case 'loading': return 'Реклама загружается. Можно подождать или вернуться к слову.';
    case 'not_ready': return 'Реклама ещё не готова. Можно вернуться к игре и попробовать позже.';
    case 'no_fill': return 'Сейчас нет подходящей рекламы. Попробуйте позже.';
    case 'fullscreen_busy': return 'Дождитесь завершения другого полноэкранного показа.';
    case 'background': return 'Просмотр станет доступен после возвращения в игру.';
    case 'network_error': return 'Не удалось загрузить рекламу из-за ошибки сети. Проверьте подключение.';
    case 'load_error': return 'Не удалось загрузить рекламу. Попробуйте позже.';
    case 'show_error': return 'Не удалось показать рекламу. Право на вращение сохранено.';
    case 'save_failed': return 'Не удалось сохранить награду. Выдача ожидает восстановления, повторный просмотр не нужен.';
    case 'offer_save_failed': return 'Не удалось подготовить просмотр. Награда ещё не заработана. Попробуйте позже.';
    case 'reward_check_failed': return 'Не удалось проверить журнал наград. Повторите проверку; наличие заработанной награды пока не подтверждено.';
    case 'daily_limit': return 'На сегодня все вращения за рекламу использованы.';
    case 'cancelled': return 'Просмотр закрыт без награды. Право на вращение сохранено.';
    case 'pending': return 'Награда ожидает сохранения. Повторный просмотр не нужен.';
  }
}
