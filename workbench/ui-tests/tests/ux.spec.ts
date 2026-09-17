import { expect, test } from '@playwright/test';

test('focused defaults, contextual outputs, and folding tools @compat', async ({
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
  const diagnostics = page.getByRole('tab', { name: 'Diagnostics' });
  const pane = page.getByLabel('Diagnostics pane');
  await expect(source).toBeVisible();
  await expect(pane).toBeHidden();
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  const original = await source.boundingBox();
  await diagnostics.focus();
  await diagnostics.press('Enter');
  await expect(pane).toBeVisible();
  const expanded = await source.boundingBox();
  expect(expanded?.height).toBeLessThan(original?.height ?? 0);
  await diagnostics.press('Enter');
  await expect(pane).toBeHidden();
  await page.reload();
  await expect(pane).toBeHidden();
  await diagnostics.click();
  await expect(pane).toBeVisible();
  await expect
    .poll(async () => (await source.boundingBox())?.height)
    .toBeCloseTo(expanded?.height ?? 0, 0);
  await diagnostics.click();
  await expect(pane).toBeHidden();
  await page.getByLabel('Language', { exact: true }).selectOption('mlir');
  await expect(source).toContainText('func.func');
  const outputs = page.getByRole('region', { name: 'Outputs', exact: true });
  await expect(outputs.getByRole('tab')).toHaveText(['MLIR', 'Graphs']);
  await expect(page.getByLabel('Target', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare' }).click();
  const comparison = page.getByRole('region', { name: 'Comparison outputs' });
  await expect(comparison.getByRole('tab', { name: 'Graphs' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await source.fill('my experiment');
  await page.getByLabel('Language', { exact: true }).selectOption('cpp');
  await expect(source).toHaveText('my experiment');
  await page
    .getByLabel('Target', { exact: true })
    .selectOption('x86_64-unknown-linux-gnu');
  await expect(outputs.getByRole('tab', { name: 'Wasm module' })).toHaveCount(
    0
  );
  await page.getByRole('button', { name: 'Compare' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    'Compile',
    'Run',
    'Compare',
    'Share',
    'Guide',
    'Reset layout'
  ]) {
    await expect(
      page.getByRole('button', { name, exact: true })
    ).toBeInViewport({ ratio: 1 });
  }
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(source).toHaveText('my experiment');
  expect(downloads).toEqual([]);
});
