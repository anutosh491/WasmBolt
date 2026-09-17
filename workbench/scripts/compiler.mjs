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
const action = process.argv[2];

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
  const available = await readdir(directory);
  const names = [...required];
  if (available.includes('WasmBoltMlirOpt.so')) {
    names.push('WasmBoltMlirOpt.so');
  } else {
    await rm(resolve(output, 'WasmBoltMlirOpt.so'), { force: true });
  }
  const files = {};
  for (const name of names) {
    const file = resolve(directory, name);
    const bytes = await readFile(file);
    if (!bytes.length) {
      throw new Error(`${name} is empty.`);
    }
    await copyFile(file, resolve(output, name));
    files[name] = { bytes: bytes.length, sha256: digest(bytes) };
  }
  await mkdir(resolve(output, 'licenses'), { recursive: true });
  for (const name of await readdir(resolve(root, 'runtime/licenses'))) {
    const bytes = await readFile(resolve(root, 'runtime/licenses', name));
    await writeFile(resolve(output, 'licenses', name), bytes);
    files[`licenses/${name}`] = {
      bytes: bytes.length,
      sha256: digest(bytes)
    };
  }
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        format: 1,
        version: source.llvm,
        resourceDirectory: `/lib/clang/${source.llvm.split('.')[0]}`,
        origin,
        revision: source.revision,
        files
      },
      null,
      2
    ) + '\n'
  );
}

async function check() {
  const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json')));
  if (
    manifest.format !== 1 ||
    manifest.version !== source.llvm ||
    manifest.revision !== source.revision ||
    manifest.origin !== 'source'
  ) {
    throw new Error('The compiler manifest does not match the source recipe.');
  }
  for (const name of [
    ...required,
    'WasmBoltMlirOpt.so',
    'licenses/LLVM.txt',
    'licenses/WasmBolt.txt',
    'licenses/Emscripten.txt'
  ]) {
    if (!manifest.files[name]) {
      throw new Error(`The compiler manifest is missing ${name}.`);
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
  if ((await stat(resolve(output, 'worker.js'))).size === 0) {
    throw new Error('The compiler worker is empty.');
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
  for (const [prefix, lock] of [
    [buildPrefix, `build-${platform}.txt`],
    [hostPrefix, 'host-emscripten-wasm32.txt']
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
  const llvm = resolve(cache, 'llvm/llvm/tools/llc');
  await mkdir(llvm, { recursive: true });
  for (const file of source.files) {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Could not download ${file.name}: ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== file.sha256) {
      throw new Error(`The pinned ${file.name} checksum does not match.`);
    }
    await writeFile(resolve(llvm, file.name), bytes);
  }
  const directory = resolve(root, 'runtime/build');
  const sysroot = resolve(
    buildPrefix,
    'opt/emsdk/upstream/emscripten/cache/sysroot'
  );
  // CMake owns optimization and ABI flags, including those normally appended
  // by this toolchain's activation script. Clear that override after activation.
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
    `-DMLIR_DIR=${hostPrefix}/lib/cmake/mlir`,
    `-DGraphviz_DIR=${hostPrefix}/lib/cmake/Graphviz`,
    `-DLLVM_SOURCE_TREE=${resolve(cache, 'llvm')}`,
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
  await stage(directory, 'source');
}

try {
  if (action === 'build') {
    await build();
  } else if (action === 'stage' && process.argv[3]) {
    await stage(resolve(process.argv[3]), 'import');
  } else if (action === 'check') {
    await check();
  } else {
    throw new Error('Use compiler.mjs build, stage <directory>, or check.');
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
