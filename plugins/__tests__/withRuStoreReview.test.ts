// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withRuStoreReview.js') as {
  patchProjectBuildGradle(contents: string): string;
};

const ALLPROJECTS = `allprojects {
  repositories {
    google()
    mavenCentral()
    maven { url 'https://artifactory-external.vkpartner.ru/artifactory/maven' }
  }
}
`;

describe('withRuStoreReview config plugin', () => {
  it('adds the current review SDK repository without removing the push repository', () => {
    const once = plugin.patchProjectBuildGradle(ALLPROJECTS);
    expect(once).toContain('https://nexus-external.rustore.ru/repository/maven-rustore-exposed');
    expect(once).toContain('https://artifactory-external.vkpartner.ru/artifactory/maven');
    expect(plugin.patchProjectBuildGradle(once)).toBe(once);
  });

  it('does not silently skip a changed Gradle repository structure', () => {
    expect(() => plugin.patchProjectBuildGradle('buildscript {}')).toThrow(/allprojects\.repositories/);
  });
});
