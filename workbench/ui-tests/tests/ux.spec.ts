import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function advanced(page: Page, name: string) {
  const more = page.getByLabel('More actions', { exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }
  await page.getByRole('button', { name, exact: true }).click();
}

test('focused defaults, contextual outputs, and dynamic tools @compat', async ({
  page
}) => {
  const downloads: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/compiler/')) {
      downloads.push(request.url());
    }
  });
  await page.goto('http://127.0.0.1:8765/dist/standalone/');
  const source = page.getByRole('textbox', { name: 'Source code' });
  await expect(source).toBeVisible();
  await expect(
    page.getByRole('tab', { name: 'Diagnostics', exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel('Diagnostics pane')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

  await advanced(page, 'Diagnostics');
  const diagnostics = page.getByRole('tab', {
    name: 'Diagnostics',
    exact: true
  });
  const pane = page.getByLabel('Diagnostics pane');
  await expect(diagnostics).toHaveAttribute('aria-selected', 'true');
  await expect(pane).toBeVisible();
  await page.getByRole('tab', { name: 'Outputs', exact: true }).click();
  await expect(pane).toBeHidden();
  await diagnostics.click();
  await expect(pane).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Diagnostics pane')).toBeVisible();

  await page.getByRole('tab', { name: 'Outputs', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('mlir');
  await expect(source).toContainText('func.func');
  const outputs = page.getByRole('region', { name: 'Outputs', exact: true });
  await expect(outputs.getByRole('tab')).toHaveText([
    'MLIR',
    'LLVM IR',
    'Graphviz'
  ]);
  await expect(page.getByLabel('Target', { exact: true })).toHaveCount(0);

  await advanced(page, 'Compare outputs');
  const comparison = page.getByRole('region', {
    name: 'Comparison outputs',
    exact: true
  });
  const graphviz = comparison.getByRole('tab', {
    name: 'Graphviz',
    exact: true
  });
  await graphviz.click();
  await expect(graphviz).toHaveAttribute('aria-selected', 'true');
  await source.fill('my experiment');
  await page.getByLabel('Language', { exact: true }).selectOption('cpp');
  await expect(source).toHaveText('my experiment');
  await page
    .getByLabel('Target', { exact: true })
    .selectOption('x86_64-unknown-linux-gnu');
  await expect(outputs.getByRole('tab', { name: 'Wasm module' })).toHaveCount(
    0
  );
  await advanced(page, 'Compare outputs');
  await expect(comparison).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Compile', 'Compile and Run', 'Load Wasm']) {
    await expect(
      page.getByRole('button', { name, exact: true })
    ).toBeInViewport({ ratio: 1 });
  }
  const more = page.getByLabel('More actions', { exact: true });
  await expect(more).toBeInViewport({ ratio: 1 });
  await more.click();
  for (const name of [
    'Diagnostics',
    'Pipelines',
    'Compare outputs',
    'Guide',
    'Reset layout',
    'Copy share link'
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(source).toHaveText('my experiment');
  await expect
    .poll(() => downloads.some(url => url.endsWith('/compiler/Compiler.wasm')))
    .toBe(true);
});
