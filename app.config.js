module.exports = ({ config }) => {
  const isYandexGamesBuild = process.env.EXPO_PUBLIC_GAME_PLATFORM === 'yandex-games';
  const isLocalPreview = process.env.SLOVA_LOCAL_PREVIEW === '1';

  return {
    ...config,
    ...(isLocalPreview ? { web: { ...config.web, output: 'single' } } : {}),
    experiments: {
      ...config.experiments,
      ...(isYandexGamesBuild ? { baseUrl: '.' } : {}),
    },
  };
};
