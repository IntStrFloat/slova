import { requireOptionalNativeModule } from 'expo';

/**
 * Тонкий обёрточный слой над нативным модулем `modules/appmetrica` (Expo Modules API).
 * На web / Expo Go / в jest нативный модуль отсутствует.
 * Возвращаем статус локальной передачи SDK, чтобы очередь могла повторить сбой.
 */
interface AppMetricaNativeModule {
  reportEvent(name: string, jsonValue?: string): void;
}

let cached: AppMetricaNativeModule | null | undefined;

function getNative(): AppMetricaNativeModule | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<AppMetricaNativeModule>('Appmetrica');
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** Доступен ли нативный AppMetrica-модуль (false на web/Expo Go/jest). */
export function isAppMetricaAvailable(): boolean {
  return getNative() != null;
}

/** True means the native SDK call returned normally, not server delivery. */
export function reportEvent(name: string, props?: Record<string, unknown>): boolean {
  const native = getNative();
  if (!native) return false;
  try {
    const json =
      props && Object.keys(props).length > 0 ? JSON.stringify(props) : undefined;
    native.reportEvent(name, json);
    return true;
  } catch {
    return false;
  }
}
