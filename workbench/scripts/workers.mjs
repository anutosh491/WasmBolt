import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'compiler');
const source = JSON.parse(
  await readFile(resolve(root, 'runtime/sources.json'), 'utf8')
);
const workers = {
  'worker.js': 'src/compiler/worker.ts',
  'utility-worker.js': 'src/compiler/utility-worker.ts',
  'tool-worker.js': 'src/compiler/tool-worker.ts',
  'wat-worker.js': 'src/compiler/wat-worker.ts',
  'clangd-worker.js': 'src/clangd/worker.ts',
  'debug-worker.js': 'src/lldb/debug-worker.ts'
};

// The compiler directory also owns large native assets. Remove only previous
// frontend worker output, including old shared multi-entry chunks.
await mkdir(output, { recursive: true });
for (const name of await readdir(output)) {
  if (
    name.endsWith('.mjs') ||
    name === 'worker.js' ||
    name.endsWith('-worker.js')
  ) {
    await rm(resolve(output, name), { force: true });
  }
}

// Build one entry at a time so every worker is a complete, relocatable module.
// A missing worker can then be detected by check:compiler without discovering
// an untracked shared chunk only after the browser loads it.
for (const [name, entry] of Object.entries(workers)) {
  await build({
    root,
    configFile: false,
    build: {
      target: 'es2022',
      outDir: output,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, entry),
        formats: ['es'],
        fileName: () => name
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
      minify: 'esbuild'
    }
  });
}

const manifestPath = resolve(output, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const name of Object.keys(manifest.files)) {
  if (name === 'worker.js' || name.endsWith('-worker.js')) {
    delete manifest.files[name];
  }
}
for (const name of Object.keys(workers)) {
  const bytes = await readFile(resolve(output, name));
  manifest.files[name] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}
const licenseName = 'licenses/WABT.txt';
const license = await readFile(resolve(root, 'runtime', licenseName));
await mkdir(resolve(output, 'licenses'), { recursive: true });
await writeFile(resolve(output, licenseName), license);
manifest.files[licenseName] = {
  bytes: license.length,
  sha256: createHash('sha256').update(license).digest('hex')
};
manifest.watOrigin = 'npm';
manifest.watVersion = source.wabt;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
