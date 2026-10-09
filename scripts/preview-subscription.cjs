const { spawn } = require('node:child_process');
const path = require('node:path');

// Developer preview uses the local billing sandbox, never production profiles.
const root = path.resolve(__dirname, '..');
const child = spawn(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'start', '--web', '--port', '8094'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CI: '0', SLOVA_LOCAL_PREVIEW: '1', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8791' },
});
child.on('error', () => { console.error('Local preview failed to start'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
