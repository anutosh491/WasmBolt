import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

const playwrightModule =
  process.env.WASMBOLT_PLAYWRIGHT_MODULE ?? 'playwright';
const { chromium } = await import(playwrightModule);

const target =
  process.argv[2] ??
  process.env.WASMBOLT_DEBUGGER_URL ??
  'http://127.0.0.1:4192/?debugger=1';

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
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1100 }
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => errors.push(error.message));

  const waitFrame = async (name, line) => {
    await page.waitForFunction(
      ([expectedName, expectedLine]) => {
        const frame = document.querySelector('.wasmbolt-call-stack li');
        const text = frame?.textContent ?? '';
        return (
          text.includes(expectedName) && text.includes(`:${expectedLine}`)
        );
      },
      [name, String(line)],
      { timeout: 180_000 }
    );
  };

  const openSource = async name => {
    await page.getByRole('button', { name: new RegExp(`${name}$`) }).click();
    await page.getByRole('textbox', { name: 'Source code' }).waitFor();
  };

  const clickGutter = async line => {
    const source = await page
      .locator('.cm-content .cm-line')
      .nth(line - 1)
      .boundingBox();
    const gutter = await page.locator('.cm-debug-gutter').boundingBox();
    assert(source, `Expected source line ${line}.`);
    assert(gutter, 'Expected the breakpoint gutter.');
    await page.mouse.click(
      gutter.x + gutter.width / 2,
      source.y + source.height / 2
    );
  };

  await page.goto(target);
  await page.getByRole('textbox', { name: 'Source code' }).waitFor({
    state: 'visible',
    timeout: 180_000
  });

  const initialFiles = await page.locator('.wasmbolt-file').allTextContents();
  assert(initialFiles.every(name => !name.endsWith('.wasm')));
  assert(initialFiles.every(name => !name.endsWith('.o')));

  const outputs = await page.locator('.wasmbolt-outputs').first().textContent();
  for (const label of ['AST', 'LLVM IR', 'Assembly', 'Wasm module']) {
    assert(outputs?.includes(label), `Missing focused output: ${label}.`);
  }
  for (const label of ['Graphviz', 'Optimized IR', 'Analysis', 'Object']) {
    assert(!outputs?.includes(label), `Unexpected focused output: ${label}.`);
  }

  const toggle = page.getByRole('button', { name: 'Open debugger' });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');

  await openSource('simple.cpp');
  await clickGutter(12);
  await clickGutter(13);
  assert.equal(await page.locator('.wasmbolt-breakpoint').count(), 2);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await waitFrame('compute', 12);
  const generated = await page.locator('.wasmbolt-file').allTextContents();
  assert(generated.some(name => name.endsWith('debug.o')));
  assert(generated.some(name => name.endsWith('debug.wasm')));

  const debugInput = page.getByRole('textbox', { name: 'LLDB command' });
  await debugInput.fill('bt');
  await debugInput.press('Enter');
  await page.waitForFunction(() => {
    const text = document.querySelector('.wasmbolt-debug-console')?.textContent;
    return text?.includes('(lldb) bt') && text.includes('compute');
  });

  const terminalInput = page.getByRole('textbox', {
    name: 'Compiler command'
  });
  await terminalInput.fill('lldb frame variable');
  await terminalInput.press('Enter');
  await page.waitForFunction(() => {
    const text = document.querySelector('.wasmbolt-debug-console')?.textContent;
    return text?.includes('(lldb) frame variable') && text.includes('input');
  });

  await page.getByRole('button', { name: 'Restart' }).click();
  await waitFrame('compute', 12);
  await page.getByRole('button', { name: 'Step into' }).click();
  await waitFrame('add', 2);
  await page.getByRole('button', { name: 'Step out' }).click();
  await waitFrame('compute', 12);
  await page.getByRole('button', { name: 'Step over' }).click();
  await waitFrame('compute', 13);

  await page.getByRole('button', { name: 'Stop' }).click();
  await openSource('pause.cpp');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await pause.waitFor({ state: 'visible', timeout: 180_000 });
  await pause.click();
  await page.waitForFunction(
    () => {
      const stack = document.querySelector('.wasmbolt-call-stack');
      return (stack?.textContent ?? '').includes('pause.cpp:');
    },
    undefined,
    { timeout: 180_000 }
  );

  await page.getByRole('button', { name: 'Stop' }).click();
  await openSource('simple.cpp');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await waitFrame('compute', 12);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.waitForFunction(() => {
    const start = [...document.querySelectorAll('button')].find(
      button => button.textContent === 'Start'
    );
    const frames = document.querySelectorAll('.wasmbolt-call-stack li');
    return (
      start instanceof HTMLButtonElement && !start.disabled && !frames.length
    );
  });

  await page.getByRole('button', { name: /debug\.wasm$/ }).click();
  await page.getByRole('textbox', { name: 'Wasm module output' }).waitFor({
    state: 'visible',
    timeout: 180_000
  });
  await page.waitForFunction(
    () => {
      const output = document.querySelector(
        '[aria-label="Wasm module output"]'
      );
      return output?.textContent?.includes('(module');
    },
    undefined,
    { timeout: 180_000 }
  );

  assert.deepEqual(errors, []);
  console.log('WasmBolt debugger acceptance passed.');
} finally {
  await browser.close();
}
