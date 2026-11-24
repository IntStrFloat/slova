module.exports = ({ config }) => {
  const isYandexGamesBuild = process.env.EXPO_PUBLIC_GAME_PLATFORM === 'yandex-games';
  const isLocalPreview = process.env.SLOVA_LOCAL_PREVIEW === '1';
  const isSdkQa = process.env.SLOVA_SDK_QA === '1';
  let qaVersionCode;
  if (isSdkQa) {
    const requestedVersion = process.env.SLOVA_SDK_QA_VERSION_CODE;
    if (requestedVersion !== undefined) {
      if (!/^[1-9]\d{0,9}$/.test(requestedVersion) || Number(requestedVersion) > 2_100_000_000) {
        throw new Error('Local SDK QA versionCode must be a positive Android versionCode.');
      }
      qaVersionCode = Number(requestedVersion);
    }
    let localApi;
    try { localApi = new URL(process.env.EXPO_PUBLIC_API_URL ?? ''); } catch { /* checked below */ }
    if (!localApi || localApi.protocol !== 'http:' || !['localhost', '127.0.0.1', '10.0.2.2'].includes(localApi.hostname)
      || localApi.username || localApi.password || localApi.search || localApi.hash || localApi.pathname !== '/') {
      throw new Error('Set an explicit local SDK QA backend URL in EXPO_PUBLIC_API_URL.');
    }
    if (process.env.EXPO_PUBLIC_YANDEX_TEST_ADS !== '1') {
      throw new Error('Local SDK QA requires EXPO_PUBLIC_YANDEX_TEST_ADS=1.');
    }
  }
  const plugins = (config.plugins ?? []).filter((entry) => (Array.isArray(entry) ? entry[0] : entry) !== './plugins/withSdkQa')
    .map((entry) => {
      if (!isSdkQa) return entry;
      const [name, options = {}] = Array.isArray(entry) ? entry : [entry];
      if (name === './plugins/withAppMetrica') return [name, { ...options, apiKey: '', required: false, qaBuild: true,
        crashQa: true, extendedCrashReporting: false }];
      if (name === './plugins/withRuStorePush') return [name, { ...options, projectId: '' }];
      if (name === './plugins/withRuStoreRemoteConfig') return [name, { ...options, appId: '', enabled: false }];
      if (name === './plugins/withRuStoreUpdates') return [name, { ...options, enabled: false, qa: true }];
      return entry;
    });

  return {
    ...config,
    ...(qaVersionCode === undefined ? {} : { android: { ...config.android, versionCode: qaVersionCode } }),
    ...(isSdkQa && !config.name.endsWith(' · SDK QA') ? { name: `${config.name} · SDK QA` } : {}),
    extra: { ...config.extra, sdkQa: isSdkQa },
    plugins: [...plugins, ['./plugins/withSdkQa', { enabled: isSdkQa, baseApplicationId: config.android?.package }]],
    ...(isLocalPreview ? { web: { ...config.web, output: 'single' } } : {}),
    experiments: {
      ...config.experiments,
      ...(isYandexGamesBuild ? { baseUrl: '.' } : {}),
    },
  };
};
