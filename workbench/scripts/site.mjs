import { cpSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/site');

await build({ configFile: resolve(root, 'vite.config.mjs'), mode: 'site' });
cpSync(resolve(root, 'lite/_output'), resolve(output, 'lite'), {
  recursive: true
});
writeFileSync(resolve(output, '.nojekyll'), '');

for (const file of [
  'index.html',
  'compiler/manifest.json',
  'lite/lab/index.html',
  'lite/xeus/kernels.json',
  'lite/files/C++ examples.ipynb',
  'lite/files/C examples.ipynb',
  'lite/files/Fortitudo guide.md',
  'lite/xeus/xeus-cpp/bin/xcpp.js',
  'lite/xeus/xeus-cpp/bin/xcpp.wasm',
  'lite/xeus/xeus-cpp/empack_env_meta.json',
  'lite/xeus/licenses/xeus-cpp/LICENSE.TXT'
]) {
  if (!statSync(resolve(output, file)).isFile()) {
    throw new Error(`The site is missing ${file}.`);
  }
}

function size(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`The site contains a symbolic link: ${path}`);
      }
      return total + (entry.isDirectory() ? size(path) : statSync(path).size);
    },
    0
  );
}

const bytes = size(output);
if (bytes > 1_000_000_000) {
  throw new Error(`The site exceeds the GitHub Pages size limit: ${bytes}`);
}
process.stdout.write(`GitHub Pages site: ${bytes} bytes\n`);

await import('./local.mjs');
