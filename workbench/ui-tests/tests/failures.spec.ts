import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const standalone = 'http://127.0.0.1:8765/dist/standalone/';

async function edit(page: Page, source: string) {
  await page.getByRole('textbox', { name: 'Source code' }).fill(source);
}

async function tab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true }).first();
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
}

async function compile(page: Page, failed = false) {
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText(
    failed ? 'Some outputs failed' : 'Compilation complete'
  );
}

async function command(page: Page, text: string) {
  await tab(page, 'Terminal');
  await page.getByLabel('Compiler command').fill(text);
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Compile', exact: true })
  ).toBeEnabled();
}

test('scalar signatures, streams, traps, Stop, and runner isolation', async ({
  page,
  context
}) => {
  await page.goto(standalone);
  await edit(
    page,
    `#include <cstdio>
extern "C" {
int i0() { return 3; }
int i1(int x) { return x + 4; }
int i2(int x, int y) { return x - y; }
double f0() { return 1.25; }
double f1(double x) { return x * 2.0; }
double f2(double x, double y) { return x + y; }
void notify() {
  std::printf("standard output");
  std::fprintf(stderr, "standard error");
}
long long wide(long long x) { return x; }
int trap() {
  std::puts("before trap");
  std::fflush(stdout);
  __builtin_trap();
}
int spin() { volatile unsigned x = 0; while (1) x = x + 1; }
}
int cpp(int x) { return x + 9; }`
  );
  await compile(page);
  await tab(page, 'Run');
  await expect(
    page.getByRole('combobox', { name: 'Export', exact: true })
  ).toHaveValue('');
  const calls: [string, string[], string][] = [
    ['i0', [], '3'],
    ['i1', ['-2'], '2'],
    ['i2', ['8', '3'], '5'],
    ['f0', [], '1.25'],
    ['f1', ['1.75'], '3.5'],
    ['f2', ['1.25', '2.5'], '3.75'],
    ['_Z3cppi', ['4'], '13'],
    ['notify', [], 'void']
  ];
  for (const [symbol, args, result] of calls) {
    await page
      .getByRole('combobox', { name: 'Export', exact: true })
      .selectOption(symbol);
    for (const [index, value] of args.entries()) {
      await page
        .getByLabel(`Argument ${index + 1}`, { exact: true })
        .fill(value);
    }
    await page.getByRole('button', { name: 'Run function' }).click();
    await expect(page.getByLabel('Execution result')).toContainText(
      `Return: ${result}`
    );
  }
  await expect(page.getByLabel('Execution result')).toContainText(
    'Stdout: standard output'
  );
  await expect(page.getByLabel('Execution result')).toContainText(
    'Stderr: standard error'
  );
  await page
    .getByRole('combobox', { name: 'Export', exact: true })
    .selectOption('wide');
  await expect(
    page.getByRole('button', { name: 'Run function' })
  ).toBeDisabled();
  await context.setOffline(true);
  await page
    .getByRole('combobox', { name: 'Export', exact: true })
    .selectOption('i0');
  await page.getByRole('button', { name: 'Run function' }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 3');
  await context.setOffline(false);
  await page
    .getByRole('combobox', { name: 'Export', exact: true })
    .selectOption('trap');
  await page.getByRole('button', { name: 'Run function' }).click();
  await expect(page.getByLabel('Run pane')).toContainText('unreachable');
  await expect(page.getByLabel('Execution result')).toContainText(
    'before trap'
  );
  await page
    .getByRole('combobox', { name: 'Export', exact: true })
    .selectOption('i0');
  await page.getByRole('button', { name: 'Run function' }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 3');
  await page
    .getByRole('combobox', { name: 'Export', exact: true })
    .selectOption('spin');
  await page.getByRole('button', { name: 'Run function' }).click();
  await expect(page.getByLabel('Run pane')).toContainText('Running program');
  await page
    .getByLabel('Run pane')
    .getByRole('button', { name: 'Stop', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Run function' })
  ).toBeEnabled();
  await compile(page);
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).toContainText('i0');
  await edit(page, 'int main() { return 4; }');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 4');
});

test('partial builds, invalid IR targets, and empty graphs recover', async ({
  page
}) => {
  await page.goto(standalone);
  await edit(page, 'int square(int x) { return x*x; }');
  await tab(page, 'Pipelines');
  await page
    .getByLabel('Analysis pipeline', { exact: true })
    .fill('missing-analysis');
  await compile(page, true);
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).toContainText('square');
  await tab(page, 'AST');
  await expect(page.getByLabel('AST output', { exact: true })).toContainText(
    'TranslationUnitDecl'
  );
  await tab(page, 'Pipelines');
  await page
    .getByLabel('Analysis pipeline', { exact: true })
    .fill('print<domtree>,print<loops>');
  await page.getByLabel('LLVM pipeline', { exact: true }).fill('missing-pass');
  await compile(page, true);
  await tab(page, 'LLVM IR');
  await expect(page.getByLabel('LLVM IR — before passes output')).toContainText(
    'define'
  );
  await tab(page, 'Assembly');
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).toContainText('Skipped');
  await tab(page, 'Pipelines');
  await page.getByLabel('LLVM pipeline', { exact: true }).fill('');
  await edit(page, 'extern int declaration(int);');
  await compile(page);
  await tab(page, 'Graphs');
  await expect(page.getByLabel('Graphs output')).toContainText('No graphs');
  await page.getByLabel('Language', { exact: true }).selectOption('llvm');
  for (const target of [
    'target triple = "x86_64-unknown-linux-gnu"',
    'target datalayout = "e-p:64:64"'
  ]) {
    await edit(page, `${target}\ndefine i32 @value() { ret i32 1 }`);
    await compile(page, true);
    await tab(page, 'LLVM IR');
    await expect(
      page.getByLabel('LLVM IR — before passes output')
    ).toContainText('does not match');
  }
  await page.getByRole('button', { name: 'Reset example' }).click();
  await compile(page);
});

