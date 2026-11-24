/* global __dirname */
// Compiles the actual pure package getter without any analytics SDK on its classpath.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { cachedJar, javaExecutable, run, cleanGeneratedDirectory } = require('./verify-native-analytics-policy.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output/rustore-sdk-2026-11-02/g2');
const source = path.join(ROOT, 'modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaBuildInfo.kt');
const fixtures = path.join(ROOT, 'scripts/fixtures/appmetrica-build-info');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = (file) => path.relative(ROOT, file).replaceAll('\\', '/');

function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, '.omx/tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, '.omx/tmp/native-policy-buildinfo-'));
  const files = [source, ...fs.readdirSync(fixtures).filter((name) => name.endsWith('.kt')).sort()
    .map((name) => path.join(fixtures, name))];
  const report = { status: 'FAIL', observedAt: new Date().toISOString(), sdkPresentInClasspath: false,
    sourceFiles: files.map((file) => ({ file: relative(file), sha256: hash(fs.readFileSync(file)) })),
    deviceOrNetwork: false };
  try {
    const java = javaExecutable();
    const compiler = cachedJar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.3.0');
    const runtime = [['org.jetbrains.kotlin', 'kotlin-stdlib', '2.3.0'],
      ['org.jetbrains.kotlin', 'kotlin-script-runtime', '2.3.0'],
      ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'], ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.3.0'],
      ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'], ['org.jetbrains', 'annotations', '13.0']]
      .map((coordinate) => cachedJar(...coordinate));
    const classpath = runtime.join(path.delimiter);
    const target = path.join(directory, 'build-info.jar');
    const compilation = run(java, ['-Xmx512m', '-cp', [compiler, ...runtime].join(path.delimiter),
      'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
      '-classpath', classpath, '-d', target, ...files]);
    fs.writeFileSync(path.join(OUTPUT, 'build-metadata-native-compile.log'), compilation.stdout + compilation.stderr);
    if (compilation.exitCode !== 0) throw new Error('native_build_info_compile_failed');
    const execution = run(java, ['-cp', [target, classpath].join(path.delimiter), 'BuildInfoScenariosKt']);
    fs.writeFileSync(path.join(OUTPUT, 'build-metadata-native-run.log'), execution.stdout + execution.stderr);
    const result = JSON.parse(execution.stdout.trim());
    if (execution.exitCode !== 0 || result.passed !== true) throw new Error('native_build_info_scenario_failed');
    report.result = result;
    for (const file of report.sourceFiles) if (hash(fs.readFileSync(path.join(ROOT, file.file))) !== file.sha256) {
      throw new Error('native_build_info_source_changed_during_test');
    }
    report.status = 'PASS';
  } catch (error) { report.failure = error.message; process.exitCode = 1; }
  finally {
    cleanGeneratedDirectory(directory);
    report.limits = ['Host JVM and declared Android API fakes, not an Android framework/device execution.',
      'No AppMetrica SDK factory/key/consent/storage API exists in the test runtime classpath.'];
    fs.writeFileSync(path.join(OUTPUT, 'build-metadata-native-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, result: report.result, failure: report.failure }));
  }
}
main();
