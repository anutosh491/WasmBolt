import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const hosts = {
  standalone: 'http://127.0.0.1:8765/dist/standalone/',
  jupyterlab: 'http://127.0.0.1:8766/wasmbolt/lab',
  jupyterlite: 'http://127.0.0.1:8765/dist/site/lite/lab/index.html'
};

async function expectUnclippedTabs(group: Locator): Promise<void> {
  const tabs = group.getByRole('tab');
  for (const tab of await tabs.all()) {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() =>
        tab.evaluate(element => {
          const bar = element.closest('.lm-TabBar');
          const label = element.querySelector('.lm-TabBar-tabLabel');
          if (!bar || !label) {
            return false;
          }
          const bounds = bar.getBoundingClientRect();
          const text = label.getBoundingClientRect();
          const hit = document.elementFromPoint(
            text.x + text.width / 2,
            text.y + text.height / 2
          );
          return (
            text.top >= bounds.top &&
            text.bottom <= bounds.top + bar.clientHeight &&
            hit !== null &&
            element.contains(hit)
          );
        })
      )
      .toBe(true);
  }
}

async function advanced(page: Page, name: string): Promise<void> {
  const more = page.getByLabel('More actions', { exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }
  await page.getByRole('button', { name, exact: true }).click();
}

for (const [host, url] of Object.entries(hosts)) {
  test(`${host}: output tabs fit and sharing follows the host @compat`, async ({
    page
  }, testInfo) => {
    // Reset layout only resets WasmBolt, not Jupyter's saved sidebar widths.
    // Keep this geometry test independent of other tests and browser runs.
    const address =
      host === 'jupyterlab'
        ? `${url}/workspaces/wasmbolt-layout-${testInfo.project.name}?reset`
        : url;
    await page.goto(address);
    if (host !== 'standalone') {
      await page.getByText('Open WasmBolt', { exact: true }).click();
    }
    await expect(page.getByLabel('Source code')).toBeVisible();
    await advanced(page, 'Reset layout');
    const source = page.getByRole('textbox', { name: 'Source code' });
    const original = await source.locator('.cm-line').allTextContents();
    await page.getByLabel('More actions', { exact: true }).click();
    const guideButton = page.getByRole('button', {
      name: 'Guide',
      exact: true
    });
    const guide = page.getByRole('dialog', { name: 'WasmBolt guide' });
    if (host === 'standalone') {
      await page.context().setOffline(true);
    }
    await guideButton.focus();
    await guideButton.press('Enter');
    await expect(guide).toBeVisible();
    await expect(
      guide.locator('pre').filter({ hasText: 'pip install wasmbolt' })
    ).toBeInViewport();
    await guide.getByRole('button', { name: 'Execution', exact: true }).click();
    await expect(
      guide.getByRole('heading', { name: 'Execution', exact: true })
    ).toBeInViewport();
    await expect(guide).toContainText('Repeated calls retain module state.');
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await expect(guideButton).toBeFocused();
    await advanced(page, 'Guide');
    await page.screenshot({ path: testInfo.outputPath('guide.png') });
    await guide.getByRole('button', { name: 'Close guide' }).click();
    await expect(guide).toHaveCount(0);
    await expect(source.locator('.cm-line')).toHaveText(original);
    if (host === 'standalone') {
      await page.context().setOffline(false);
    }
    await source.fill('int undo_after_layout() { return 42; }');
    await expect(
      page.getByRole('button', { name: 'Copy share link' })
    ).toHaveCount(host === 'standalone' ? 1 : 0);
    await expect(page.getByRole('tab', { name: 'Outputs' })).toHaveCount(0);
    const outputs = page.getByRole('region', {
      name: 'Outputs',
      exact: true
    });
    const heading = page.getByRole('heading', { name: 'Source', exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Source' })).toHaveCount(0);
    await expect
      .poll(async () => {
        const source = await heading.boundingBox();
        const tabs = await outputs.locator('.lm-TabBar').boundingBox();
        return (
          source !== null &&
          tabs !== null &&
          Math.abs(source.y - tabs.y) < 1 &&
          Math.abs(source.height - tabs.height) < 1
        );
      })
      .toBe(true);
    await expectUnclippedTabs(outputs);
    await page.setViewportSize({ width: 850, height: 720 });
    await expect(
      outputs
        .getByRole('tab', { name: 'Wasm module', exact: true })
        .locator('.lm-TabBar-tabLabel')
    ).toBeInViewport({ ratio: 1 });
    await expectUnclippedTabs(outputs);
    await advanced(page, 'Compare outputs');
    const comparison = page.getByRole('region', {
      name: 'Comparison outputs',
      exact: true
    });
    await expect(comparison).toBeVisible();
    await expect(
      outputs
        .getByRole('tab', { name: 'LLVM IR', exact: true })
        .locator('.lm-TabBar-tabLabel')
    ).toBeInViewport({ ratio: 1 });
    await expect(
      comparison
        .getByRole('tab', { name: 'Graphviz', exact: true })
        .locator('.lm-TabBar-tabLabel')
    ).toBeInViewport({ ratio: 1 });
    await expectUnclippedTabs(comparison);
    await page.screenshot({ path: testInfo.outputPath('output-layout.png') });
    const assembly = outputs.getByRole('tab', {
      name: 'Assembly',
      exact: true
    });
    await assembly.click();
    await advanced(page, 'Compare outputs');
    await expect(comparison).toHaveCount(0);
    await expect(assembly).toHaveAttribute('aria-selected', 'true');
    await advanced(page, 'Compare outputs');
    await advanced(page, 'Reset layout');
    await expect(comparison).toHaveCount(0);
    await expect(outputs).toBeVisible();
    await source.press('ControlOrMeta+z');
    await expect(source.locator('.cm-line')).toHaveText(original);
  });
}