test('MLIR retry and commands preserve build artifacts', async ({ page }) => {
  let downloads = 0;
  await page.route('**/WasmBoltMlirOpt.so', route => {
    downloads += 1;
    return downloads === 1
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.continue();
  });
  await page.goto(standalone);
  await page.getByLabel('Language', { exact: true }).selectOption('mlir');
  await page.getByRole('button', { name: 'Reset example' }).click();
  await compile(page, true);
  await tab(page, 'MLIR');
  await expect(page.getByLabel('MLIR output')).toContainText('503');
  await compile(page);
  expect(downloads).toBe(2);
  await command(
    page,
    'mlir-opt --pass-pipeline="builtin.module(cse)" optimized.mlir ' +
      '-o manual.mlir'
  );
  await expect(page.getByLabel('Command log')).toContainText('Exit 0');
  await command(page, 'mlir-opt manual.mlir > "copied module.mlir"');
  expect(downloads).toBe(2);
  await tab(page, 'Files');
  await page
    .getByLabel('Workspace file')
    .selectOption('/workspace/copied module.mlir');
  await expect(page.getByLabel('File output')).toContainText('func.func');
  await page.getByLabel('Language', { exact: true }).selectOption('cpp');
  await edit(page, 'extern "C" int scalar() { return 17; }');
  await compile(page);
  await command(
    page,
    'wasm-ld -shared --export-all ' +
      '--unresolved-symbols=import-dynamic output.o -o manual.wasm'
  );
  await tab(page, 'Files');
  await page
    .getByLabel('Workspace file')
    .selectOption('/workspace/manual.wasm');
  await page.getByRole('button', { name: 'Use module' }).click();
  await page.getByRole('button', { name: 'Run function' }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 17');
  await command(page, 'wasm-ld missing.o -o broken.wasm');
  await expect(page.getByLabel('Command log')).toContainText('Exit 1');
  await tab(page, 'Assembly');
  await expect(
    page.getByLabel('Assembly output', { exact: true })
  ).toContainText('scalar');
  await tab(page, 'Wasm module');
  await expect(
    page
      .getByRole('tabpanel', { name: 'Wasm module', exact: true })
      .getByLabel('Wasm module output')
  ).toContainText('scalar');
  await edit(page, 'extern "C" int scalar() { return 19; }');
  await command(
    page,
    'opt "-passes=print<domtree>" ' + '-disable-output optimized.ll'
  );
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 19');
});

test('missing runtime dependencies fail without breaking compilation', async ({
  page
}) => {
  await page.goto(standalone);
  await edit(
    page,
    `extern "C" int absent();
extern "C" int value() { return absent(); }`
  );
  await compile(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Run pane')).toContainText('absent');
  await edit(page, 'extern "C" int value() { return 21; }');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 21');
});
