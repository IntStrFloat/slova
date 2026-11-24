/* global __dirname */
// Local build-matched archive and offline symbolication. Never uploads or contacts a service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { javaExecutable } = require('./verify-native-analytics-policy.cjs');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'output/rustore-sdk-2026-11-02/tracer');
const SDK = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk');
const hashFile = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function check(value, code) { if (!value) throw new Error(code); }
function withinWorkspace(filename) {
  const full = path.resolve(ROOT, filename);
  check(full.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep), 'path_outside_workspace');
  let current = full;
  while (current !== ROOT) {
    if (fs.existsSync(current)) check(!fs.lstatSync(current).isSymbolicLink(), 'linked_path_refused');
    current = path.dirname(current);
  }
  return full;
}
function run(executable, args, input) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8', input, windowsHide: true,
    timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  check(!result.error && result.status === 0, 'local_tool_failed:' + path.basename(executable));
  return result.stdout;
}
function ndkTool(name) {
  const ndk = path.join(SDK, 'ndk');
  const candidates = fs.readdirSync(ndk).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const tool = candidates.map((version) => path.join(ndk, version, 'toolchains/llvm/prebuilt', host, 'bin', name + suffix))
    .find((filename) => fs.existsSync(filename));
  check(tool, 'installed_ndk_tool_missing');
  return tool;
}
function copyChecked(source, output, relative) {
  const target = withinWorkspace(path.join(output, relative));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) check(hashFile(target) === hashFile(source), 'existing_archive_file_differs');
  else fs.copyFileSync(source, target);
  return { file: relative.replaceAll('\\', '/'), sha256: hashFile(target), bytes: fs.statSync(target).size };
}
function elfMetadata(filename) {
  const bytes = fs.readFileSync(filename);
  check(bytes.subarray(0, 4).toString('hex') === '7f454c46' && bytes[5] === 1, 'not_supported_elf');
  const abi = { 3: 'x86', 40: 'armeabi-v7a', 62: 'x86_64', 183: 'arm64-v8a' }[bytes.readUInt16LE(18)];
  check(abi, 'unknown_elf_abi');
  const notes = run(ndkTool('llvm-readelf'), ['--notes', filename]);
  const sections = run(ndkTool('llvm-readelf'), ['--sections', filename]);
  return { abi, buildId: notes.match(/Build ID:\s*([a-f0-9]+)/i)?.[1]?.toLowerCase() ?? null,
    hasDwarf: sections.includes('.debug_info'), hasSymbols: sections.includes('.symtab') };
}
function packagedNativeBinding(artifact, metadata, library) {
  check(metadata.buildId, 'unstripped_native_build_id_missing');
  const entry = `${path.extname(artifact).toLowerCase() === '.aab' ? 'base/' : ''}lib/${metadata.abi}/${library}`;
  const temporaryParent = withinWorkspace(path.join(ROOT, '.omx/tmp'));
  fs.mkdirSync(temporaryParent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryParent, 'crash-packaged-elf-'));
  const extracted = path.join(directory, 'packaged.so');
  try {
    const info = JSON.parse(run('python', ['-c',
      'import zipfile,hashlib,json,sys; z=zipfile.ZipFile(sys.argv[1]); items=[i for i in z.infolist() if i.filename==sys.argv[2]]; b=z.read(items[0]) if len(items)==1 else None; open(sys.argv[3],"wb").write(b) if b is not None else None; print(json.dumps({"found":b is not None,"sha256":hashlib.sha256(b).hexdigest() if b is not None else None,"bytes":len(b) if b is not None else None}))',
      artifact, entry, extracted]));
    check(info.found, 'packaged_native_library_missing_or_ambiguous');
    const packaged = elfMetadata(extracted);
    check(packaged.abi === metadata.abi, 'packaged_native_abi_mismatch');
    check(packaged.buildId, 'packaged_native_build_id_missing');
    check(packaged.buildId === metadata.buildId, 'packaged_native_build_id_mismatch');
    return { entry, sha256: info.sha256, bytes: info.bytes, abi: packaged.abi, buildId: packaged.buildId };
  } finally {
    // Only the one extracted file in this fresh, verified task directory is removed.
    check(path.dirname(fs.realpathSync(directory)) === fs.realpathSync(temporaryParent), 'unsafe_packaged_elf_cleanup');
    withinWorkspace(extracted);
    if (fs.existsSync(extracted)) fs.unlinkSync(extracted);
    fs.rmdirSync(directory);
  }
}
function verifyArchive(directory) {
  const output = withinWorkspace(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  check(manifest.version === 1, 'unknown_archive_schema');
  for (const item of [manifest.bundle, manifest.map, manifest.mapping, ...manifest.native].filter(Boolean)) {
    const filename = withinWorkspace(path.join(output, item.file));
    check(filename.startsWith(output + path.sep) && hashFile(filename) === item.sha256, 'archive_hash_mismatch');
  }
  const artifact = withinWorkspace(manifest.artifact.source);
  check(hashFile(artifact) === manifest.artifact.sha256, 'artifact_hash_mismatch');
  for (const item of manifest.native) {
    check(item.packaged, 'native_artifact_binding_missing');
    const symbols = withinWorkspace(path.join(output, item.file));
    const metadata = elfMetadata(symbols);
    check(metadata.abi === item.abi && metadata.buildId === item.buildId && metadata.hasDwarf === item.hasDwarf
      && metadata.hasSymbols === item.hasSymbols, 'archived_native_metadata_mismatch');
    const actual = packagedNativeBinding(artifact, metadata, path.basename(symbols));
    check(['entry', 'sha256', 'abi', 'buildId', 'bytes'].every((key) => actual[key] === item.packaged[key]), 'packaged_native_binding_mismatch');
  }
  return { output, manifest };
}
function archive(options) {
  check(/^[a-z0-9_.-]{1,64}$/i.test(options['build-id'] || ''), 'invalid_build_id');
  const output = withinWorkspace(options.output || path.join(DEFAULT_OUTPUT, 'symbols', options['build-id']));
  const artifact = withinWorkspace(options.artifact);
  const bundle = withinWorkspace(options.bundle);
  const map = withinWorkspace(options.map);
  const sourceMap = JSON.parse(fs.readFileSync(map, 'utf8'));
  const sourceProof = ['src/features/crash-reporting/index.ts', 'src/features/crash-reporting/policy.ts', 'src/core/native/appmetrica.ts']
    .map((file) => {
      const positions = sourceMap.sources.flatMap((source, index) => source.replaceAll('\\', '/').endsWith(file) ? [index] : []);
      check(positions.length === 1 && sourceMap.sourcesContent[positions[0]] === fs.readFileSync(path.join(ROOT, file), 'utf8'), 'compiled_crash_source_mismatch');
      return { file, sha256: hashFile(path.join(ROOT, file)) };
    });
  const embeddedHash = JSON.parse(run('python', ['-c',
    'import zipfile,hashlib,json,sys; z=zipfile.ZipFile(sys.argv[1]); n="base/assets/index.android.bundle" if sys.argv[1].endswith(".aab") else "assets/index.android.bundle"; print(json.dumps({"sha256":hashlib.sha256(z.read(n)).hexdigest()}))', artifact])).sha256;
  check(embeddedHash === hashFile(bundle), 'artifact_bundle_mismatch');
  // Validate every native input against this artifact before creating/copying archive files.
  const nativeInputs = (options.native || []).map((filename) => {
    const source = withinWorkspace(filename);
    const metadata = elfMetadata(source);
    return { source, metadata, packaged: packagedNativeBinding(artifact, metadata, path.basename(source)) };
  });
  fs.mkdirSync(output, { recursive: true });
  const manifest = { version: 1, buildId: options['build-id'], observedAt: new Date().toISOString(),
    artifact: { source: path.relative(ROOT, artifact).replaceAll('\\', '/'), sha256: hashFile(artifact), embeddedBundleSha256: embeddedHash },
    bundle: copyChecked(bundle, output, 'index.android.bundle'), map: copyChecked(map, output, 'index.android.bundle.map'),
    sourceProof, native: [], mapping: null,
    provenanceLimit: 'Final map and embedded bundle archived from one completed root build; source bytes checked. Actual controlled crash/source resolution is separate.',
    vendorLimit: 'Stripped vendor libraries do not prove source-line symbols; only matching app-owned unstripped ELF does.' };
  for (const { source, metadata, packaged } of nativeInputs) {
    manifest.native.push({ ...copyChecked(source, output, path.join('native', metadata.abi, path.basename(source))), ...metadata, packaged });
  }
  if (options.mapping) manifest.mapping = copyChecked(withinWorkspace(options.mapping), output, 'mapping.txt');
  else manifest.mappingStatus = 'not_provided_do_not_claim_r8_retrace';
  const target = path.join(output, 'manifest.json');
  if (fs.existsSync(target)) {
    const previous = JSON.parse(fs.readFileSync(target, 'utf8'));
    check(previous.artifact.sha256 === manifest.artifact.sha256 && previous.map.sha256 === manifest.map.sha256, 'archive_build_id_reused');
  }
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
  return { status: 'archive_created', manifest: path.relative(ROOT, target), nativeLibraries: manifest.native.length };
}
function parseNativeFrame(trace, library, buildId) {
  for (const line of trace.split(/\r?\n/)) {
    if (!line.includes(library)) continue;
    const pc = line.match(/#\d+\s+pc\s+([a-f0-9]+)/i)?.[1];
    const observedBuild = line.match(/BuildId:\s*([a-f0-9]+)/i)?.[1]?.toLowerCase();
    if (pc && observedBuild === buildId?.toLowerCase()) return '0x' + pc;
  }
  throw new Error('matching_native_frame_build_id_missing');
}
function symbolicate(options) {
  const { output, manifest } = verifyArchive(options.archive);
  const traceFile = withinWorkspace(options.trace);
  check(fs.statSync(traceFile).size <= 131072, 'controlled_trace_too_large');
  const raw = fs.readFileSync(traceFile, 'utf8');
  let text;
  if (options.kind === 'js') {
    let trace = raw;
    if (raw.trim().startsWith('{')) {
      const record = JSON.parse(raw);
      check(record.status === 'qa_local' && record.sdk_activated === false && Array.isArray(record.frames), 'not_local_qa_record');
      trace = record.frames.map((frame) => {
        check(frame.file === 'index.android.bundle' && Number.isInteger(frame.line) && frame.line > 0 && Number.isInteger(frame.column) && frame.column >= 0, 'invalid_qa_frame');
        return `anonymous@${frame.line}:${frame.column}`;
      }).join('\n');
    }
    text = run(process.execPath, [path.join(ROOT, 'node_modules/metro-symbolicate/src/index.js'), path.join(output, manifest.map.file)], trace);
  } else if (options.kind === 'native') {
    const library = options.library || 'libslova_crash_qa.so';
    const elf = manifest.native.find((item) => path.basename(item.file) === library && item.abi === (options.abi || 'x86_64'));
    check(elf?.hasDwarf && elf.buildId, 'matching_unstripped_native_symbols_missing');
    const pc = parseNativeFrame(raw, library, elf.buildId);
    text = run(ndkTool('llvm-addr2line'), ['-C', '-f', '-i', '-e', path.join(output, elf.file), pc]);
  } else if (options.kind === 'jvm') {
    text = manifest.mapping ? run(javaExecutable(), ['-cp', path.join(SDK, 'cmdline-tools/latest/lib/retrace-classpath.jar'),
      'com.android.tools.r8.retrace.Retrace', path.join(output, manifest.mapping.file), traceFile]) : raw;
  } else throw new Error('unknown_crash_kind');
  check(typeof options.expect === 'string' && options.expect.length > 0 && text.includes(options.expect), 'expected_source_frame_missing');
  const destination = withinWorkspace(options.output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text);
  const result = { status: 'PASS', kind: options.kind, archiveBuildId: manifest.buildId,
    traceSha256: hashFile(traceFile), symbolicatedSha256: hashFile(destination), expected: options.expect,
    sdkDelivery: 'not_tested', source: 'caller_supplied_local_trace', deviceExecutionVerifiedByThisTool: false,
    verificationScope: 'Offline source resolution with archived hashes; root device-capture evidence is separate',
    jvmRetraced: options.kind === 'jvm' ? !!manifest.mapping : undefined };
  fs.writeFileSync(destination + '.verification.json', JSON.stringify(result, null, 2));
  return result;
}
function main() {
  const [operation, ...args] = process.argv.slice(2);
  const allowed = operation === 'archive' ? ['artifact', 'bundle', 'map', 'build-id', 'output', 'native', 'mapping']
    : ['archive', 'kind', 'trace', 'output', 'library', 'abi', 'expect'];
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    check(args[i]?.startsWith('--') && allowed.includes(key) && args[i + 1] && !args[i + 1].startsWith('--'), 'invalid_arguments');
    if (key === 'native') (options.native ??= []).push(args[i + 1]);
    else { check(options[key] === undefined, 'duplicate_argument'); options[key] = args[i + 1]; }
  }
  console.log(JSON.stringify(operation === 'archive' ? archive(options) : symbolicate(options)));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseNativeFrame, verifyArchive, withinWorkspace, ndkTool };
