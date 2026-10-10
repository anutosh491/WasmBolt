// Browser acceptance checks for the staged WasmBolt UI, including real compilation.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] || 'http://127.0.0.1:8767/?debugger=1';
const output = resolve(fileURLToPath(new URL('../.work/test-results/', import.meta.url)));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [];
const downloads = { 'Compiler.wasm': 0, 'Compiler.data': 0, 'lldb-dap.wasm': 0 };
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const name = new URL(request.url()).pathname.split('/').pop();
  if (Object.hasOwn(downloads, name)) downloads[name]++;
});
const wait = (predicate, timeout = 30000) => page.waitForFunction(predicate, null, { timeout });
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function start(file, line) {
  await page.locator(`#workspace-files button[title="/workspace/${file}"]`).click();
  if (line) await page.locator(`#source-gutter button[data-line="${line}"]`).click();
  await page.locator('#debugger-start').click();
  await wait(() => ['stopped', 'error', 'exited'].includes(document.querySelector('#debugger-panel').dataset.state), 180000);
  check(await page.locator('#debugger-panel').getAttribute('data-state') === 'stopped',
    await page.locator('#debugger-log').textContent());
}
async function exit(code) {
  await page.locator('#debugger-continue').click();
  await wait(() => document.querySelector('#debugger-panel').dataset.state === 'exited');
  check(await page.locator('.debugger-notice').textContent() === `Exited with code ${code}`, 'Wrong guest exit code');
  check(await page.locator('#debugger-pause').isDisabled(), 'Pause enabled after exit');
  check(await page.locator('#debugger-step-in').isDisabled(), 'Step enabled after exit');
  check(await page.locator('#debugger-frames').textContent() === 'No paused frames.', 'Stale exited frames');
  await page.locator('#debugger-stop').click();
}
try {
  // Hold the large runtime download: the starter workspace must already work.
  let releaseCompiler;
  const compilerDownload = new Promise(resolve => { releaseCompiler = resolve; });
  await page.route('**/runtime/Compiler.wasm', async route => {
    await compilerDownload; await route.continue();
  });
  const navigation = page.goto(url);
  await wait(() => document.querySelectorAll('#workspace-files button').length === 6);
  const names = await page.locator('#workspace-files button').allTextContents();
  check(names.join(',') === 'debug.ll,input.mlir,json.cpp,simple.c,simple.cpp,snippet.cpp', `Unexpected workspace: ${names}`);
  check(await page.locator('#compile').isDisabled(), 'Compiler finished while its download was held');
  await page.locator('#workspace-files button[title="/workspace/simple.cpp"]').click();
  await wait(() => document.querySelector('#source').value.includes('#include <iostream>'));
  await page.locator('#source').fill(`${await page.locator('#source').inputValue()}\n// Edited before the compiler finished loading.\n`);
  await page.screenshot({ path: resolve(output, 'product-startup.png') });
  releaseCompiler();
  await navigation;
  check((await page.locator('#source').inputValue()).includes('Edited before the compiler'), 'Startup lost editor changes');
  console.log('PASS six editable starter files before the compiler download finishes');
  if (new URL(url).searchParams.get('debugger') !== '1') {
    check(downloads['lldb-dap.wasm'] === 0, 'LLDB loaded before the bug button was clicked');
    await page.locator('#toggle-debugger').click();
  }
  await wait(() => !document.querySelector('#debugger-start').disabled, 180000);
  check(await page.evaluate(() => crossOriginIsolated), 'Missing COOP/COEP isolation');
  check(downloads['lldb-dap.wasm'] === 1, 'LLDB was not preloaded before Start');
  check(await page.locator('#debugger-panel').getAttribute('data-state') === 'idle', 'Preload started a debug process');
  await page.locator('#toggle-debugger').click();
  await page.locator('#toggle-debugger').click();
  console.log('PASS LLDB preload on panel opening, without starting a process');
  await start('simple.cpp', 14);
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('input  int  7'));
  await page.locator('#debugger-step-in').click();
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('right  int  4'));
  await new Promise(resolve => setTimeout(resolve, 6000));
  await page.locator('#debugger-step-over').click();
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('result  int  11'));
  await page.locator('#debugger-step-out').click();
  await wait(() => document.querySelector('#debugger-frames').textContent.startsWith('compute('));
  await exit(31);
  check((await page.locator('#debugger-log').textContent()).includes('result=31'), 'Missing C++ iostream stdout');
  console.log('PASS C++ breakpoint, locals, delayed step, step in/out, iostream, exit');

  await start('simple.c', 4);
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('high  int  10'));
  await page.locator('#debugger-step-over').click();
  await wait(() => document.querySelector('#source-gutter .current-line')?.dataset.line === '5');
  await exit(10);
  console.log('PASS C breakpoint, locals, step, exit');

  await start('debug.ll', 16);
  await page.locator('#debugger-step-in').click();
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('right  int  23'));
  await page.locator('#debugger-step-over').click();
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('sum  int  42'));
  await page.locator('#debugger-step-out').click();
  await wait(() => document.querySelector('#debugger-frames').textContent.startsWith('main'));
  await page.locator('#debugger-step-over').click();
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('result  int  42'));
  await page.screenshot({ path: resolve(output, 'product-ir-result.png') });
  await exit(42);
  console.log('PASS LLVM IR breakpoint, sum/result updates, step in/out, exit');

  if (await page.locator('#workspace-files button[title="/workspace/json.cpp"]').count()) {
    await start('json.cpp', 7);
    await wait(() => document.querySelector('#debugger-variables').textContent.includes('bonus  int  7'));
    await page.locator('#debugger-step-over').click();
    await wait(() => document.querySelector('#debugger-variables').textContent.includes('score  int  42'));
    await page.screenshot({ path: resolve(output, 'product-json.png') });
    await exit(42);
    console.log('PASS emscripten-forge nlohmann_json compilation and debugging');
  }
  // Exercise Pause by editing an existing file, without adding another starter.
  await page.locator('#workspace-files button[title="/workspace/simple.cpp"]').click();
  const cppSource = await page.locator('#source').inputValue();
  await page.locator('#source-gutter button[data-line="14"]').click();
  await page.locator('#source').fill(await readFile(new URL('../tests/pause.cpp', import.meta.url), 'utf8'));
  await page.locator('#debugger-start').click();
  await wait(() => !document.querySelector('#debugger-pause').disabled, 180000);
  await page.locator('#debugger-pause').click();
  await wait(() => document.querySelector('#debugger-frames').textContent.includes('busy_work'));
  await page.locator('#toggle-debugger').click();
  check(await page.locator('#debugger-panel').isHidden(), 'Panel failed to hide');
  await page.locator('#toggle-debugger').click();
  check(await page.locator('#debugger-panel').getAttribute('data-state') === 'stopped', 'Panel toggle killed session');
  await page.locator('#debugger-stop').click();
  await page.locator('#source').fill(cppSource);
  await page.locator('#source-gutter button[data-line="14"]').click();
  await start('simple.cpp', 0);
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('input  int  7'), 180000);
  await page.locator('#debugger-command').fill('`thread backtrace');
  await page.locator('#debugger-command').press('Enter');
  await wait(() => document.querySelector('#debugger-log').textContent.includes('frame #0:'));
  await page.locator('#debugger-restart').click();
  await wait(() => document.querySelector('#debugger-variables').textContent.includes('input  int  7'), 180000);
  await page.locator('#debugger-stop').click();
  check(errors.length === 0, errors.join('\n'));
  for (const [name, count] of Object.entries(downloads))
    check(count === 1, `${name} downloaded ${count} times; expected once per page`);
  console.log('PASS Pause, panel toggle, Stop/restart and LLDB console');
  console.log('PASS compiler/linker and LLDB assets loaded once across all debug runs');
} catch (error) {
  console.error(await page.locator('.debugger-notice').textContent());
  console.error(await page.locator('#debugger-log').textContent());
  console.error((await page.locator('#log').textContent()).slice(-7000));
  await page.screenshot({ path: resolve(output, 'product-failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
