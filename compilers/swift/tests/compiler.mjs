import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { compileCases } from './compile-cases.mjs';

const project = resolve(import.meta.dirname, '..');
const work = resolve(
  process.env.WASMBOLT_SWIFT_WORK_DIR ?? resolve(project, '.work')
);
const build = resolve(work, 'compiler');
const { default: createCompiler } = await import(
  pathToFileURL(resolve(build, 'wasmbolt-swift.js')).href
);
let stdout = '';
let stderr = '';
const module = await createCompiler({
  wasmBinary: new Uint8Array(
    await readFile(resolve(build, 'wasmbolt-swift.wasm'))
  ),
  locateFile: name => resolve(build, name),
  noInitialRun: true,
  noExitRuntime: true,
  print: text => (stdout += text + '\n'),
  printErr: text => (stderr += text + '\n')
});
const invoke = module.cwrap('wb_swift_run', 'number', ['string']);
const reusable = module.cwrap('wb_swift_can_run_again', 'number', []);
const run = args => {
  stdout = '';
  stderr = '';
  let code;
  try {
    code = invoke(JSON.stringify(args));
  } catch (error) {
    console.error(stderr);
    throw error;
  }
  return { code, stdout, stderr };
};

try {
  for (let i = 0; i < 3; i++) {
    const swift = run(['swift-frontend', '-version']);
    assert.equal(swift.code, 0, swift.stderr);
    assert.match(swift.stdout, /Swift version 6\.5/);
    const linker = run(['wasm-ld', '--version']);
    assert.equal(linker.code, 0, linker.stderr);
    assert.match(linker.stdout, /LLD 23/);
    assert.equal(reusable(), 1);
  }
  assert.equal(run(['swift-frontend', '-unknown-wasmbolt-option']).code, 1);
  assert.equal(run(['wasm-ld', '/workspace/missing.o']).code, 1);
  assert.equal(reusable(), 1);
  assert.equal(run(['swift-frontend', '-version']).code, 0);
  assert.equal(run(['wasm-ld', '--version']).code, 0);
  assert.equal(run(['unknown']).code, 64);
  assert.equal(invoke('[42]'), 64);
  const { unpackTar } = await import(
    pathToFileURL(resolve(work, 'tests/archive.mjs')).href
  );
  unpackTar(
    module.FS,
    gunzipSync(await readFile(resolve(work, 'swift-package/runtime.tar.gz')))
  );
  const results = compileCases(
    module,
    run,
    (await readFile(resolve(project, 'tests/scalar.swift'), 'utf8')).split(
      process.argv.includes('--scalar') ? 'print(' : '\0'
    )[0],
    process.argv.includes('--scalar')
      ? 'let values = [1, 2, 3]\n'
      : await readFile(resolve(project, 'tests/arrays.swift'), 'utf8')
  );
  assert.equal(reusable(), 1);
  process.stdout.write(
    `Swift/LLD re-entry, outputs, linking and source error ` +
      `recovery passed (${results.length} compilation checks).\n`
  );
} finally {
  await new Promise(resolve => setTimeout(resolve, 200));
  if (stderr) console.error(stderr);
  module.PThread.terminateAllThreads();
}
