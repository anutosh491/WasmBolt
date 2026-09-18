import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'compiler');
const source = JSON.parse(
  await readFile(resolve(root, 'runtime/sources.json'))
);
const required = ['Compiler.js', 'Compiler.wasm', 'Compiler.data'];
const workerNames = [
  'worker.js',
  'utility-worker.js',
  'tool-worker.js',
  'wat-worker.js',
  'clangd-worker.js',
  'debug-worker.js'
];
const action = process.argv[2];

const optionalGroups = {
  clangd: ['clangd.js', 'clangd.wasm.gz'],
  mlir: [
    'mlir-opt.js',
    'mlir-opt.wasm',
    'mlir-translate.js',
    'mlir-translate.wasm'
  ],
  'lldb-dap': ['lldb-dap.js', 'lldb-dap.wasm', 'lldb-dap.worker.js']
};
const pipelineGroups = {
  opt: ['opt.js', 'opt.wasm'],
  llc: ['llc.js', 'llc.wasm']
};
const debugSysrootFiles = [
  'crt1.o',
  'libGL-getprocaddr.a',
  'libal.a',
  'libhtml5.a',
  'libstandalonewasm-nocatch.a',
  'libstubs-debug.a',
  'libc-debug.a',
  'libdlmalloc-debug.a',
  'libcompiler_rt.a',
  'libc++-noexcept.a',
  'libc++abi-debug-noexcept.a',
  'libsockets.a'
];

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, XDG_CACHE_HOME: resolve(root, '.cache') },
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}.`);
  }
}

async function stage(directory, origin) {
  await mkdir(output, { recursive: true });
  await rm(resolve(output, 'lldb'), { recursive: true, force: true });
  const files = {};
  for (const name of required) {
    const file = resolve(directory, name);
    const bytes = await readFile(file);
    if (!bytes.length) {
      throw new Error(`${name} is empty.`);
    }
    await copyFile(file, resolve(output, name));
    files[name] = { bytes: bytes.length, sha256: digest(bytes) };
  }
  const copyAsset = async (sourcePath, name) => {
    const bytes = await readFile(sourcePath);
    if (!bytes.length) {
      throw new Error(`${name} is empty.`);
    }
    const destination = resolve(output, name);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(sourcePath, destination);
    files[name] = { bytes: bytes.length, sha256: digest(bytes) };
  };

  const llvmDirectory = resolve(directory, 'llvm');
  await rm(resolve(output, 'llvm'), { recursive: true, force: true });
  for (const name of ['llvm.js', 'llvm.wasm']) {
    await copyAsset(resolve(llvmDirectory, name), `llvm/${name}`);
  }

  const packageDirectory = resolve(directory, 'packages');
  await rm(resolve(output, 'packages'), { recursive: true, force: true });
  const packageMetadata = JSON.parse(
    await readFile(resolve(packageDirectory, 'empack_env_meta.json'))
  );
  if (
    packageMetadata.prefix !== '/' ||
    !Array.isArray(packageMetadata.packages)
  ) {
    throw new Error('The empack package metadata is invalid.');
  }
  await copyAsset(
    resolve(packageDirectory, 'empack_env_meta.json'),
    'packages/empack_env_meta.json'
  );
  for (const entry of packageMetadata.packages) {
    if (
      !entry ||
      typeof entry.filename !== 'string' ||
      !/^[A-Za-z0-9_.+-]+\.tar\.gz$/.test(entry.filename)
    ) {
      throw new Error('The empack package metadata contains an invalid file.');
    }
    await copyAsset(
      resolve(packageDirectory, entry.filename),
      `packages/${entry.filename}`
    );
  }

  const stagedGroups = [];
  for (const [group, names] of Object.entries(optionalGroups)) {
    const groupDirectory = resolve(directory, group);
    await rm(resolve(output, group), { recursive: true, force: true });
    let available;
    try {
      available = await readdir(groupDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!names.every(name => available.includes(name))) {
      throw new Error(`${group} contains only part of its runtime.`);
    }
    for (const name of names) {
      await copyAsset(resolve(groupDirectory, name), `${group}/${name}`);
    }
    stagedGroups.push(group);
  }
  const stagedPipeline = [];
  for (const [group, names] of Object.entries(pipelineGroups)) {
    const groupDirectory = resolve(directory, group);
    await rm(resolve(output, group), { recursive: true, force: true });
    let available;
    try {
      available = await readdir(groupDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!names.every(name => available.includes(name))) {
      throw new Error(`${group} contains only part of its runtime.`);
    }
    for (const name of names) {
      await copyAsset(resolve(groupDirectory, name), `${group}/${name}`);
    }
    stagedPipeline.push(group);
  }
  if (stagedPipeline.length !== 0 && stagedPipeline.length !== 2) {
    throw new Error('opt and llc must be staged together.');
  }
  const debugSysroot = resolve(directory, 'debug-sysroot');
  await rm(resolve(output, 'debug-sysroot'), {
    recursive: true,
    force: true
  });
  let stagedDebugSysroot = false;
  try {
    const available = await readdir(debugSysroot);
    if (!debugSysrootFiles.every(name => available.includes(name))) {
      throw new Error(
        'The debugger sysroot contains only part of its runtime.'
      );
    }
    for (const name of debugSysrootFiles) {
      await copyAsset(resolve(debugSysroot, name), `debug-sysroot/${name}`);
    }
    stagedDebugSysroot = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await rm(resolve(output, 'licenses'), { recursive: true, force: true });
  await mkdir(resolve(output, 'licenses'), { recursive: true });
  for (const name of await readdir(resolve(root, 'runtime/licenses'))) {
    const bytes = await readFile(resolve(root, 'runtime/licenses', name));
    await writeFile(resolve(output, 'licenses', name), bytes);
    files[`licenses/${name}`] = {
      bytes: bytes.length,
      sha256: digest(bytes)
    };
  }
  const metadata = {
    format: 1,
    version: source.llvm,
    resourceDirectory: `/lib/clang/${source.llvm.split('.')[0]}`,
    origin,
    revision: source.revision,
    emscripten: source.emscripten,
    utilityOrigin: origin,
    packageOrigin: origin,
    watOrigin: 'npm',
    watVersion: source.wabt,
    ...(stagedPipeline.length === 2
      ? {
          pipelineOrigin: origin,
          pipelineTargets: source.pipelineTargets
        }
      : {}),
    ...(stagedDebugSysroot
      ? {
          debugSysrootOrigin: origin,
          debugSysrootEmscripten: source.emscripten
        }
      : {}),
    files
  };
  const stagedLlvmGroups = stagedGroups.filter(group => group !== 'lldb-dap');
  if (stagedLlvmGroups.length || stagedPipeline.length) {
    metadata.llvmServices = {
      revision: source.llvmRevision,
      emscripten: source.emscripten
    };
  }
  if (stagedGroups.length) {
    for (const group of stagedGroups) {
      metadata[`${group === 'lldb-dap' ? 'debugger' : group}Origin`] = origin;
    }
  }
  if (stagedGroups.includes('clangd')) {
    Object.assign(metadata, {
      clangdVersion: source.llvm,
      clangdRevision: source.llvmRevision,
      clangdEmscripten: source.emscripten,
      clangdThreaded: true
    });
  }
  if (stagedGroups.includes('lldb-dap')) {
    Object.assign(metadata, {
      debuggerRevision: source.debuggerRevision,
      debuggerEmscripten: source.debuggerEmscripten,
      debuggerWamrRevision: source.debuggerWamrRevision,
      debuggerThreaded: true
    });
  }
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );
}

async function stageDebugger(directory) {
  const manifestPath = resolve(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  if (
    manifest.format !== 1 ||
    manifest.origin !== 'source' ||
    manifest.revision !== source.revision ||
    manifest.emscripten !== source.emscripten ||
    !manifest.files ||
    typeof manifest.files !== 'object'
  ) {
    throw new Error('Build and stage the source compiler before the debugger.');
  }
  const names = optionalGroups['lldb-dap'];
  const available = await readdir(directory);
  if (!names.every(name => available.includes(name))) {
    throw new Error('lldb-dap contains only part of its runtime.');
  }
  await rm(resolve(output, 'lldb'), { recursive: true, force: true });
  await rm(resolve(output, 'lldb-dap'), { recursive: true, force: true });
  for (const name of Object.keys(manifest.files)) {
    if (name.startsWith('lldb-dap/')) {
      delete manifest.files[name];
    }
  }
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name));
    if (!bytes.length) {
      throw new Error(`${name} is empty.`);
    }
    const destination = resolve(output, 'lldb-dap', name);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(resolve(directory, name), destination);
    manifest.files[`lldb-dap/${name}`] = {
      bytes: bytes.length,
      sha256: digest(bytes)
    };
  }
  Object.assign(manifest, {
    debuggerOrigin: 'source',
    debuggerRevision: source.debuggerRevision,
    debuggerEmscripten: source.debuggerEmscripten,
    debuggerWamrRevision: source.debuggerWamrRevision,
    debuggerThreaded: true
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function stageDebugSysroot(directory) {
  const manifestPath = resolve(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  if (
    manifest.format !== 1 ||
    manifest.origin !== 'source' ||
    manifest.revision !== source.revision ||
    !manifest.files ||
    typeof manifest.files !== 'object'
  ) {
    throw new Error('Build and stage the source compiler before its sysroot.');
  }
  const available = await readdir(directory);
  if (!debugSysrootFiles.every(name => available.includes(name))) {
    throw new Error('The debugger sysroot contains only part of its runtime.');
  }
  await rm(resolve(output, 'debug-sysroot'), {
    recursive: true,
    force: true
  });
  for (const name of Object.keys(manifest.files)) {
    if (name.startsWith('debug-sysroot/')) {
      delete manifest.files[name];
    }
  }
  for (const name of debugSysrootFiles) {
    const bytes = await readFile(resolve(directory, name));
    if (!bytes.length) {
      throw new Error(`${name} is empty.`);
    }
    const destination = resolve(output, 'debug-sysroot', name);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(resolve(directory, name), destination);
    manifest.files[`debug-sysroot/${name}`] = {
      bytes: bytes.length,
      sha256: digest(bytes)
    };
  }
  Object.assign(manifest, {
    emscripten: source.emscripten,
    debugSysrootOrigin: 'source',
    debugSysrootEmscripten: source.emscripten
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function check() {
  const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json')));
  if (
    manifest.format !== 1 ||
    manifest.version !== source.llvm ||
    manifest.revision !== source.revision ||
    manifest.origin !== 'source' ||
    manifest.utilityOrigin !== 'source' ||
    manifest.packageOrigin !== 'source' ||
    manifest.watOrigin !== 'npm' ||
    manifest.watVersion !== source.wabt
  ) {
    throw new Error('The compiler manifest does not match the source recipe.');
  }
  for (const name of [
    ...required,
    ...workerNames,
    'llvm/llvm.js',
    'llvm/llvm.wasm',
    'packages/empack_env_meta.json',
    'licenses/LLVM.txt',
    'licenses/WasmBolt.txt',
    'licenses/Emscripten.txt',
    'licenses/WABT.txt',
    'licenses/graphviz.txt',
    'licenses/libwebp.txt',
    'licenses/xtensor.txt',
    'licenses/xtl.txt',
    'licenses/zlib.txt'
  ]) {
    if (!manifest.files[name]) {
      throw new Error(`The compiler manifest is missing ${name}.`);
    }
  }
  if (manifest.pipelineOrigin !== undefined) {
    if (manifest.pipelineOrigin !== 'source') {
      throw new Error('The LLVM pipeline assets have unverified provenance.');
    }
    if (
      JSON.stringify(manifest.pipelineTargets) !==
      JSON.stringify(source.pipelineTargets)
    ) {
      throw new Error('The LLVM pipeline targets do not match the build.');
    }
    for (const [group, names] of Object.entries(pipelineGroups)) {
      for (const name of names) {
        if (!manifest.files[`${group}/${name}`]) {
          throw new Error(`The compiler manifest is missing ${group}/${name}.`);
        }
      }
    }
  }
  for (const [group, names] of Object.entries(optionalGroups)) {
    const originName = `${group === 'lldb-dap' ? 'debugger' : group}Origin`;
    if (manifest[originName] === undefined) {
      continue;
    }
    if (manifest[originName] !== 'source') {
      throw new Error(`${group} has unverified provenance.`);
    }
    for (const name of names) {
      if (!manifest.files[`${group}/${name}`]) {
        throw new Error(`The compiler manifest is missing ${group}/${name}.`);
      }
    }
  }
  if (
    manifest.clangdOrigin !== undefined &&
    (manifest.clangdVersion !== source.llvm ||
      manifest.clangdRevision !== source.llvmRevision ||
      manifest.clangdEmscripten !== source.emscripten ||
      manifest.clangdThreaded !== true)
  ) {
    throw new Error('The clangd metadata does not match the source build.');
  }
  if (
    manifest.debuggerOrigin !== undefined &&
    (manifest.debuggerRevision !== source.debuggerRevision ||
      manifest.debuggerEmscripten !== source.debuggerEmscripten ||
      manifest.debuggerWamrRevision !== source.debuggerWamrRevision ||
      manifest.debuggerThreaded !== true)
  ) {
    throw new Error('The debugger metadata does not match the source build.');
  }
  if (manifest.debugSysrootOrigin !== undefined) {
    if (
      manifest.debugSysrootOrigin !== 'source' ||
      manifest.debugSysrootEmscripten !== source.emscripten
    ) {
      throw new Error('The debugger sysroot metadata is invalid.');
    }
    for (const name of debugSysrootFiles) {
      if (!manifest.files[`debug-sysroot/${name}`]) {
        throw new Error(`The compiler manifest is missing ${name}.`);
      }
    }
  }
  if (
    (manifest.pipelineOrigin !== undefined ||
      Object.keys(optionalGroups)
        .filter(group => group !== 'lldb-dap')
        .some(group => manifest[`${group}Origin`] !== undefined)) &&
    (!manifest.llvmServices ||
      manifest.llvmServices.revision !== source.llvmRevision ||
      manifest.llvmServices.emscripten !== source.emscripten)
  ) {
    throw new Error('The LLVM service metadata does not match the build.');
  }
  const packageMetadata = JSON.parse(
    await readFile(resolve(output, 'packages/empack_env_meta.json'))
  );
  if (
    packageMetadata.prefix !== '/' ||
    !Array.isArray(packageMetadata.packages)
  ) {
    throw new Error('The empack package metadata is invalid.');
  }
  for (const entry of packageMetadata.packages) {
    if (
      !entry ||
      typeof entry.filename !== 'string' ||
      !/^[A-Za-z0-9_.+-]+\.tar\.gz$/.test(entry.filename)
    ) {
      throw new Error('The empack package metadata contains an invalid file.');
    }
    if (!manifest.files[`packages/${entry.filename}`]) {
      throw new Error(`The compiler manifest is missing ${entry.filename}.`);
    }
  }
  for (const name of Object.keys(manifest.files)) {
    if (name.includes('..') || name.startsWith('/')) {
      throw new Error('Invalid compiler asset path.');
    }
    const bytes = await readFile(resolve(output, name));
    const expected = manifest.files[name];
    if (
      !expected ||
      expected.bytes !== bytes.length ||
      expected.sha256 !== digest(bytes)
    ) {
      throw new Error(`${name} is missing, corrupt, or from another build.`);
    }
  }
  const outputNames = await readdir(output);
  if (outputNames.some(name => name.endsWith('.mjs'))) {
    throw new Error('The compiler directory contains stale worker chunks.');
  }
  for (const name of workerNames) {
    const path = resolve(output, name);
    if ((await stat(path)).size === 0) {
      throw new Error(`${name} is empty.`);
    }
    const contents = await readFile(path, 'utf8');
    if (/^\s*import(?:[\s{*]|['"])/m.test(contents)) {
      throw new Error(`${name} depends on an untracked worker chunk.`);
    }
  }
  process.stdout.write('Compiler assets verified.\n');
}

async function build() {
  const platform = process.platform === 'darwin' ? 'osx-arm64' : 'linux-64';
  if (
    (process.platform === 'darwin' && process.arch !== 'arm64') ||
    (process.platform === 'linux' && process.arch !== 'x64') ||
    !['darwin', 'linux'].includes(process.platform)
  ) {
    throw new Error('Build the compiler on macOS arm64 or Linux x64.');
  }
  const cache = resolve(root, 'runtime/.cache');
  const buildPrefix = resolve(cache, 'build');
  const hostPrefix = resolve(cache, 'host');
  const packagePrefix = resolve(cache, 'packages');
  for (const [prefix, lock] of [
    [buildPrefix, `build-${platform}.txt`],
    [hostPrefix, 'host-emscripten-wasm32.txt'],
    [packagePrefix, 'packages-emscripten-wasm32.txt']
  ]) {
    const lockfile = resolve(root, 'runtime/locks', lock);
    const expected = (await readFile(lockfile, 'utf8'))
      .split('\n')
      .filter(line => line.startsWith('https://'))
      .sort();
    let installed = [];
    try {
      for (const name of await readdir(resolve(prefix, 'conda-meta'))) {
        if (name.endsWith('.json')) {
          const metadata = JSON.parse(
            await readFile(resolve(prefix, 'conda-meta', name))
          );
          installed.push(`${metadata.url}#${metadata.md5}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (JSON.stringify(installed.sort()) === JSON.stringify(expected)) {
      continue;
    }
    run('micromamba', [
      '--no-rc',
      'create',
      '--yes',
      '--prefix',
      prefix,
      '--root-prefix',
      resolve(cache, 'mamba'),
      '--file',
      lockfile
    ]);
  }
  const directory = resolve(root, 'runtime/build');
  // Optional services have independent native build recipes. A core rebuild
  // removes prior service output so stale binaries cannot inherit the current
  // source provenance when stage() writes a fresh manifest.
  for (const group of Object.keys(optionalGroups)) {
    await rm(resolve(directory, group), { recursive: true, force: true });
  }
  const sysroot = resolve(
    buildPrefix,
    'opt/emsdk/upstream/emscripten/cache/sysroot'
  );
  // CMake owns optimization and ABI flags, including those normally appended
  // by this toolchain's activation script. Clear that override after
  // activation.
  const prefix = [
    '--no-rc',
    'run',
    '--prefix',
    buildPrefix,
    'env',
    'EMCC_CFLAGS='
  ];
  run('micromamba', [
    ...prefix,
    'emcmake',
    'cmake',
    '-S',
    resolve(root, 'runtime'),
    '-B',
    directory,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_PREFIX_PATH=${hostPrefix}`,
    `-DLLVM_DIR=${hostPrefix}/lib/cmake/llvm`,
    `-DClang_DIR=${hostPrefix}/lib/cmake/clang`,
    `-DLLD_DIR=${hostPrefix}/lib/cmake/lld`,
    `-DGraphviz_DIR=${hostPrefix}/lib/cmake/Graphviz`,
    `-DEMSCRIPTEN_SYSROOT=${sysroot}`,
    `-DCLANG_RESOURCE_TREE=${hostPrefix}/lib/clang/23`
  ]);
  run('micromamba', [
    ...prefix,
    'cmake',
    '--build',
    directory,
    '--parallel',
    '2'
  ]);
  const llvmDirectory = resolve(directory, 'llvm');
  await mkdir(llvmDirectory, { recursive: true });
  await copyFile(
    resolve(hostPrefix, 'bin/llvm.js'),
    resolve(llvmDirectory, 'llvm.js')
  );
  await copyFile(
    resolve(hostPrefix, 'bin/llvm.wasm'),
    resolve(llvmDirectory, 'llvm.wasm')
  );
  const hostTools = await readdir(resolve(hostPrefix, 'bin'));
  const pipelineNames = Object.values(pipelineGroups).flat();
  for (const group of Object.keys(pipelineGroups)) {
    await rm(resolve(directory, group), { recursive: true, force: true });
  }
  if (pipelineNames.every(name => hostTools.includes(name))) {
    for (const [group, names] of Object.entries(pipelineGroups)) {
      const destination = resolve(directory, group);
      await mkdir(destination, { recursive: true });
      for (const name of names) {
        await copyFile(
          resolve(hostPrefix, 'bin', name),
          resolve(destination, name)
        );
      }
    }
  }
  const packageDirectory = resolve(directory, 'packages');
  await rm(packageDirectory, { recursive: true, force: true });
  await mkdir(packageDirectory, { recursive: true });
  run('empack', [
    'pack',
    'env',
    '--env-prefix',
    packagePrefix,
    '--relocate-prefix',
    '/',
    '--outdir',
    packageDirectory
  ]);
  const debugSysroot = resolve(directory, 'debug-sysroot');
  await rm(debugSysroot, { recursive: true, force: true });
  await mkdir(debugSysroot, { recursive: true });
  const debugLibraryDirectory = resolve(sysroot, 'lib/wasm32-emscripten');
  for (const name of debugSysrootFiles) {
    await copyFile(
      resolve(debugLibraryDirectory, name),
      resolve(debugSysroot, name)
    );
  }
  await stage(directory, 'source');
}

try {
  if (action === 'build') {
    await build();
  } else if (action === 'stage-debugger' && process.argv[3]) {
    await stageDebugger(resolve(process.argv[3]));
  } else if (action === 'stage-debug-sysroot' && process.argv[3]) {
    await stageDebugSysroot(resolve(process.argv[3]));
  } else if (action === 'stage' && process.argv[3]) {
    await stage(resolve(process.argv[3]), 'import');
  } else if (action === 'check') {
    await check();
  } else {
    throw new Error(
      'Use compiler.mjs build, stage <directory>, ' +
        'stage-debugger <directory>, stage-debug-sysroot <directory>, ' +
        'or check.'
    );
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
