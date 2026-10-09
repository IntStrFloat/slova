// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withYandexMediationVk.js') as {
  patchAppBuildGradle(contents: string): string;
};

const APP_BUILD_GRADLE = `android {
  namespace "com.intstrfloat.slova"
}

dependencies {
  implementation("com.facebook.react:react-android")
}
`;

describe('withYandexMediationVk config plugin', () => {
  test('adds the VK Ads mediation adapter idempotently', () => {
    const once = plugin.patchAppBuildGradle(APP_BUILD_GRADLE);

    expect(once).toContain(
      'implementation("com.yandex.ads.mediation:mobileads-mytarget:5.45.3.4")',
    );
    expect(plugin.patchAppBuildGradle(once)).toBe(once);
  });

  test('fails loudly if the dependencies block changes', () => {
    expect(() => plugin.patchAppBuildGradle('android {}')).toThrow(
      /dependencies block/,
    );
  });
});
