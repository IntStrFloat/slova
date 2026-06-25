// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'scripts/*', 'jest-setup.js'],
  },
  {
    rules: {
      // Запись в sharedValue.value внутри worklet-колбэков — канонический паттерн Reanimated.
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);
