import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import './guide.mjs';

const root = resolve(import.meta.dirname, '..');
const prefix = resolve(root, 'work/xeus-cpp');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: resolve(root, 'lite'),
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('jupyter-builder', ['build', resolve(root, 'lite/brand')]);

// Recreate the prefix from the lock; package downloads remain cached.
rmSync(prefix, { recursive: true, force: true });
run('micromamba', [
  'create',
  '--yes',
  '--no-rc',
  '--no-pyc',
  '--root-prefix',
  resolve(root, '.cache/lite-mamba'),
  '--prefix',
  prefix,
  '--relocate-prefix',
  '',
  '--file',
  resolve(root, 'lite/xeus-cpp-lock.txt')
]);

// Match the explorer's language choices in the notebook launcher.
const kernels = resolve(prefix, 'share/jupyter/kernels');
for (const name of readdirSync(kernels)) {
  if (name !== 'xc23' && name !== 'xcpp23') {
    rmSync(resolve(kernels, name), { recursive: true });
  }
}

// Clear task state too: cached merges must run against the fresh output.
rmSync(resolve(root, 'lite/_output'), { recursive: true, force: true });
rmSync(resolve(root, 'lite/.jupyterlite.doit.db'), { force: true });
run('pixi', [
  'run',
  '--as-is',
  '--environment',
  'lite',
  'jupyter',
  'lite',
  'build',
  '--force',
  '--output-dir',
  '_output',
  `--XeusAddon.prefix=${prefix}`
]);
copyFileSync(
  resolve(root, 'style/icon.svg'),
  resolve(root, 'lite/_output/icon.svg')
);

const licenses = resolve(root, 'lite/_output/xeus/licenses');
mkdirSync(licenses, { recursive: true });
for (const file of readdirSync(resolve(prefix, 'conda-meta'))) {
  if (!file.endsWith('.json')) {
    continue;
  }
  const metadata = JSON.parse(
    readFileSync(resolve(prefix, 'conda-meta', file), 'utf8')
  );
  cpSync(
    resolve(metadata.link.source, 'info/licenses'),
    resolve(licenses, metadata.name),
    { recursive: true }
  );
}
copyFileSync(
  resolve(root, 'lite/xeus-cpp-lock.txt'),
  resolve(root, 'lite/_output/xeus/xeus-cpp-lock.txt')
);

// jupyterlite-xeus 5.0 eagerly fetches a PyPI/conda name mapping on import.
// Defer that optional lookup until it is used, so C/C++ startup works offline.
// Match the pinned bundle shape explicitly and fail when upstream changes it.
const bundles = resolve(
  root,
  'lite/_output/extensions/@jupyterlite/xeus-extension/static'
);
const mapping =
  'https://raw.githubusercontent.com/prefix-dev/parselmouth/' +
  'main/files/compressed_mapping.json';
const escaped = mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const eager = new RegExp(
  `var (\\w+)=(fetch\\("${escaped}"\\)\\.then\\([\\s\\S]+?\\));` +
    'async function (\\w+)\\((\\w+)\\)\\{let (\\w+)=await \\1;',
  'g'
);
let deferred = 0;
for (const file of readdirSync(bundles).filter(file => file.endsWith('.js'))) {
  const path = resolve(bundles, file);
  const original = readFileSync(path, 'utf8');
  const updated = original.replace(
    eager,
    (_, promise, fetch, lookup, argument, result) => {
      deferred++;
      return (
        `var ${promise};async function ${lookup}(${argument}){` +
        `let ${result}=await(${promise}??=${fetch});`
      );
    }
  );
  if (updated !== original) {
    writeFileSync(path, updated);
  }
}
if (deferred !== 3) {
  throw new Error(`Expected 3 xeus mapping lookups; found ${deferred}.`);
}
