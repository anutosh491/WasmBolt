import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const debuggerRoot = fileURLToPath(new URL('../', import.meta.url));
const workDir = resolve(
  process.env.WASMBOLT_DEBUGGER_WORK_DIR ?? resolve(debuggerRoot, '.work')
);
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination) {
  throw new Error('Usage: node scripts/70-stage-playground.mjs <directory>');
}

const demos = [
  ['simple.cpp', 'simple.cpp', 'simple.wasm'],
  ['simple.c', 'simple.c', 'simple-c.wasm'],
  ['iostream.cpp', 'iostream.cpp', 'iostream.wasm'],
  ['xtl.cpp', 'xtl.cpp', 'xtl.wasm'],
  ['xtensor.cpp', 'xtensor.cpp', 'xtensor.wasm'],
  ['json.cpp', 'nlohmann_json.cpp', 'nlohmann_json.wasm'],
  ['debug.ll', 'debug.ll', 'debug-ir.wasm']
];

await mkdir(destination, { recursive: true });
const files = [];
for (const [sourceName, publishedSource, moduleName] of demos) {
  const source = resolve(debuggerRoot, 'tests', sourceName);
  const module = resolve(workDir, 'guests', moduleName);
  for (const [input, name] of [
    [source, publishedSource],
    [module, moduleName]
  ]) {
    const output = resolve(destination, name);
    await copyFile(input, output);
    const data = await readFile(output);
    files.push({
      name: basename(output),
      path: `/workspace/${basename(output)}`,
      bytes: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex')
    });
  }
}

await writeFile(
  resolve(destination, 'manifest.json'),
  `${JSON.stringify({ format: 1, emscripten: '6.0.8', files }, null, 2)}\n`
);
console.log(
  `Staged ${files.length} debugger playground files in ${destination}`
);
