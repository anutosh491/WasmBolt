import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const standalone = 'http://127.0.0.1:8765/dist/standalone/';

async function edit(page: Page, source: string) {
  await page.getByRole('textbox', { name: 'Source code' }).fill(source);
}
async function compile(page: Page) {
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByRole('status').first()).toHaveText(
    'Compilation complete'
  );
}
async function tab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true }).first();
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
}

async function advanced(page: Page, name: string) {
  const more = page.getByLabel('More actions', { exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }
  await page.getByRole('button', { name, exact: true }).click();
}

test('selected outputs compile independently and compare @compat', async ({
  page
}, testInfo) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (message?.kind === 'compile') {
        const element = document.documentElement;
        element.dataset.compiles = String(
          Number(element.dataset.compiles ?? 0) + 1
        );
      }
      return send.call(
        this,
        message,
        Array.isArray(transfer) ? { transfer } : transfer
      );
    };
  });
  await page.goto(standalone);
  await edit(
    page,
    'extern "C" int square(int x) { return x*x; }\n' +
      'extern "C" int branch(int x) { return x > 2 ? square(x) : x+1; }'
  );
  await compile(page);
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).toContainText('square');
  const metadata = page.getByRole('checkbox', { name: 'Hide metadata' });
  await expect(metadata).toBeChecked();
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).not.toContainText('.custom_section.producers');
  await metadata.uncheck();
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).toContainText('.custom_section.producers');
  await metadata.check();
  await tab(page, 'AST');
  await compile(page);
  await expect(page.getByLabel('AST output', { exact: true })).toContainText(
    'TranslationUnitDecl'
  );
  await expect(
    page.getByLabel('AST output', { exact: true })
  ).not.toContainText('$ clang');
  await tab(page, 'LLVM IR');
  await compile(page);
  await expect(page.getByLabel('LLVM IR — before passes output')).toContainText(
    'alloca'
  );
  await tab(page, 'Wasm module');
  await compile(page);
  await expect(page.getByLabel('Wasm module output')).toContainText('(module');
  await expect(page.getByLabel('Wasm module output')).toContainText('i32.mul');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('program.wasm');

  await tab(page, 'Graphviz');
  await compile(page);
  await expect(
    page.getByRole('combobox', { name: 'Graph', exact: true }).locator('option')
  ).toHaveCount(2);
  await expect(page.getByAltText('Compiler graph')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Graph', exact: true })
    .selectOption({ index: 1 });
  await expect(page.getByAltText('Compiler graph')).toHaveJSProperty(
    'complete',
    true
  );
  const outputs = page.getByRole('region', { name: 'Outputs', exact: true });
  await tab(page, 'LLVM IR');
  await advanced(page, 'Compare outputs');
  const comparison = page.getByRole('region', {
    name: 'Comparison outputs',
    exact: true
  });
  await comparison.getByRole('tab', { name: 'Graphviz', exact: true }).click();
  await expect(
    outputs.getByLabel('LLVM IR — before passes output')
  ).toBeVisible();
  await expect(comparison.getByAltText('Compiler graph')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-compiles', '5');
  await page.screenshot({ path: testInfo.outputPath('comparison.png') });
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Comparison outputs', exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Outputs', exact: true })
      .getByLabel('LLVM IR — before passes output')
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Comparison outputs', exact: true })
      .getByLabel('Graphviz output')
  ).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-compiles');
});

