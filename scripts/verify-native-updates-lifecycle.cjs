/* global __dirname */
// Compile the actual production Updates and Review modules with declared API fakes. No SDK/device/network.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { cachedJar, javaExecutable, run, cleanGeneratedDirectory } = require('./verify-native-analytics-policy.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output/rustore-sdk-2026-11-02/sl-up');
const sourceNames = [
  'modules/rustore-updates/android/src/main/java/expo/modules/rustoreupdates/RuStoreUpdatesModule.kt',
  'modules/rustore-review/android/src/main/java/expo/modules/rustorereview/RuStoreReviewModule.kt',
];
const shared = ['AndroidApp.kt', 'Expo.kt', 'Lifecycle.kt', 'Queues.kt', 'React.kt', 'ReviewInfo.kt', 'RuStore.kt'];
const sources = [...sourceNames.map((name) => path.join(ROOT, name)),
  ...shared.map((name) => path.join(ROOT, 'scripts/fixtures/review-lifecycle', name)),
  ...fs.readdirSync(path.join(ROOT, 'scripts/fixtures/updates-lifecycle')).filter((name) => name.endsWith('.kt'))
    .map((name) => path.join(ROOT, 'scripts/fixtures/updates-lifecycle', name))];
const report = { status: 'FAIL', observedAt: new Date().toISOString(), network: false, device: false,
  sourceFiles: sources.map((file) => ({ file: path.relative(ROOT, file).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })) };
fs.mkdirSync(OUTPUT, { recursive: true });
fs.mkdirSync(path.join(ROOT, '.omx/tmp'), { recursive: true });
const directory = fs.mkdtempSync(path.join(ROOT, '.omx/tmp/native-policy-updates-'));
try {
  const java = javaExecutable();
  const compiler = cachedJar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.3.0');
  const runtime = [['org.jetbrains.kotlin', 'kotlin-stdlib', '2.3.0'], ['org.jetbrains.kotlin', 'kotlin-script-runtime', '2.3.0'],
    ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'], ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.3.0'],
    ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'], ['org.jetbrains', 'annotations', '13.0']].map((coordinate) => cachedJar(...coordinate));
  const classpath = runtime.join(path.delimiter);
  const target = path.join(directory, 'updates-lifecycle.jar');
  const compilation = run(java, ['-Xmx512m', '-cp', [compiler, ...runtime].join(path.delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', classpath, '-d', target, ...sources]);
  fs.writeFileSync(path.join(OUTPUT, 'implementation-native-compile.log'), compilation.stdout + compilation.stderr);
  if (compilation.exitCode !== 0) throw new Error('module_host_compile_failed');
  const execution = run(java, ['-cp', [target, classpath].join(path.delimiter), 'UpdatesScenariosKt']);
  fs.writeFileSync(path.join(OUTPUT, 'implementation-native-run.log'), execution.stdout + execution.stderr);
  report.result = JSON.parse(execution.stdout.trim());
  if (execution.exitCode !== 0 || !report.result.passed) throw new Error('module_lifecycle_scenarios_failed');
  report.status = 'PASS';
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  cleanGeneratedDirectory(directory);
  report.limits = ['Actual whole production Kotlin modules with declared API fakes, no copied lifecycle implementation.', 'Not Gradle/AAR/R8/device/store-service acceptance.'];
  fs.writeFileSync(path.join(OUTPUT, 'implementation-native.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, result: report.result, failure: report.failure }));
}
