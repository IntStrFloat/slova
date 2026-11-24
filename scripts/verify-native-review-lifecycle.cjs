/* global __dirname */
// Runs the actual production Review module against declared Android/Expo/RuStore API fakes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { cachedJar, javaExecutable, run, cleanGeneratedDirectory } = require('./verify-native-analytics-policy.cjs');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'modules/rustore-review/android/src/main/java/expo/modules/rustorereview/RuStoreReviewModule.kt');
const FIXTURES = path.join(ROOT, 'scripts/fixtures/review-lifecycle');
const OUTPUT = path.join(ROOT, 'output/rustore-sdk-2026-11-02/sl-rv');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = (filename) => path.relative(ROOT, filename).replaceAll('\\', '/');

function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, '.omx/tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, '.omx/tmp/native-policy-review-'));
  const sources = [SOURCE, ...fs.readdirSync(FIXTURES).filter((name) => name.endsWith('.kt')).map((name) => path.join(FIXTURES, name))];
  const suffix = process.argv.includes('--baseline') ? 'before' : 'after';
  const report = { status: 'FAIL', observedAt: new Date().toISOString(), network: false, device: false,
    sourceFiles: sources.map((filename) => ({ file: relative(filename), sha256: hash(fs.readFileSync(filename)) })) };
  try {
    const java = javaExecutable();
    const compiler = cachedJar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.3.0');
    const runtime = [['org.jetbrains.kotlin', 'kotlin-stdlib', '2.3.0'], ['org.jetbrains.kotlin', 'kotlin-script-runtime', '2.3.0'],
      ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'], ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.3.0'],
      ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'], ['org.jetbrains', 'annotations', '13.0']]
      .map((coordinate) => cachedJar(...coordinate));
    const classpath = runtime.join(path.delimiter);
    const target = path.join(directory, 'review-lifecycle.jar');
    const compilation = run(java, ['-Xmx512m', '-cp', [compiler, ...runtime].join(path.delimiter),
      'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
      '-classpath', classpath, '-d', target, ...sources]);
    fs.writeFileSync(path.join(OUTPUT, `implementation-native-${suffix}-compile.log`), compilation.stdout + compilation.stderr);
    if (compilation.exitCode !== 0) throw new Error('module_host_compile_failed');
    const execution = run(java, ['-cp', [target, classpath].join(path.delimiter), 'ReviewScenariosKt']);
    fs.writeFileSync(path.join(OUTPUT, `implementation-native-${suffix}-run.log`), execution.stdout + execution.stderr);
    report.result = JSON.parse(execution.stdout.trim());
    if (execution.exitCode !== 0 || !report.result.passed) throw new Error('module_lifecycle_scenarios_failed');
    report.status = 'PASS';
  } catch (error) { report.failure = error.message; process.exitCode = 1; }
  finally {
    cleanGeneratedDirectory(directory);
    report.limits = ['Whole production Kotlin module with declared API fakes; no copied lifecycle implementation.',
      'Not actual SDK/module Gradle/R8/device/form/transport acceptance.'];
    fs.writeFileSync(path.join(OUTPUT, `implementation-native-${suffix}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, result: report.result, failure: report.failure }));
  }
}
main();
