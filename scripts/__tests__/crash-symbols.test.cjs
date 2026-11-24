const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseNativeFrame, verifyArchive, withinWorkspace, ndkTool } = require('../crash-symbols.cjs');

test('native source proof requires the actual library build ID, not only a plausible PC', () => {
  const frame = '#01 pc 00000000000018ab /data/app/base.apk!libslova_crash_qa.so (BuildId: abc123)';
  assert.equal(parseNativeFrame(frame, 'libslova_crash_qa.so', 'abc123'), '0x00000000000018ab');
  assert.throws(() => parseNativeFrame(frame, 'libslova_crash_qa.so', 'another-build'), /build_id_missing/);
  assert.throws(() => parseNativeFrame(frame, 'libother.so', 'abc123'), /build_id_missing/);
});

test('archive verification rejects modified source maps and workspace escapes', () => {
  const base = path.resolve(__dirname, '../../.omx/tmp');
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'crash-symbol-test-'));
  const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  try {
    const artifact = path.join(directory, 'fixture.apk');
    fs.writeFileSync(artifact, 'synthetic-local-archive-test');
    fs.writeFileSync(path.join(directory, 'map'), 'map-before');
    const root = path.resolve(__dirname, '../..');
    const manifest = { version: 1, artifact: { source: path.relative(root, artifact), sha256: digest('synthetic-local-archive-test') },
      map: { file: 'map', sha256: digest('map-before') }, native: [] };
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.doesNotThrow(() => verifyArchive(directory));
    fs.writeFileSync(path.join(directory, 'map'), 'map-after');
    assert.throws(() => verifyArchive(directory), /hash_mismatch/);
    assert.throws(() => withinWorkspace('../outside-map'), /outside_workspace/);
  } finally {
    // This exact fixture directory contains only the three files created above.
    for (const name of ['fixture.apk', 'map', 'manifest.json']) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
});

test('archive requires packaged APK/AAB native ELF bindings', async (t) => {
  const root = path.resolve(__dirname, '../..');
  const base = withinWorkspace(path.join(root, '.omx/tmp'));
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'crash-native-binding-'));
  const invoke = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const mustRun = (command, args) => {
    const result = invoke(command, args);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  };
  function removeOwn(target) {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(base));
    assert.ok(path.basename(directory).startsWith('crash-native-binding-'));
    for (const name of fs.readdirSync(target)) {
      const file = path.join(target, name);
      const stat = fs.lstatSync(file);
      assert.ok(!stat.isSymbolicLink(), 'fixture cleanup refuses filesystem links');
      if (stat.isDirectory()) removeOwn(file); else fs.unlinkSync(file);
    }
    fs.rmdirSync(target);
  }
  try {
    // Real tiny Android ELF libraries, compiled only under this private regression directory.
    // The ZIP's JS bytes/map are synthetic; this test proves native artifact binding, not device execution.
    const source = path.join(directory, 'fixture.c');
    fs.writeFileSync(source, 'int slova_symbol_fixture(void) { return FIXTURE_VALUE; }\n');
    const elf = (name, value, target = 'x86_64', buildId = true) => {
      const file = path.join(directory, name + '.so');
      mustRun(ndkTool('clang'), [`--target=${target}-linux-android24`, '-shared', '-nostdlib', '-g', '-O0',
        `-DFIXTURE_VALUE=${value}`, `-Wl,--build-id=${buildId ? 'sha1' : 'none'}`, source, '-o', file]);
      return file;
    };
    const a = elf('build-a', 1);
    const b = elf('build-b', 2);
    const arm = elf('build-arm', 1, 'aarch64');
    const noId = elf('build-no-id', 1, 'x86_64', false);
    const packaged = path.join(directory, 'packaged-a.so');
    fs.copyFileSync(a, packaged);
    mustRun(ndkTool('llvm-strip'), ['--strip-debug', packaged]);
    // The input basename is the actual library name expected inside the ZIP.
    const symbols = path.join(directory, 'libfixture.so');
    const bundle = path.join(directory, 'bundle');
    const map = path.join(directory, 'map.json');
    fs.writeFileSync(bundle, 'synthetic-hermes-artifact-binding-fixture');
    const sourceFiles = ['src/features/crash-reporting/index.ts', 'src/features/crash-reporting/policy.ts', 'src/core/native/appmetrica.ts'];
    fs.writeFileSync(map, JSON.stringify({ version: 3, names: [], mappings: '', sources: sourceFiles,
      sourcesContent: sourceFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')) }));
    const makePackage = (name, nativeFile, abi = 'x86_64') => {
      const artifact = path.join(directory, name);
      mustRun('python', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); p="base/" if sys.argv[1].endswith(".aab") else ""; z.write(sys.argv[2],p+"assets/index.android.bundle"); native=sys.argv[3]; z.write(native,p+"lib/"+sys.argv[4]+"/libfixture.so") if native!="missing" else None; z.close()',
        artifact, bundle, nativeFile || 'missing', abi]);
      return artifact;
    };
    const apkA = makePackage('artifact-a.apk', packaged);
    const aabA = makePackage('artifact-a.aab', packaged);
    const wrongAbi = makePackage('wrong-abi.apk', arm);
    const missingId = makePackage('missing-id.apk', noId);
    const missingLib = makePackage('missing-library.apk', null);
    const create = (artifact, symbolFile, outputName) => {
      fs.copyFileSync(symbolFile, symbols);
      return invoke(process.execPath, [path.join(root, 'scripts/crash-symbols.cjs'), 'archive', '--artifact', artifact,
        '--bundle', bundle, '--map', map, '--build-id', outputName, '--output', path.join(directory, outputName), '--native', symbols]);
    };
    await t.test('matching stripped packaged ELF and unstripped symbols are accepted for APK and AAB', () => {
      for (const [artifact, outputName] of [[apkA, 'matching-apk'], [aabA, 'matching-aab']]) {
        const result = create(artifact, a, outputName);
        assert.equal(result.status, 0, result.stderr);
        const archive = path.join(directory, outputName);
        const { manifest } = verifyArchive(archive);
        assert.equal(manifest.native[0].packaged.buildId, manifest.native[0].buildId);
        const file = path.join(archive, 'manifest.json');
        const broken = structuredClone(manifest);
        broken.native[0].packaged.buildId = 'wrong-build';
        fs.writeFileSync(file, JSON.stringify(broken));
        assert.throws(() => verifyArchive(archive), /packaged_native_binding_mismatch/);
        fs.writeFileSync(file, JSON.stringify(manifest));
      }
    });
    await t.test('artifact A with ELF B fails before writing an archive manifest', () => {
      const result = create(apkA, b, 'mixed-build');
      assert.notEqual(result.status, 0, 'same JS bytes must not accept symbols from a different native build');
      assert.match(result.stderr, /native_build_id_mismatch/);
      assert.equal(fs.existsSync(path.join(directory, 'mixed-build/manifest.json')), false);
    });
    await t.test('wrong ABI, missing packaged BuildId and missing library fail closed', () => {
      for (const [artifact, name, code] of [[wrongAbi, 'wrong-abi-out', /native_abi_mismatch/],
        [missingId, 'missing-id-out', /native_build_id_missing/], [missingLib, 'missing-lib-out', /native_library_missing/]]) {
        const result = create(artifact, a, name);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, code);
      }
      const result = create(apkA, noId, 'unstripped-missing-id-out');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /native_build_id_missing/);
    });
  } finally { removeOwn(directory); }
});
