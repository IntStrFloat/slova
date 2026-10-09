/** RuStore Push is Android-only; an empty project id keeps the provider inactive. */
export const PUSH = {
  enabled: true,
  projectId: process.env.EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID ?? '',
  testMode: __DEV__,
} as const;
