import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = normalize(new URL('../../..', import.meta.url).pathname);
const port = Number(process.env.PORT ?? 4191);
const types = new Map([
  ['.data', 'application/octet-stream'],
  ['.gz', 'application/gzip'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);

createServer((request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url, 'http://localhost').pathname
  );
  const relative =
    pathname === '/' ? 'native/clangd/smoke/index.html' : pathname.slice(1);
  const path = normalize(join(root, relative));
  if (!path.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const size = statSync(path).size;
    response.writeHead(200, {
      'Content-Length': size,
      'Content-Type': types.get(extname(path)) ?? 'application/octet-stream',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`clangd smoke test: http://127.0.0.1:${port}/`);
});
