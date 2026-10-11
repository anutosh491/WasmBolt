// Package the staged site for Cloudflare Pages' 25 MiB asset limit.
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.argv[2] || join(root, 'site'));
const destination = resolve(process.argv[3] || join(root, 'build/pages'));
if (source === destination || source.startsWith(destination + sep) || destination.startsWith(source + sep))
  throw new Error('Choose a separate deployment directory, outside the source site');
const headers = ['/*', '  Cross-Origin-Opener-Policy: same-origin',
  '  Cross-Origin-Embedder-Policy: require-corp', '  Cross-Origin-Resource-Policy: same-origin'];
let count = 0;
async function stage(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const input = join(directory, entry.name);
    const path = relative(source, input).split(sep).join('/');
    // Runtime regression fixtures and local precompression copies are not site assets.
    if (path === 'debugger/lldb/tests' || path === 'debugger/lldb/guest-examples.json' ||
        entry.name === '_headers' || (entry.name.endsWith('.gz') && !entry.name.endsWith('.tar.gz'))) continue;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected site symlink: ${path}`);
    if (entry.isDirectory()) { await stage(input); continue; }
    const output = join(destination, path);
    await mkdir(dirname(output), { recursive: true });
    const encoded = ['.wasm', '.data', '.a'].includes(extname(path));
    const payload = encoded || path.endsWith('.tar.gz');
    if (encoded) {
      await pipeline(createReadStream(input), createBrotliCompress({ params: {
        [constants.BROTLI_PARAM_QUALITY]: 9,
      } }), createWriteStream(output));
    } else await copyFile(input, output);
    const size = (await stat(output)).size;
    if (size > 25 * 1024 * 1024) throw new Error(`${path} exceeds Pages' 25 MiB limit`);
    if (payload) {
      const digest = createHash('sha256').update(await readFile(output)).digest('hex').slice(0, 16);
      const hashed = `${path}.${digest}`;
      await rename(output, join(destination, hashed));
      await writeFile(`${output}.parts.json`, JSON.stringify([hashed.slice(hashed.lastIndexOf('/') + 1)]) + '\n');
      headers.push('', `/${hashed}`, '  Content-Type: application/octet-stream',
        '  Cache-Control: public, max-age=31536000, immutable, no-transform');
      if (encoded) headers.push('  Content-Encoding: br');
    }
    count++;
    console.log(`${path}: ${(size / 1024 / 1024).toFixed(2)} MiB`);
  }
}
await stage(source);
await writeFile(join(destination, '_headers'), headers.join('\n') + '\n');
console.log(`Ready: ${count} assets in ${destination}`);
