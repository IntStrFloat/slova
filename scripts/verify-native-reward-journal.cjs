/* global __dirname */
// Executes the real production journal on the host JVM with an injected disk model.
// No Android device, network, dependency install, or production telemetry is involved.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Module } = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/yandex-mobile-ads/android/src/main/java/com/yandexmobileads/rewarded/RewardJournal.kt');
const ownershipSource = path.join(root, 'node_modules/yandex-mobile-ads/android/src/main/java/com/yandexmobileads/rewarded/RewardShowOwnership.kt');
const receiptContractSource = path.join(root, 'node_modules/yandex-mobile-ads/android/src/main/java/com/yandexmobileads/rewarded/RewardReceiptContract.kt');
const economySource = path.join(root, 'src/core/config/economy.ts');
const economyModule = new Module(economySource, module);
economyModule._compile(ts.transpileModule(fs.readFileSync(economySource, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, economySource);
const actualSectorAmounts = economyModule.exports.ECONOMY.wheel.sectors;
if (!Array.isArray(actualSectorAmounts) || actualSectorAmounts.length !== 8 || actualSectorAmounts.some((value) => !Number.isSafeInteger(value))) {
  throw new Error('Actual wheel economy could not be loaded');
}
const fixture = path.join(root, 'scripts/fixtures/native-reward-journal/RewardJournalScenarios.kt');
const output = path.join(root, 'output/product-improvements-2026-11-04/p0/native-journal');
const cache = path.join(process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'), 'caches/modules-2/files-2.1');
const version = '2.3.0';
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function cachedJar(group, artifact, release) {
  const directory = path.join(cache, group, artifact, release);
  const candidates = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => fs.readdirSync(path.join(directory, entry.name))
      .filter((name) => name === `${artifact}-${release}.jar`)
      .map((name) => path.join(directory, entry.name, name)));
  if (candidates.length !== 1) throw new Error(`Missing or ambiguous cached compiler dependency: ${artifact}`);
  return candidates[0];
}

function run(java, args) {
  const result = spawnSync(java, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

fs.mkdirSync(output, { recursive: true });
const report = { status: 'FAIL', source: path.relative(root, source).replaceAll('\\', '/'), sourceSha256: hash(source),
  ownershipSource: path.relative(root, ownershipSource).replaceAll('\\', '/'), ownershipSourceSha256: hash(ownershipSource),
  receiptContractSource: path.relative(root, receiptContractSource).replaceAll('\\', '/'), receiptContractSourceSha256: hash(receiptContractSource),
  economySourceSha256: hash(economySource), actualSectorAmounts,
  fixtureSha256: hash(fixture), compilerVersion: version,
  scope: 'Actual production Kotlin journal, host JVM, injected commit success/failure model',
  limits: ['Does not verify Android framework disk behavior, SDK ABI or native callback delivery.',
    'A failed native commit followed by process death has no durable earned proof; no grant is fabricated.'] };
try {
  const java = [process.env.SLOVA_REWARD_JOURNAL_JAVA_HOME, 'C:/Program Files/Android/Android Studio/jbr', process.env.JAVA_HOME]
    .filter(Boolean).map((directory) => path.join(directory, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
    .find((file) => fs.existsSync(file));
  if (!java) throw new Error('Java runtime is unavailable');
  const runtime = [
    ['org.jetbrains.kotlin', 'kotlin-stdlib', version], ['org.jetbrains.kotlin', 'kotlin-script-runtime', version],
    ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'], ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', version],
    ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'], ['org.jetbrains', 'annotations', '13.0'],
  ].map((coordinate) => cachedJar(...coordinate));
  const compiler = cachedJar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', version);
  const jar = path.join(output, 'journal-scenarios.jar');
  const compilation = run(java, ['-Xmx384m', '-Dfile.encoding=UTF-8', '-cp', [compiler, ...runtime].join(path.delimiter),
    'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
    '-classpath', runtime.join(path.delimiter), '-d', jar, source, ownershipSource, receiptContractSource, fixture]);
  fs.writeFileSync(path.join(output, 'compile.log'), compilation.stdout + compilation.stderr);
  if (compilation.status !== 0) throw new Error('Native journal compilation failed');
  const execution = run(java, ['-cp', [jar, ...runtime].join(path.delimiter), 'com.yandexmobileads.rewarded.RewardJournalScenariosKt', actualSectorAmounts.join(',')]);
  fs.writeFileSync(path.join(output, 'scenarios.log'), execution.stdout + execution.stderr);
  if (execution.status !== 0) throw new Error('Native journal scenario failed');
  const result = JSON.parse(execution.stdout.trim());
  if (!result.passed || hash(source) !== report.sourceSha256 || hash(ownershipSource) !== report.ownershipSourceSha256
    || hash(receiptContractSource) !== report.receiptContractSourceSha256 || hash(economySource) !== report.economySourceSha256) {
    throw new Error('Native journal verification did not complete');
  }
  Object.assign(report, { status: 'PASS', ...result });
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
}
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
