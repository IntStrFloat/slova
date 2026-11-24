import { Platform } from 'react-native';

import { getCrashReportingCapabilities } from '@/core/native/appmetrica';

/** Native localQa verifies the exact .sdkqa package, native compile flag and keyless policy. */
export function productQaAllowed(): boolean {
  if (process.env.EXPO_PUBLIC_LOCAL_SDK_QA !== '1' || Platform.OS !== 'android') return false;
  try {
    const capability = getCrashReportingCapabilities();
    return capability?.version === 1 && capability.enabled === true && capability.localQa === true;
  } catch { return false; }
}
