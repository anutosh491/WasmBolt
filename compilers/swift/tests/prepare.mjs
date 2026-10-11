import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const project = resolve(import.meta.dirname, '..');
const work = resolve(
  process.env.WASMBOLT_SWIFT_WORK_DIR ?? resolve(project, '.work')
);
await mkdir(resolve(work, 'tests'), { recursive: true });
for (const name of ['archive', 'standalone']) {
  await build({
    entryPoints: [resolve(project, `tests/support/${name}.ts`)],
    outfile: resolve(work, `tests/${name}.mjs`),
    bundle: true,
    format: 'esm',
    platform: 'browser'
  });
}
