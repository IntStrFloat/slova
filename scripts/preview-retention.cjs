const { spawn } = require('node:child_process');
const path = require('node:path');

// Local visual QA uses a client-rendered preview and cannot write to production services.
const root = path.resolve(__dirname, '..');
const child = spawn(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'start', '--web', '--port', '8083'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CI: '0', SLOVA_LOCAL_PREVIEW: '1', EXPO_PUBLIC_API_URL: 'http://localhost:9' },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
