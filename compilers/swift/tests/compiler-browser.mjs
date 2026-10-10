import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const work = resolve(
  process.env.WASMBOLT_SWIFT_WORK_DIR ?? resolve(project, '.work')
);
const debuggerTest = false;
const server = createServer(async (request, response) => {
  for (const [name, value] of Object.entries({
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin'
  }))
    response.setHeader(name, value);
  const url = new URL(request.url, 'http://127.0.0.1');
  if (
    request.method === 'POST' &&
    ['/save/simple/program.wasm', '/save/arrays/program.wasm'].includes(
      url.pathname
    )
  ) {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 32 * 1024 * 1024) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const output = resolve(work, 'browser-tests', url.pathname.split('/')[2]);
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'program.wasm'), Buffer.concat(chunks));
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Swift compiler browser test</title>');
    return;
  }
  const routes = [
    ['/artifacts/', resolve(work, 'output')],
    ['/browser-guests/', resolve(work, 'browser-tests')],
    ['/compiler/', resolve(work, 'compiler')],
    ['/swift-package/', resolve(work, 'swift-package')],
    ['/support/', resolve(work, 'tests')],
    ['/', resolve(project, 'tests')]
  ];
  const [prefix, root] = routes.find(([prefix]) =>
    url.pathname.startsWith(prefix)
  );
  const file = resolve(root, url.pathname.slice(prefix.length));
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(file);
    response.setHeader('Content-Length', info.size);
    response.setHeader(
      'Content-Type',
      extname(file) === '.wasm' ? 'application/wasm' : 'text/javascript'
    );
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  page.on('console', event => console.log(event.text()));
  const result = await page.evaluate(
    debuggerTest =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
          debuggerTest ? '/debugger-worker.mjs' : '/compiler-worker.mjs',
          { type: 'module' }
        );
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Swift compiler browser test timed out.'));
        }, 300000);
        worker.onmessage = event => {
          if (debuggerTest && event.data.kind === 'log') {
            console.log(JSON.stringify(event.data.value));
            return;
          }
          clearTimeout(timeout);
          worker.terminate();
          resolve(debuggerTest ? event.data.value : event.data);
        };
        worker.onerror = event => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage({});
      }),
    debuggerTest
  );
  await writeFile(
    resolve(
      work,
      debuggerTest
        ? 'debugger-browser-result.json'
        : 'compiler-browser-result.json'
    ),
    JSON.stringify(result, null, 2) + '\n'
  );
  assert.equal(result.success, true, result.message);
  if (debuggerTest) {
    process.stdout.write('Browser Swift debugger passed.\n');
  } else {
    assert.equal(result.isolated, true);
    assert.deepEqual(
      result.results.map(value => value.code),
      [0, 0, 1, 1, 0, 0]
    );
    assert.ok(result.results.every(value => value.reusable === 1));
    assert.match(result.results[0].stdout, /Swift version 6\.5/);
    assert.match(result.results[5].stdout, /LLD 23/);
    assert.equal(result.reusable, 1);
    assert.equal(result.compilation.length, 15);
    assert.deepEqual(
      result.execution.map(value => value.stdout),
      [
        'Swift answer: 42\n',
        'Swift answer: 42\n',
        'Swift array sum: 20\n',
        'Swift array sum: 20\n',
        'Swift answer: 42\n',
        'Swift answer: 42\n',
        'Swift array sum: 20\n',
        'Swift array sum: 20\n',
        'Swift array sum: 20\n',
        'Swift array sum: 20\n'
      ]
    );
    process.stdout.write(
      'Browser Swift/LLD re-entry, outputs, linking and source ' +
        'error recovery passed.\n'
    );
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
