/* eslint-disable @typescript-eslint/no-require-imports */
type ProjectPlugin = { patchProjectBuildGradle(contents: string): string };
const push = require('../withRuStorePush.js') as ProjectPlugin;
const review = require('../withRuStoreReview.js') as ProjectPlugin;
const mediation = require('../withYandexEasyMonetization.js') as ProjectPlugin;
const { readFileSync } = require('node:fs') as typeof import('node:fs');
const { join } = require('node:path') as typeof import('node:path');

const CURRENT = 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed';
const LEGACY = 'https://artifactory-external.vkpartner.ru/artifactory/maven';
const OLD_EXPOSED = LEGACY + '-rustore-exposed';
const MY_TARGET = `maven { url '${LEGACY}'; content { includeGroupByRegex 'com[.]my[.]target' } }`;
const TRACER_URL = 'https://nexus-external.vkteam.ru/repository/maven-tracer-public-exposed';
const TRACER = `maven { url '${TRACER_URL}'; content { includeGroup 'ru.ok.tracer' } }`;
const template = (repositories = '') => `buildscript { repositories { google() } }
allprojects {
  repositories {
    google()
    mavenCentral()
    ${repositories}
  }
}
apply plugin: "expo-root-project"
`;
const compose = (plugins: ProjectPlugin[], contents: string) => plugins.reduce(
  (current, plugin) => plugin.patchProjectBuildGradle(current), contents,
);

