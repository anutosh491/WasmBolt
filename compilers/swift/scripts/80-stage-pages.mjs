// Reuse the LLDB deployment packager, splitting oversized compiler binaries.
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const source = resolve(process.argv[2] || join(root, 'site'));
const destination = resolve(process.argv[3] || join(root, 'compilers/swift/.work/pages'));
// The generic packager cannot accept oversized single files. Feed it a small
// mirror excluding our two large binaries, without touching the source site.
const mirror = join(root, 'compilers/swift/.work/pages-input');
const { cp } = await import('node:fs/promises');
await mkdir(mirror, { recursive: true });
await cp(source, mirror, { recursive: true, filter: path =>
  !path.endsWith('/compilers/swift/wasmbolt-swift.wasm') &&
  !path.endsWith('/debugger/lldb/lldb-dap.wasm') });
const result = spawnSync(process.execPath,
  [join(root, 'debugger/lldb/scripts/80-stage-pages.mjs'), mirror, destination],
  { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Base Pages packaging failed');
let headers = await readFile(join(destination, '_headers'), 'utf8');
const sdk = 'compilers/swift/runtime.tar.gz';
if ((await stat(join(source, sdk))).size > 25 * 1024 * 1024)
  throw new Error('Swift SDK exceeds Pages file limit');
await copyFile(join(source, sdk), join(destination, sdk));
headers += `\n/${sdk}\n  Content-Type: application/octet-stream\n  Cache-Control: no-transform\n`;
for (const path of ['compilers/swift/wasmbolt-swift.wasm', 'debugger/lldb/lldb-dap.wasm']) {
  const size = (await stat(join(source, path))).size, parts = [];
  for (let offset = 0, index = 0; offset < size; offset += 64 * 1024 * 1024, index++) {
    const name = `${path}.part${index}`, output = join(destination, name);
    await mkdir(dirname(output), { recursive: true });
    await pipeline(createReadStream(join(source, path), { start: offset,
      end: Math.min(offset + 64 * 1024 * 1024, size) - 1 }),
      createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
      createWriteStream(output));
    if ((await stat(output)).size > 25 * 1024 * 1024)
      throw new Error(`Pages part exceeds file limit: ${name}`);
    parts.push(name.slice(name.lastIndexOf('/') + 1));
    headers += `\n/${name}\n  Content-Encoding: br\n  Cache-Control: no-transform\n`;
  }
  await rm(join(destination, path), { force: true });
  await writeFile(join(destination, `${path}.parts.json`), JSON.stringify(parts) + '\n');
}
await writeFile(join(destination, '_headers'), headers);
console.log('Swift Pages assets:', destination);
