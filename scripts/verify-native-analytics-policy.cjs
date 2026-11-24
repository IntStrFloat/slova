/* global __dirname */
/**
 * Compiles the entire production AppMetricaPrivacy.kt against local API fakes.
 * No Android device, network, new dependency, production credential or policy copy is used.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaPrivacy.kt');
const CRASH_SOURCES = ['AppMetricaCrashSafety.kt', 'AppMetricaCrashOptions.kt']
  .map((name) => path.join(path.dirname(SOURCE), name));
const FIXTURES = path.join(ROOT, 'scripts/fixtures/appmetrica-native-policy');
const OUTPUT = path.join(ROOT, 'output/rustore-sdk-2026-11-02/g2');
const CACHE = path.join(process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'), 'caches/modules-2/files-2.1');
const KOTLIN_VERSION = '2.3.0';
const SCENARIOS = [
  'cold_keyless_existing_sender', 'warm_keyless_tracked_session', 'missing_consent_then_opt_in',
  'valid_opt_in_idempotent', 'persisted_refusal', 'qa_build', 'debug_build', 'preview_package',
  'emulator', 'keyless_explicit_refusal', 'failed_preference_write', 'failed_sdk_disable', 'missing_context',
  'crash_defaults_and_refusal', 'extended_crash_flags',
  'qa_local_consent_failure',
];
const EXPECTED_RED = ['cold_keyless_existing_sender', 'warm_keyless_tracked_session'];
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const relative = (filename) => path.relative(ROOT, filename).replaceAll('\\', '/');
const assert = (condition, code) => { if (!condition) throw new Error(code); };

function cachedJar(group, artifact, version, extension = 'jar', classifier = '') {
  const directory = path.join(CACHE, group, artifact, version);
  assert(fs.existsSync(directory), 'missing_cached_artifact:' + group + ':' + artifact + ':' + version);
  const matches = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => fs.readdirSync(path.join(directory, entry.name))
      .filter((name) => name === artifact + '-' + version + (classifier ? '-' + classifier : '') + '.' + extension)
      .map((name) => path.join(directory, entry.name, name)));
  assert(matches.length === 1, 'ambiguous_cached_artifact:' + group + ':' + artifact + ':' + version);
  return matches[0];
}

function javaExecutable() {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const candidates = [process.env.SLOVA_NATIVE_POLICY_JAVA_HOME,
    'C:/Program Files/Android/Android Studio/jbr', process.env.JAVA_HOME].filter(Boolean);
  const executable = candidates.map((candidate) => path.join(candidate, 'bin', 'java' + suffix))
    .find((candidate) => fs.existsSync(candidate));
  assert(executable, 'java_runtime_missing');
  return executable;
}

function run(executable, argumentsList) {
  const result = spawnSync(executable, argumentsList, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120000,
  });
  return { exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '',
    ...(result.error ? { error: result.error.code || result.error.name } : {}) };
}

function replaceOnce(source, previous, next) {
  assert(source.split(previous).length === 2, 'pre_fix_fixture_anchor_mismatch');
  return source.replace(previous, next);
}

function preFixBranch(source) {
  let previous = source.replaceAll('\r\n', '\n');
  previous = replaceOnce(previous,
    '    val context = application\n    val key = apiKey\n    val enabled = requested && !isTestDevice(context) && key != null',
    '    val context = application\n    val enabled = requested && !isTestDevice(context)');
  previous = replaceOnce(previous,
    '      // An intentionally keyless build also disables an already-enabled SDK.\n' +
      '      // It cannot acknowledge a request to enable custom collection.\n' +
      '      return applied && (!requested || key != null)\n    }\n    return runCatching {',
    '      return applied\n    }\n    val key = apiKey ?: return false\n    return runCatching {');
  return replaceOnce(previous, 'AppMetricaConfig.newConfigBuilder(requireNotNull(key))',
    'AppMetricaConfig.newConfigBuilder(key)');
}

function cleanGeneratedDirectory(directory) {
  const parent = fs.realpathSync(path.join(ROOT, '.omx/tmp'));
  const resolved = fs.realpathSync(directory);
  assert(path.dirname(resolved).toLowerCase() === parent.toLowerCase()
    && path.basename(resolved).startsWith('native-policy-'), 'unsafe_fixture_cleanup_target');
  for (const name of fs.readdirSync(directory)) {
    const filename = path.join(directory, name);
    assert(fs.lstatSync(filename).isFile(), 'unexpected_fixture_cleanup_entry');
    fs.unlinkSync(filename);
  }
  fs.rmdirSync(directory);
}

function main() {
  const demonstrateRed = process.argv.includes('--demonstrate-red');
  assert(process.argv.slice(2).every((argument) => argument === '--demonstrate-red'), 'unknown_argument');
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, '.omx/tmp'), { recursive: true });
  const initial = fs.readFileSync(SOURCE);
  const report = {
    observedAt: new Date().toISOString(), status: 'FAIL', source: relative(SOURCE),
    sourceSha256: hash(initial), compilerVersion: KOTLIN_VERSION, actualEntireProductionSource: true,
    compiledProductionSources: [SOURCE, ...CRASH_SOURCES].map((file) => ({
      file: relative(file), sha256: hash(fs.readFileSync(file)),
    })),
    fixtures: fs.readdirSync(FIXTURES).filter((name) => name.endsWith('.kt')).sort().map((name) => ({
      file: relative(path.join(FIXTURES, name)), sha256: hash(fs.readFileSync(path.join(FIXTURES, name))),
    })),
    scope: 'Host JVM behavior using fake Android and AppMetrica API only; no network or device',
    limits: [
      'Does not verify Android framework behavior, actual SDK ABI, HTTP delivery or backend receipt.',
      'SDK-failure fixture observes false request and wrapper closure; it does not promise cancellation of a failing SDK.',
      'The red variant is a temporary copy with only the known missing-key branch fix inverted, not an old release artifact.',
    ],
  };
  const directory = fs.mkdtempSync(path.join(ROOT, '.omx/tmp/native-policy-'));
  try {
    const java = javaExecutable();
    const runtimeCoordinates = [
      ['org.jetbrains.kotlin', 'kotlin-stdlib', KOTLIN_VERSION],
      ['org.jetbrains.kotlin', 'kotlin-script-runtime', KOTLIN_VERSION],
      ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'],
      ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', KOTLIN_VERSION],
      ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'],
      ['org.jetbrains', 'annotations', '13.0'],
    ];
    const compilerCoordinates = ['org.jetbrains.kotlin', 'kotlin-compiler-embeddable', KOTLIN_VERSION];
    const compiler = cachedJar(...compilerCoordinates);
    const runtime = runtimeCoordinates.map((coordinate) => cachedJar(...coordinate));
    const compilerClasspath = [compiler, ...runtime].join(path.delimiter);
    const runtimeClasspath = runtime.join(path.delimiter);
    report.cachedCompilerArtifacts = [compilerCoordinates, ...runtimeCoordinates].map((coordinate, index) => ({
      coordinate: coordinate.join(':'), sha256: hash(fs.readFileSync(index === 0 ? compiler : runtime[index - 1])),
    }));

    const compile = (name, source) => {
      const jar = path.join(directory, name + '.jar');
      const result = run(java, ['-Xmx512m', '-Dfile.encoding=UTF-8', '-cp', compilerClasspath,
        'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
        '-classpath', runtimeClasspath, '-d', jar, source, ...CRASH_SOURCES,
        ...report.fixtures.map((entry) => path.join(ROOT, entry.file))]);
      fs.writeFileSync(path.join(OUTPUT, 'native-policy-' + name + '-compile.log'),
        result.stdout + result.stderr + (result.error ? '\nProcess error: ' + result.error : ''));
      assert(result.exitCode === 0, 'native_policy_compile_failed:' + name);
      return jar;
    };

    const execute = (name, jar) => {
      const results = SCENARIOS.map((scenario) => {
        // Each scenario gets a fresh policy singleton; only the warm scenario bootstraps twice.
        const result = run(java, ['-cp', [jar, runtimeClasspath].join(path.delimiter), 'PolicyScenariosKt', scenario]);
        let observation;
        try { observation = JSON.parse(result.stdout.trim()); } catch { observation = null; }
        return { scenario, passed: result.exitCode === 0 && observation?.passed === true,
          exitCode: result.exitCode, ...(observation ? { observation } : {}),
          ...(result.exitCode !== 0 ? { failure: result.stderr.trim() || result.error || 'missing_observation' } : {}) };
      });
      fs.writeFileSync(path.join(OUTPUT, 'native-policy-' + name + '-scenarios.json'), JSON.stringify(results, null, 2));
      return results;
    };

    if (demonstrateRed) {
      const oldSource = preFixBranch(initial.toString('utf8'));
      const previous = path.join(directory, 'AppMetricaPrivacy.kt');
      fs.writeFileSync(previous, oldSource);
      const results = execute('pre-fix', compile('pre-fix', previous));
      const failures = results.filter((result) => !result.passed).map((result) => result.scenario);
      report.preFix = { passed: results.length - failures.length, failed: failures.length,
        expectedFailures: EXPECTED_RED, failures, sourceSha256: hash(oldSource) };
      assert(JSON.stringify(failures) === JSON.stringify(EXPECTED_RED), 'pre_fix_expected_failure_matrix_mismatch');
    }

    const current = execute('current', compile('current', SOURCE));
    report.current = { passed: current.filter((result) => result.passed).length,
      failed: current.filter((result) => !result.passed).length,
      checks: current.reduce((sum, result) => sum + (result.observation?.checks || 0), 0) };
    assert(report.current.failed === 0, 'current_native_policy_scenario_failed');
    assert(hash(fs.readFileSync(SOURCE)) === report.sourceSha256, 'production_source_changed_during_verification');
    report.productionSourceUnchanged = true;
    report.status = 'PASS';
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    cleanGeneratedDirectory(directory);
    const filename = path.join(OUTPUT, 'native-policy-result.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, current: report.current, preFix: report.preFix,
      report: relative(filename), ...(report.failure ? { failure: report.failure } : {}) }, null, 2));
  }
}

if (require.main === module) main();
module.exports = { cachedJar, javaExecutable, run, cleanGeneratedDirectory };