describe('composed RuStore repository migration', () => {
  test('keeps the installed Push wrapper from injecting the old unrestricted vendor repository', () => {
    const packageDirectory = join(__dirname, '../../node_modules/react-native-rustore-push/android');
    const gradle = readFileSync(join(packageDirectory, 'build.gradle'), 'utf8');
    expect(gradle).not.toContain('https://artifactory-external.vkpartner.ru/artifactory/maven');
    expect(gradle).toContain('mavenLocal()');
    expect(gradle).toContain('google()');
    expect(gradle).toContain('mavenCentral()');
    expect(gradle).toContain('implementation "ru.rustore.sdk:pushclient:7.4.0"');
    const kotlin = readFileSync(join(packageDirectory, 'src/main/java/com/rustorepush/RustorePushModule.kt'), 'utf8');
    expect(kotlin).toContain('override fun onNewIntent(intent: Intent)');
  });

  test.each([
    ['push, review, mediation', [push, review, mediation]],
    ['push, mediation, review', [push, mediation, review]],
    ['review, push, mediation', [review, push, mediation]],
    ['review, mediation, push', [review, mediation, push]],
    ['mediation, push, review', [mediation, push, review]],
    ['mediation, review, push', [mediation, review, push]],
  ] as const)('has one current repository and a separate myTarget owner: %s', (_name, plugins) => {
    const once = compose([...plugins], template());
    expect(once.split(CURRENT)).toHaveLength(2);
    expect(once.split(LEGACY)).toHaveLength(2);
    expect(once).toContain(MY_TARGET);
    expect(once.split(TRACER_URL)).toHaveLength(2);
    expect(once).toContain(TRACER);
    expect(once).not.toContain(OLD_EXPOSED);
    expect(compose([...plugins], once)).toBe(once);
    expect(once).toContain('apply plugin: "expo-root-project"');
  });

  test.each([push, review])('migrates both old RuStore URLs and duplicate current entries', (plugin) => {
    const input = template(`maven { url '${OLD_EXPOSED}' }
    maven { url '${LEGACY}'; content { includeGroupByRegex 'ru[.]rustore([.].*)?'; includeGroupByRegex 'com[.]my[.]target' } }
    maven { url '${CURRENT}' }
    maven { url '${CURRENT}' }`);
    const next = plugin.patchProjectBuildGradle(input);
    expect(next.split(CURRENT)).toHaveLength(2);
    expect(next.split(LEGACY)).toHaveLength(2);
    expect(next).toContain(MY_TARGET);
    expect(next).not.toContain(OLD_EXPOSED);
    expect(plugin.patchProjectBuildGradle(next)).toBe(next);
  });

  test('handles multiline content and official Groovy uri syntax without moving unrelated repositories', () => {
    const unrelated = `maven {
      url 'https://example.test/vendor'
      content {
        includeGroupByRegex 'vendor[.]{1}sdk'
      }
    }`;
    const input = template(`${unrelated}
    maven {
      url = uri("${OLD_EXPOSED}")
      content {
        includeGroupByRegex 'ru[.]rustore([.].*)?'
      }
    }
    maven {
      url "${LEGACY}"
      content {
        includeGroup 'com.my.target'
        includeGroup 'ru.rustore.sdk'
      }
    }`).replace(/\n/g, '\r\n');
    const once = compose([push, review, mediation], input);
    expect(once).toContain(unrelated.replace(/\n/g, '\r\n'));
    expect(once).toContain(MY_TARGET);
    expect(once.split(CURRENT)).toHaveLength(2);
    expect(once).not.toContain(OLD_EXPOSED);
    expect(once.replace(/\r\n/g, '')).not.toContain('\n');
    expect(compose([push, review, mediation], once)).toBe(once);
  });

  test('does not mistake comments, quoted braces or buildscript repositories for the project block', () => {
    const prefix = `// allprojects { repositories { maven { url '${LEGACY}' } } }
buildscript {
  repositories { maven { url 'https://example.test/build-only' } }
}
`;
    const input = prefix + template(`// A comment may contain } and {
    maven { url 'https://example.test/{vendor}'; content { includeGroup 'vendor.sdk' } }`);
    const once = push.patchProjectBuildGradle(input);
    expect(once.startsWith(prefix)).toBe(true);
    expect(once).toContain("maven { url 'https://example.test/{vendor}'; content { includeGroup 'vendor.sdk' } }");
    expect(push.patchProjectBuildGradle(once)).toBe(once);
  });

  test('migrates trailing-slash URLs and Groovy url call syntax', () => {
    const input = template(`maven { url('${OLD_EXPOSED}/') }
    maven { url = "${LEGACY}/" }
    maven { url = uri('${CURRENT}/') }`);
    const next = compose([mediation, review, push], input);
    expect(next.split(CURRENT)).toHaveLength(2);
    expect(next.split(LEGACY)).toHaveLength(2);
    expect(next).toContain(MY_TARGET);
    expect(next).not.toContain(OLD_EXPOSED);
    expect(compose([push, review, mediation], next)).toBe(next);
  });

  test('routes the existing Push tracer dependencies without adding their repository to fresh Review-only configuration', () => {
    expect(push.patchProjectBuildGradle(template())).toContain(TRACER);
    expect(review.patchProjectBuildGradle(template())).not.toContain(TRACER_URL);
    expect(mediation.patchProjectBuildGradle(template())).not.toContain(TRACER_URL);
  });

  test.each([push, review, mediation])('preserves and deduplicates an existing Tracer repository across plugin order', (plugin) => {
    const input = template(`${TRACER}
    maven { url = uri('${TRACER_URL}/'); content { includeGroupByRegex 'ru[.]ok[.]tracer' } }`);
    const next = plugin.patchProjectBuildGradle(input);
    expect(next.split(TRACER_URL)).toHaveLength(2);
    expect(next).toContain(TRACER);
    expect(plugin.patchProjectBuildGradle(next)).toBe(next);
  });

  test.each([push, review, mediation])('moves an explicitly scoped legacy Tracer group to its current dedicated repository', (plugin) => {
    const input = template(`maven { url '${LEGACY}'; content { includeGroup 'ru.ok.tracer'; includeGroup 'com.my.target' } }`);
    const next = plugin.patchProjectBuildGradle(input);
    expect(next).toContain(TRACER);
    expect(next).toContain(MY_TARGET);
    expect(next.split(TRACER_URL)).toHaveLength(2);
  });

  test.each([push, review, mediation])('rejects a foreign scope on the known Tracer repository instead of deleting it', (plugin) => {
    const input = template(`maven { url '${TRACER_URL}'; content { includeGroupByRegex 'ru[.]ok[.]tracer|com[.]other[.]vendor' } }`);
    expect(() => plugin.patchProjectBuildGradle(input)).toThrow(/RuStore.*repository group/);
  });

  test.each([push, review, mediation])('rejects a changed project shape even if another block has the new URL', (plugin) => {
    expect(() => plugin.patchProjectBuildGradle(`buildscript { repositories { maven { url '${CURRENT}' } } }`))
      .toThrow(/allprojects.repositories/);
  });

  test.each([push, review, mediation])('rejects unsupported target repository clauses instead of deleting them', (plugin) => {
    expect(() => plugin.patchProjectBuildGradle(template(`maven { url '${LEGACY}'; credentials { username 'private' } }`)))
      .toThrow(/RuStore.*repository/);
  });

  describe.each([
    ['Push', push], ['Review', review], ['mediation', mediation],
  ] as const)('%s migration fails closed for unrecognised repository scope', (_name, plugin) => {
    test.each([
      ['a union with a foreign vendor', "includeGroupByRegex 'ru[.]rustore([.].*)?|com[.]other[.]vendor'"],
      ['a literal prefix lookalike', "includeGroup 'ru.rustorex'"],
      ['a regex prefix lookalike', "includeGroupByRegex 'ru[.]rustorex([.].*)?'"],
      ['unescaped RuStore regex dots', "includeGroupByRegex 'ru.rustore.*'"],
      ['unescaped myTarget regex dots', "includeGroupByRegex 'com.my.target'"],
    ])('rejects %s rather than silently dropping foreign scope', (_case, filter) => {
      expect(() => plugin.patchProjectBuildGradle(template(`maven { url '${LEGACY}'; content { ${filter} } }`)))
        .toThrow(/RuStore.*repository group/);
    });

    test('rejects a missing outer allprojects closing brace', () => {
      const incomplete = template(`maven { url '${CURRENT}' }`).replace('\n}\napply plugin:', '\napply plugin:');
      expect(() => plugin.patchProjectBuildGradle(incomplete)).toThrow(/unbalanced braces/);
    });
  });
});
