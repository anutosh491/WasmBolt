import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const debuggerRoot = fileURLToPath(new URL('../', import.meta.url));
const workDir = resolve(
  process.env.WASMBOLT_DEBUGGER_WORK_DIR ?? resolve(debuggerRoot, '.work')
);
const roots = new Map([
  ['/artifacts/', resolve(workDir, 'output')],
  ['/guests/', resolve(workDir, 'guests')],
  ['/', resolve(debuggerRoot)]
]);
const types = new Map([
  ['.cpp', 'text/plain; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);

function location(pathname) {
  const route = [...roots.keys()].find(prefix => pathname.startsWith(prefix));
  const root = roots.get(route);
  const relative = pathname.slice(route.length);
  const entry = relative
    ? `${relative}${relative.endsWith('/') ? 'index.html' : ''}`
    : 'smoke/index.html';
  const path = resolve(root, entry);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error('The requested path escapes its published root.');
  }
  return path;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const path = location(decodeURIComponent(url.pathname));
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types.get(extname(path)) ?? 'application/octet-stream'
    });
    response.end(data);
  } catch (error) {
    console.error(`[server/404] ${request.url}: ${String(error)}`);
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('The smoke server did not publish a TCP address.');
}

async function launchBrowser() {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const candidates = [
    override,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/' +
      'Google Chrome for Testing',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  for (const executablePath of candidates) {
    try {
      await access(executablePath, constants.X_OK);
      return await chromium.launch({ executablePath, headless: true });
    } catch (error) {
      if (override && executablePath === override) {
        throw new Error(`Could not launch ${override}: ${String(error)}`);
      }
    }
  }
  throw new Error(
    'No Chromium executable was found. Set ' +
      'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.'
  );
}

const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage();
  page.on('console', message => {
    console.log(`[browser/${message.type()}] ${message.text()}`);
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    console.error(`[browser/error] ${error.stack ?? error}`);
    errors.push(String(error));
  });
  const probe = process.argv[2]
    ? `?probe=${encodeURIComponent(process.argv[2])}`
    : '';
  await page.goto(`http://127.0.0.1:${address.port}/smoke/${probe}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });
  await page.waitForFunction(
    () => window.__wasmboltSmoke?.done === true,
    null,
    { timeout: 180_000 }
  );
  const smoke = await page.evaluate(() => window.__wasmboltSmoke);
  console.log(JSON.stringify(smoke.result, null, 2));
  if (!smoke.result?.ok || errors.length) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