test('runner state, reset, NaN, and timeout @compat', async ({ page }) => {
  await page.goto(standalone);
  await edit(page, 'extern "C" int next() { static int x = 0; return ++x; }');
  await page
    .getByRole('button', { name: 'Compile and Run', exact: true })
    .click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 1');
  const run = page.getByRole('button', {
    name: 'Compile and Run',
    exact: true
  });
  const runFunction = page.getByRole('button', { name: 'Run function' });
  await page
    .getByLabel('Target', { exact: true })
    .selectOption('x86_64-unknown-linux-gnu');
  await expect(run).toBeDisabled();
  await expect(runFunction).toBeDisabled();
  await page
    .getByLabel('Target', { exact: true })
    .selectOption('wasm32-unknown-emscripten');
  await expect(run).toBeEnabled();
  await expect(runFunction).toBeEnabled();
  await run.click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 1');
  await page.getByRole('button', { name: 'Run function', exact: true }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 2');
  await page
    .getByRole('button', { name: 'Reset execution', exact: true })
    .click();
  await page.getByRole('button', { name: 'Run function', exact: true }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 1');
  await edit(page, 'extern "C" double value() { return __builtin_nan(""); }');
  await page
    .getByRole('button', { name: 'Compile and Run', exact: true })
    .click();
  await expect(page.getByLabel('Execution result')).toContainText(
    'Return: NaN'
  );
  await page.getByText('Execution settings', { exact: true }).click();
  await page.getByLabel('Execution timeout (seconds)').fill('0.1');
  await edit(
    page,
    'extern "C" int spin() { volatile unsigned x=0; while (1) x=x+1; }'
  );
  await page
    .getByRole('button', { name: 'Compile and Run', exact: true })
    .click();
  await expect(page.getByLabel('Execute pane')).toContainText(
    'Execution timed out'
  );
  await edit(page, 'extern "C" int recovered() { return 42; }');
  await compile(page);
  await page
    .getByRole('button', { name: 'Compile and Run', exact: true })
    .click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 42');
});

test('LLVM, MLIR, commands, and invalid pass recovery @compat', async ({
  page
}) => {
  let optimizers = 0;
  let translators = 0;
  page.on('request', request => {
    if (request.url().endsWith('/mlir/mlir-opt.wasm')) {
      optimizers += 1;
    }
    if (request.url().endsWith('/mlir/mlir-translate.wasm')) {
      translators += 1;
    }
  });
  await page.goto(standalone);
  await page.getByLabel('Language', { exact: true }).selectOption('llvm');
  await page.getByRole('button', { name: 'Reset example' }).click();
  await compile(page);
  expect(optimizers).toBe(0);
  expect(translators).toBe(0);
  await tab(page, 'Terminal');
  const command = page.getByLabel('Compiler command');
  await command.fill(
    'opt "-passes=print<domtree>" -disable-output optimized.ll 2> tree.txt'
  );
  await command.press('Enter');
  await expect(command).toHaveValue('');
  const tree = page.getByRole('button', { name: 'tree.txt', exact: true });
  await expect(tree).toBeVisible();
  await page.getByLabel('Language', { exact: true }).selectOption('mlir');
  await page.getByRole('button', { name: 'Reset example' }).click();
  await tab(page, 'LLVM IR');
  await compile(page);
  expect(optimizers).toBe(1);
  expect(translators).toBe(1);
  const llvmOutput = page.getByLabel('LLVM IR — before passes output');
  await expect(llvmOutput).toContainText('define i32 @add');
  await tab(page, 'MLIR');
  await expect(page.getByLabel('MLIR output')).toContainText('llvm.func @add');
  await tab(page, 'Graphviz');
  await compile(page);
  await expect(page.getByAltText('Compiler graph')).toBeVisible();
  await advanced(page, 'Pipelines');
  await page
    .getByLabel('MLIR pipeline', { exact: true })
    .fill('builtin.module(missing-pass)');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'Some outputs failed'
  );
  await tab(page, 'Pipelines');
  await page
    .getByLabel('MLIR pipeline', { exact: true })
    .fill(
      'builtin.module(canonicalize,cse,convert-arith-to-llvm,' +
        'convert-func-to-llvm,reconcile-unrealized-casts)'
    );
  await compile(page);
  expect(optimizers).toBeGreaterThan(1);
  expect(translators).toBe(1);
});

test('share links restore source and pipeline options', async ({
  page,
  context
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(standalone);
  await edit(page, '// λ\nint shared(int x) { return x+7; }');
  await advanced(page, 'Pipelines');
  await page.getByLabel('LLVM pipeline', { exact: true }).fill('mem2reg');
  await advanced(page, 'Copy share link');
  await expect(page.getByRole('alert')).toHaveText('Share link copied.');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('wasmbolt=');
  const shared = await context.newPage();
  await shared.goto(url);
  await expect(
    shared.getByRole('textbox', { name: 'Source code' })
  ).toContainText('shared');
  await tab(shared, 'Pipelines');
  await expect(shared.getByLabel('LLVM pipeline', { exact: true })).toHaveValue(
    'mem2reg'
  );
  await shared.close();
});
