import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  ['.c', 'text/plain; charset=utf-8'],
  ['.ll', 'text/plain; charset=utf-8'],
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

const delay = Number(process.argv[3] ?? 6000);
if (!Number.isSafeInteger(delay) || delay < 0) {
  throw new Error('The delay must be a nonnegative number of milliseconds.');
}
const cases =
  process.argv[2] === 'matrix'
    ? [
        ['', 0],
        ['step-in-out', 0],
        ['step-in-out-delayed', 6000],
        ['step-in-out-delayed', 15000],
        ['step-in-out-delayed', 60000],
        ['attach-delayed', 6000],
        ['configure-delayed', 6000],
        ['c', 0],
        ['c-delayed', 6000],
        ['llvm-ir', 0],
        ['llvm-ir-delayed', 6000],
        ['llvm-ir-step-out-main', 0],
        ['multiple-breakpoints', 0],
        ['distant-breakpoints', 0],
        ['pause', 0],
        ['iostream', 0],
        ['json', 0],
        ['xtensor', 0],
        ['static-commands-delayed', 6000]
      ]
    : [[process.argv[2] ?? '', delay]];
const browser = await launchBrowser();
const results = [];
try {
  for (const [probe, delayMilliseconds] of cases) {
    results.push(await run(probe, delayMilliseconds));
  }
  const report = {
    timestamp: new Date().toISOString(),
    ok: results.every(result => result.ok),
    results
  };
  const directory = resolve(workDir, 'test-results');
  await mkdir(directory, { recursive: true });
  const name =
    process.argv[2] === 'matrix'
      ? 'matrix.json'
      : `${process.argv[2] || 'default'}-${delay}.json`;
  await writeFile(resolve(directory, name), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        passed: results.filter(result => result.ok).length,
        total: results.length,
        report: resolve(directory, name)
      },
      null,
      2
    )
  );
  if (!report.ok) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

async function run(probe, delayMilliseconds) {
  const page = await browser.newPage();
  const errors = [];
  const logs = [];
  const started = performance.now();
  page.on('console', message => {
    logs.push(message.text());
    if (message.type() === 'error') {
      errors.push(message.text());
    }
    if (cases.length > 1) {
      return;
    }
    if (process.env.WASMBOLT_TRACE_ONLY) {
      const value = message.text();
      if (
        !value.includes('[GDBR/trace]') &&
        !value.includes('dapRequest') &&
        !value.includes('dapEvent') &&
        !value.includes('GDBRStage') &&
        !value.includes('dapFailure') &&
        !value.includes('"ok"')
      ) {
        return;
      }
    }
    console.log(`[browser/${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', error => {
    console.error(`[browser/error] ${error.stack ?? error}`);
    errors.push(String(error));
  });
  let smoke;
  try {
    const parameters = new URLSearchParams({
      probe,
      delay: String(delayMilliseconds)
    });
    await page.goto(`http://127.0.0.1:${address.port}/smoke/?${parameters}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    await page.waitForFunction(
      () => window.__wasmboltSmoke?.done === true,
      null,
      { timeout: 180_000 + delayMilliseconds }
    );
    smoke = await page.evaluate(() => window.__wasmboltSmoke);
  } catch (error) {
    errors.push(String(error));
  } finally {
    await page.close();
  }
  const result = {
    probe: probe || 'default',
    delayMilliseconds,
    milliseconds: Math.round(performance.now() - started),
    ok: Boolean(smoke?.result?.ok) && errors.length === 0,
    result: smoke?.result,
    errors,
    logs
  };
  console.log(JSON.stringify({ ...result, logs: undefined }));
  return result;
}
