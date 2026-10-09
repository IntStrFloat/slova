const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..');
const outputRoot = path.resolve(workspace, 'output', 'yandex-games');
const buildDir = path.resolve(outputRoot, 'build');
const archivePath = path.resolve(outputRoot, 'slova-yandex-games.zip');
const manifestPath = path.resolve(outputRoot, 'manifest.json');

function assertInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe output path: ${candidate}`);
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

assertInside(workspace, outputRoot);
assertInside(outputRoot, buildDir);
assertInside(outputRoot, archivePath);
fs.mkdirSync(outputRoot, { recursive: true });
fs.rmSync(buildDir, { recursive: true, force: true });

const expoCli = path.join(workspace, 'node_modules', 'expo', 'bin', 'cli');
const exportResult = spawnSync(
  process.execPath,
  [expoCli, 'export', '--platform', 'web', '--output-dir', buildDir, '--clear'],
  {
    cwd: workspace,
    env: { ...process.env, EXPO_PUBLIC_GAME_PLATFORM: 'yandex-games' },
    stdio: 'inherit',
  },
);
if (exportResult.error) throw exportResult.error;
if (exportResult.status !== 0) process.exit(exportResult.status ?? 1);

const indexPath = path.join(buildDir, 'index.html');
if (!fs.existsSync(indexPath)) throw new Error('index.html is missing from the build root');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
if (!indexHtml.includes('src="/sdk.js"')) {
  throw new Error('The Yandex Games SDK loader is missing from index.html');
}
if (/(?:src|href)="\/(?:_expo|assets)\//u.test(indexHtml)) {
  throw new Error('The build contains root-absolute Expo assets that will break in the Yandex version path');
}
if (!indexHtml.includes('src="./_expo/')) {
  throw new Error('The Expo web bundle is not relative to the Yandex version path');
}
if (!indexHtml.includes('yandexVersionDirectory')) {
  throw new Error('The Yandex runtime path normalizer is missing from index.html');
}
if (!indexHtml.includes('__YANDEX_GAMES_SDK_PROMISE__')) {
  throw new Error('The inline Yandex SDK bootstrap is missing from index.html');
}
if (!indexHtml.includes('__YANDEX_GAME_READY_PROMISE__')) {
  throw new Error('The early Yandex LoadingAPI.ready bootstrap is missing from index.html');
}
if (!indexHtml.includes('__YANDEX_GAMES_LANGUAGE__')) {
  throw new Error('The Yandex portal language bootstrap is missing from index.html');
}
if (!indexHtml.includes("addEventListener('contextmenu'")) {
  throw new Error('The Yandex context-menu guard is missing from index.html');
}

const files = walk(buildDir);
const invalidNames = files
  .map((file) => path.relative(buildDir, file))
  .filter((relative) => /[\s\u0400-\u04ff]/u.test(relative));
if (invalidNames.length > 0) {
  throw new Error(`Invalid Yandex Games filenames:\n${invalidNames.join('\n')}`);
}

const unpackedBytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
const limitBytes = 100 * 1024 * 1024;
if (unpackedBytes > limitBytes) {
  throw new Error(`Unpacked build is ${(unpackedBytes / 1024 / 1024).toFixed(1)} MB; limit is 100 MB`);
}

if (process.platform !== 'win32') {
  throw new Error('ZIP packaging currently requires Windows PowerShell');
}
const packageResult = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(__dirname, 'package-yandex-games.ps1'),
    '-Source',
    buildDir,
    '-Destination',
    archivePath,
  ],
  { cwd: workspace, stdio: 'inherit' },
);
if (packageResult.error) throw packageResult.error;
if (packageResult.status !== 0) process.exit(packageResult.status ?? 1);

const manifest = {
  platform: 'yandex-games',
  generatedAt: new Date().toISOString(),
  archive: path.relative(workspace, archivePath).replaceAll('\\', '/'),
  indexAtArchiveRoot: true,
  sdkLoader: '/sdk.js',
  fileCount: files.length,
  unpackedBytes,
  archiveBytes: fs.statSync(archivePath).size,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Yandex Games archive: ${archivePath}`);
console.log(`Unpacked size: ${(unpackedBytes / 1024 / 1024).toFixed(1)} MB`);
