/** Build-time allow switch. Missing configuration keeps every new runtime path dormant. */
export const REMOTE_CONFIG_ENABLED = process.env.EXPO_PUBLIC_RUSTORE_REMOTE_CONFIG_ENABLED === '1';
