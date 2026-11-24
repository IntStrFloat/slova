/* global __dirname */
// Real SDK error-model/public-transformer compile and behavior, without activation/network/Gradle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { cachedJar, javaExecutable, run, cleanGeneratedDirectory } = require('./verify-native-analytics-policy.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output/rustore-sdk-2026-11-02/tracer');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = (filename) => path.relative(ROOT, filename).replaceAll('\\', '/');
const sources = ['AppMetricaCrashSafety.kt', 'AppMetricaJsError.kt']
  .map((name) => path.join(ROOT, 'modules/appmetrica/android/src/main/java/expo/modules/appmetrica', name));
const fixture = path.join(ROOT, 'scripts/fixtures/appmetrica-crash-boundary/CrashBoundaryScenarios.kt');

function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, '.omx/tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, '.omx/tmp/native-policy-crash-'));
  const report = { status: 'FAIL', observedAt: new Date().toISOString(), sdkActivated: false, network: false,
    sourceFiles: [...sources, fixture].map((file) => ({ file: relative(file), sha256: hash(fs.readFileSync(file)) })) };
  try {
    const java = javaExecutable();
    const compiler = cachedJar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.3.0');
    const runtime = [['org.jetbrains.kotlin', 'kotlin-stdlib', '2.3.0'],
      ['org.jetbrains.kotlin', 'kotlin-script-runtime', '2.3.0'],
      ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'], ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.3.0'],
      ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'], ['org.jetbrains', 'annotations', '13.0']]
      .map((coordinate) => cachedJar(...coordinate));
    const sdkJars = [['io.appmetrica.analytics', 'analytics', '8.6.0', ''],
      ['io.appmetrica.analytics', 'analytics-core-utils', '8.6.0', ''],
      ['com.facebook.react', 'react-android', '0.85.3', 'release']].map(([group, artifact, version, classifier]) => {
      const aar = cachedJar(group, artifact, version, 'aar', classifier);
      const jar = path.join(directory, artifact + '.jar');
      const extracted = run('python', ['-c', 'import zipfile,sys; open(sys.argv[2],"wb").write(zipfile.ZipFile(sys.argv[1]).read("classes.jar"))', aar, jar]);
      if (extracted.exitCode !== 0) throw new Error('cached_sdk_extraction_failed');
      return { aar, jar, coordinate: [group, artifact, version, classifier].filter(Boolean).join(':') };
    });
    report.actualSdkArtifacts = sdkJars.map((entry) => ({ coordinate: entry.coordinate, aarSha256: hash(fs.readFileSync(entry.aar)) }));
    const classpath = [...sdkJars.map((entry) => entry.jar), ...runtime].join(path.delimiter);
    const target = path.join(directory, 'crash-boundary.jar');
    const compilation = run(java, ['-Xmx512m', '-cp', [compiler, ...runtime].join(path.delimiter),
      'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
      '-classpath', classpath, '-d', target, ...sources, fixture]);
    fs.writeFileSync(path.join(OUTPUT, 'native-boundary-compile.log'), compilation.stdout + compilation.stderr);
    if (compilation.exitCode !== 0) throw new Error('real_sdk_boundary_compile_failed');
    const execution = run(java, ['-cp', [target, classpath].join(path.delimiter), 'CrashBoundaryScenariosKt']);
    fs.writeFileSync(path.join(OUTPUT, 'native-boundary-run.log'), execution.stdout + execution.stderr);
    const result = JSON.parse(execution.stdout.trim());
    if (execution.exitCode !== 0 || !result.passed || !result.realSdkErrorBuilders) throw new Error('real_sdk_boundary_scenario_failed');
    report.result = result;
    report.status = 'PASS';
  } catch (error) { report.failure = error.message; process.exitCode = 1; }
  finally {
    cleanGeneratedDirectory(directory);
    report.limits = ['Actual cached SDK public error models and transformer API; no SDK activation/transport.',
      'Not an Android module/lifecycle/R8/device or server-delivery acceptance test.'];
    fs.writeFileSync(path.join(OUTPUT, 'native-boundary-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, result: report.result, failure: report.failure }));
  }
}
main();
