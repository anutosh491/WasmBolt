import { expect, test } from '@playwright/test';

const sites = {
  site: 'http://127.0.0.1:8765/dist/site/',
  local: 'http://127.0.0.1:8767/'
};

for (const [host, site] of Object.entries(sites)) {
  test.describe(host, () => {
    test.beforeEach(async ({ context }) => {
      await context.route('https://api.github.com/**', route => route.abort());
      if (host === 'local') {
        await context.route(/^https?:/, route =>
          new URL(route.request().url()).hostname === '127.0.0.1'
            ? route.continue()
            : route.abort()
        );
      }
    });

    test('repository metadata and offline fallback @compat', async ({
      page
    }, testInfo) => {
      const api = 'https://api.github.com/repos/anutosh491/WasmBolt';
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.route(`${api}**`, route =>
        route.fulfill({
          json: route.request().url().endsWith('/releases/latest')
            ? { tag_name: 'v1.2.3' }
            : { stargazers_count: 42, forks_count: 1 }
        })
      );
      await page.goto(site);
      const details = page.locator('#wasmbolt-repository-details');
      await expect(details).toHaveText('v1.2.3 · 42 stars · 1 fork');
      const badges = page.getByRole('navigation', { name: 'WasmBolt links' });
      await badges.screenshot({ path: testInfo.outputPath('badges.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await badges.screenshot({ path: testInfo.outputPath('badges-dark.png') });
      await page.setViewportSize({ width: 390, height: 850 });
      await badges.screenshot({
        path: testInfo.outputPath('badges-narrow.png')
      });

      await page.route(`${api}**`, route => route.abort());
      const failed = [api, `${api}/releases/latest`].map(url =>
        page.waitForEvent('requestfailed', request => request.url() === url)
      );
      await page.reload();
      await Promise.all(failed);
      await expect(details).toHaveText(/^\s*v\S+ · Source on GitHub\s*$/);
      await expect(
        page.getByRole('link', { name: 'Try in Jupyter' })
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Source code' })
      ).toBeVisible();
      expect(failures).toEqual([]);
    });

    test('compile and navigate to JupyterLite @compat', async ({
      page
    }, testInfo) => {
      await page.goto(site);
      await page
        .getByRole('textbox', { name: 'Source code' })
        .fill('int square(int value) { return value * value; }');
      await page.getByRole('button', { name: 'Compile', exact: true }).click();
      await expect(page.getByLabel('Assembly output')).toContainText('i32.mul');
      await expect(
        page.getByRole('link', { name: 'anutosh491/WasmBolt on GitHub' })
      ).toHaveAttribute('href', 'https://github.com/anutosh491/WasmBolt');
      await page.screenshot({ path: testInfo.outputPath('site.png') });

      const link = page.getByRole('link', {
        name: 'Try in Jupyter',
        exact: true
      });
      const pages = page.context().pages().length;
      await expect(link).not.toHaveAttribute('target', '_blank');
      await link.click();
      await expect(page).toHaveURL(`${site}lite/lab/index.html`);
      expect(page.context().pages()).toHaveLength(pages);
      const home = page.getByRole('link', { name: 'WasmBolt home' });
      await expect(home).toHaveAttribute('href', '/');
      await expect(page.locator('#jp-MainLogo')).toHaveCount(1);
      await expect(home.locator('img')).toHaveAttribute(
        'src',
        `${site}lite/icon.svg`
      );
      await expect
        .poll(() =>
          home
            .locator('img')
            .evaluate(
              image =>
                image instanceof HTMLImageElement && image.naturalWidth > 0
            )
        )
        .toBe(true);
      await page.getByText('Open WasmBolt', { exact: true }).first().click();
      await page
        .getByRole('textbox', { name: 'Source code' })
        .fill('int twice(int value) { return value + value; }');
      await page.getByRole('button', { name: 'Compile', exact: true }).click();
      await expect(page.getByLabel('Assembly output')).toContainText('twice');
      await page.screenshot({ path: testInfo.outputPath('jupyterlite.png') });
      await home.click();
      await expect(page).toHaveURL(new URL('/', site).href);
      expect(page.context().pages()).toHaveLength(pages);
      if (host === 'site') {
        // This test serves the site below a prefix, outside the domain root.
        await page.goto(site);
      }
      await expect(page).toHaveURL(site);
      await expect(
        page.getByRole('textbox', { name: 'Source code' })
      ).toContainText('int square(int value)');
    });

    for (const [language, file, outputs] of [
      ['C++23', 'C++ examples.ipynb', ['C++ total: 42', 'square(7): 49']],
      ['C23', 'C examples.ipynb', ['C square(7): 49', 'C total: 42']]
    ] as const) {
      test(`execute ${language} notebook @compat`, async ({
        page
      }, testInfo) => {
        const failures: string[] = [];
        page.on('pageerror', error => failures.push(error.message));
        const started = Date.now();
        await page.goto(
          `${site}lite/lab/index.html?path=${encodeURIComponent(file)}`
        );
        const notebook = page.locator('.jp-Notebook');
        await expect(notebook).toBeVisible();
        await page.getByRole('menuitem', { name: 'Run', exact: true }).click();
        await page
          .getByRole('menuitem', { name: 'Run All Cells', exact: true })
          .click();
        for (const output of outputs) {
          await expect(notebook.locator('.jp-OutputArea')).toContainText(
            [output],
            {
              timeout: 120_000
            }
          );
        }
        await expect(notebook.locator('.jp-OutputArea-error')).toHaveCount(0);
        await notebook
          .getByRole('link', { name: 'WasmBolt guide' })
          .first()
          .click();
        const guide = page.locator('.jp-MarkdownViewer');
        await expect(
          guide.getByRole('heading', { name: 'WasmBolt guide' })
        ).toBeVisible();
        await expect(guide).toContainText(
          'Repeated calls retain module state.'
        );
        expect(failures).toEqual([]);
        await testInfo.attach('kernel.json', {
          body: JSON.stringify({ file, elapsedMs: Date.now() - started }),
          contentType: 'application/json'
        });
      });
    }
  });
}
