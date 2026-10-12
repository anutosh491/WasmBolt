// Package Swift's optional modules, splitting oversized browser binaries.
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const source = resolve(process.argv[2] || join(root, 'site'));
const destination = resolve(process.argv[3] || join(root, 'compilers/swift/.work/pages'));
// The generic packager cannot accept oversized single files. Feed it a small
// mirror excluding large binaries, without touching the source site.
const mirror = join(root, 'compilers/swift/.work/pages-input');
const binaries = ['compilers/swift/wasmbolt-swift.wasm'];
const sdks = ['runtime.tar.gz', 'link-runtime.tar.gz', 'foundation.tar.gz', 'modules.tar.gz', 'repl-modules.tar.gz', 'repl-foundation.tar.gz']
  .map(name => 'compilers/swift/' + name);
for (const optional of ['debugger/lldb/lldb-dap.wasm', 'compilers/swift/wasmbolt-swift-repl.wasm'])
  if (await stat(join(source, optional)).catch(() => null)) binaries.push(optional);
await rm(mirror, { recursive: true, force: true });
const { cp } = await import('node:fs/promises');
await mkdir(mirror, { recursive: true });
await cp(source, mirror, { recursive: true, filter: path =>
  ![...binaries, ...sdks].some(binary => path.endsWith('/' + binary) ||
    path.includes('/' + binary + '.part')) });
const result = spawnSync(process.execPath,
  [join(root, 'scripts/package-pages.mjs'), mirror, destination],
  { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Base Pages packaging failed');
let headers = await readFile(join(destination, '_headers'), 'utf8');
// Cache immutable payloads without retaining stale binaries after deployment.
async function publishPayload(path, encoding = '') {
  const digest = createHash('sha256').update(await readFile(join(destination, path)))
    .digest('hex').slice(0, 16);
  const hashed = `${path}.${digest}`;
  await rename(join(destination, path), join(destination, hashed));
  headers += `\n/${hashed}\n  Content-Type: application/octet-stream\n  Cache-Control: public, max-age=31536000, immutable, no-transform\n`;
  if (encoding) headers += `  Content-Encoding: ${encoding}\n`;
  return hashed.slice(hashed.lastIndexOf('/') + 1);
}
async function compressParts(path, bytes) {
  const parts = [];
  const essential = /\/(?:wasmbolt-swift(?:-repl)?\.wasm|runtime\.tar\.gz|link-runtime\.tar\.gz|repl-modules\.tar\.gz)$/.test(path);
  for (let offset = 0, index = 0; offset < bytes.length; offset += 64 * 1024 * 1024, index++) {
    const name = `${path}.part${index}`, output = join(destination, name);
    await mkdir(dirname(output), { recursive: true });
    await pipeline(Readable.from([bytes.subarray(offset, offset + 64 * 1024 * 1024)]),
      createBrotliCompress({ params: {
        [constants.BROTLI_PARAM_QUALITY]: essential ? 11 : 9,
        [constants.BROTLI_PARAM_LGWIN]: essential ? 24 : 22,
      } }),
      createWriteStream(output));
    if ((await stat(output)).size > 25 * 1024 * 1024)
      throw new Error(`Pages part exceeds file limit: ${name}`);
    parts.push(await publishPayload(name, 'br'));
  }
  await rm(join(destination, path), { force: true });
  await writeFile(join(destination, `${path}.parts.json`), JSON.stringify(parts) + '\n');
}
for (const sdk of sdks) {
  if (await stat(join(source, sdk)).catch(() => null))
    await compressParts(sdk, gunzipSync(await readFile(join(source, sdk))));
}
for (const path of binaries) await compressParts(path, await readFile(join(source, path)));
await writeFile(join(destination, '_headers'), headers);
console.log('Swift Pages assets:', destination);
