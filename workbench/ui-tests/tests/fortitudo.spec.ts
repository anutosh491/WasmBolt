import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const standalone = 'http://127.0.0.1:8765/dist/standalone/';
const hosts = {
  standalone,
  jupyterlab: 'http://127.0.0.1:8766/fortitudo/lab',
  jupyterlite: 'http://127.0.0.1:8765/lite/_output/lab/index.html'
};

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  if (url !== standalone) {
    const launch = page.getByText('Open Fortitudo', { exact: true });
    const workbench = page.locator('#fortitudo-workbench');
    await expect(launch.first().or(workbench).first()).toBeVisible();
    if (!(await workbench.isVisible())) {
      await launch.first().click();
    }
  }
  await expect(
    page.getByRole('textbox', { name: 'Source code' })
  ).toBeVisible();
}

async function reopen(page: Page, url: string): Promise<void> {
  if (url === standalone) {
    await open(page, url);
    return;
  }
  await page
    .getByRole('tab', { name: 'Fortitudo', exact: true })
    .locator('.lm-TabBar-tabCloseIcon')
    .click();
  await expect(page.locator('#fortitudo-workbench')).toHaveCount(0);
  await page.getByText('Open Fortitudo', { exact: true }).first().click();
}

async function edit(page: Page, source: string): Promise<void> {
  const editor = page.getByRole('textbox', { name: 'Source code' });
  await editor.fill(source);
  await expect(editor.locator('.cm-line')).toHaveText(source.split('\n'));
}

async function compile(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(
    page.getByRole('status').filter({
      hasText: 'Compilation complete'
    })
  ).toBeVisible();
}

test.describe('loading feedback', () => {
  // Lite's service worker would bypass the controlled download delays.
  test.use({ serviceWorkers: 'block' });
  for (const [host, url] of Object.entries(hosts)) {
    test(`${host}: download progress and preparation${
      host === 'standalone' ? ' @compat' : ''
    }`, async ({ page }, testInfo) => {
      let download = () => {};
      let prepare = () => {};
      const downloading = new Promise<void>(resolve => {
        download = resolve;
      });
      const preparing = new Promise<void>(resolve => {
        prepare = resolve;
      });
      await page.route('**/compiler/Compiler.wasm', async route => {
        await downloading;
        await route.continue().catch(() => {});
      });
      await page.route('**/compiler/Compiler.js', async route => {
        await preparing;
        await route.continue().catch(() => {});
      });
      try {
        await open(page, url);
        await page.getByLabel('Language', { exact: true }).selectOption('cpp');
        await page
          .getByLabel('Target', { exact: true })
          .selectOption('wasm32-unknown-emscripten');
        await edit(page, 'int square(int x) { return x * x; }');
        await page
          .getByRole('button', { name: 'Compile', exact: true })
          .click();
        const status = page.getByRole('status');
        const progress = page.getByRole('progressbar', {
          name: 'Compiler download'
        });
        await expect(status).toHaveText('Downloading compiler…');
        await expect(progress).toBeVisible();
        await expect
          .poll(() => progress.getAttribute('value').then(Number))
          .toBeGreaterThan(0);
        const loaded = Number(await progress.getAttribute('value'));
        const total = Number(await progress.getAttribute('max'));
        expect(loaded).toBeLessThan(total);
        await expect(progress).toHaveAttribute('aria-valuetext', / MB$/);
        await page.getByRole('tab', { name: 'Diagnostics' }).click();
        const diagnostics = page.getByLabel('Diagnostics pane');
        await expect(diagnostics).toContainText('Compiler.data');
        await expect(diagnostics).toContainText('Compiler.wasm');
        await expect(diagnostics).not.toContainText(
          'Ctrl/Cmd+Enter to compile'
        );
        await expect(
          page.getByRole('button', { name: 'Cancel' })
        ).toBeEnabled();
        await edit(page, 'int edited_while_loading() { return 7; }');
        await page.screenshot({ path: testInfo.outputPath('downloading.png') });
        await page.setViewportSize({ width: 650, height: 720 });
        await expect(progress).toBeInViewport();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const spinner = page.locator('.fortitudo-spinner');
        await expect(spinner).toHaveCSS('animation-name', 'none');
        download();
        await expect(status).toHaveText('Preparing compiler…');
        await expect(progress).toHaveCount(0);
        await expect(spinner).toBeVisible();
        await expect(diagnostics).toContainText('Downloads complete.');
        await page.screenshot({ path: testInfo.outputPath('preparing.png') });
        prepare();
        await expect(page.getByLabel('Assembly output')).toContainText(
          'i32.mul'
        );
        await expect(spinner).toHaveCount(0);
        await expect(diagnostics).not.toContainText('Compiler.wasm');
        await compile(page);
        await expect(page.getByLabel('Assembly output')).toContainText(
          'edited_while_loading'
        );
      } finally {
        download();
        prepare();
        await page.unrouteAll({ behavior: 'wait' });
      }
    });
  }
});

for (const [host, url] of Object.entries(hosts)) {
  test(`${host}: edit, compile, inspect, restore${
    host === 'standalone' ? ' @compat' : ''
  }`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page, url);
    // Jupyter may restore another output selection or comparison layout.
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await page.getByRole('tab', { name: 'Assembly', exact: true }).click();
    await page.getByLabel('Language', { exact: true }).selectOption('cpp');
    await page
      .getByLabel('Target', { exact: true })
      .selectOption('wasm32-unknown-emscripten');
    await edit(page, 'int square(int x) { return x * x; }');
    const source = page.getByRole('textbox', { name: 'Source code' });
    const sourcePane = page.getByLabel('Source pane');
    await sourcePane.getByRole('button', { name: 'Find' }).click();
    const sourceSearch = sourcePane.getByPlaceholder('Find');
    await sourceSearch.pressSequentially('square');
    await sourceSearch.press('Enter');
    await expect(sourcePane.locator('.cm-searchMatch-selected')).toHaveText(
      'square'
    );
    await sourceSearch.press('Escape');
    await expect(source).toBeFocused();
    await source.press('Escape');
    await source.press('Tab');
    await expect(source).not.toBeFocused();
    await expect(source).toHaveText('int square(int x) { return x * x; }');
    const started = Date.now();
    await compile(page);
    await expect(page.getByLabel('Assembly output')).toContainText('i32.mul');
    await testInfo.attach('initial-compile.json', {
      body: JSON.stringify({ host, elapsedMs: Date.now() - started }),
      contentType: 'application/json'
    });
    await edit(page, 'int twice(int x) { return x + x; }');
    await expect(
      page
        .getByLabel('Assembly pane')
        .getByText('Out of date — compile to update')
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Source code' })
      .press('ControlOrMeta+Enter');
    await expect(page.getByLabel('Assembly output')).toContainText('twice');
    const assemblyPane = page.getByLabel('Assembly pane');
    const assembly = page.getByRole('textbox', { name: 'Assembly output' });
    await expect(assembly).toHaveAttribute('aria-readonly', 'true');
    const text = await assembly.textContent();
    await assemblyPane.getByRole('button', { name: 'Find' }).focus();
    await page.keyboard.press('Tab');
    await expect(assembly).toBeFocused();
    await assembly.press('ControlOrMeta+f');
    const outputSearch = assemblyPane.getByPlaceholder('Find');
    await outputSearch.pressSequentially('twice');
    await outputSearch.press('Enter');
    await expect(assemblyPane.locator('.cm-searchMatch-selected')).toHaveText(
      'twice'
    );
    await outputSearch.press('Escape');
    await expect(assembly).toBeFocused();
    await assembly.press('Backspace');
    await expect(assembly).toHaveText(text ?? '');
    await edit(page, 'int from_output() { return 7; }');
    await assembly.press('ControlOrMeta+Enter');
    await expect(assembly).toContainText('from_output');
    await edit(page, 'int broken() { return missing; }');
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    const diagnostic = page.getByRole('button', {
      name: /error Line 1: use of undeclared identifier 'missing'/
    });
    await expect(diagnostic).toBeVisible();
    // A fresh Jupyter profile can show its news prompt over this button.
    const notification = page.getByRole('button', {
      name: 'Hide notification',
      exact: true
    });
    if (await notification.isVisible()) {
      await notification.click();
    }
    await diagnostic.click();
    await expect(
      page.getByRole('textbox', { name: 'Source code' })
    ).toBeFocused();
    await edit(page, 'int restored(int x) { return x + 9; }');
    await page.getByLabel('Optimization', { exact: true }).selectOption('3');
    await reopen(page, url);
    await expect(page.getByRole('textbox', { name: 'Source code' })).toHaveText(
      'int restored(int x) { return x + 9; }'
    );
    await expect(page.getByLabel('Optimization', { exact: true })).toHaveValue(
      '3'
    );
    await expect(page.getByLabel('Assembly output')).toContainText(
      'Compile to see output'
    );
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Source code' })).toHaveText(
      'int restored(int x) { return x + 9; }'
    );
    await expect(page.getByLabel('Assembly output')).toContainText(
      'Compile to see output'
    );
    await page.screenshot({ path: testInfo.outputPath(`${host}.png`) });
    expect(errors).toEqual([]);
  });
}

test('invalid saved state falls back with feedback', async ({ page }) => {
  await page.goto(standalone);
  await page.evaluate(() => {
    localStorage.setItem('fortitudo:session:v1', '{"version":99}');
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Saved state is invalid');
  await expect(
    page.getByRole('textbox', { name: 'Source code' })
  ).toContainText('square');
});

test('missing assets, cancellation during loading, and retry', async ({
  page
}) => {
  await page.route('**/compiler/manifest.json', route =>
    route.fulfill({
      status: 404,
      body: 'Missing'
    })
  );
  await open(page, standalone);
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('404');
  await page.unroute('**/compiler/manifest.json');
  let release = () => {};
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/compiler/Compiler.wasm', async route => {
    await waiting;
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: 'Retry compilation' }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Compiler download' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cancelled');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.fortitudo-spinner')).toHaveCount(0);
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await compile(page);
  await expect(page.getByLabel('Assembly output')).toContainText('i32.mul');
});

test('corrupt Wasm produces a runtime failure and can recover', async ({
  page
}) => {
  await page.route('**/compiler/Compiler.wasm', route =>
    route.fulfill({
      contentType: 'application/wasm',
      body: 'invalid wasm'
    })
  );
  await open(page, standalone);
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry compilation' })
  ).toBeEnabled();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unrouteAll();
  await page.getByRole('button', { name: 'Retry compilation' }).click();
  await expect(page.getByLabel('Assembly output')).toContainText('i32.mul');
});

test('editing, cancellation during compilation, and retry', async ({
  page
}) => {
  await open(page, standalone);
  await compile(page);
  await page.getByRole('textbox', { name: 'Source code' }).fill(
    [
      // Expand a compact source into enough work to reliably cancel it.
      '#define VALUES_0 0',
      ...Array.from(
        { length: 22 },
        (_, i) => `#define VALUES_${i + 1} VALUES_${i}, VALUES_${i}`
      ),
      'int slow[] = { VALUES_22 };'
    ].join('\n')
  );
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeEnabled();
  await edit(page, 'int after_cancel(int x) { return x + 7; }');
  await expect(
    page.getByRole('button', { name: 'Compile', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cancelled');
  await compile(page);
  await expect(page.getByLabel('Assembly output')).toContainText(
    'after_cancel'
  );
});

test('initialized compiler can compile changed source offline', async ({
  page,
  context
}) => {
  await open(page, standalone);
  await compile(page);
  await context.setOffline(true);
  await edit(page, 'int offline(int x) { return x - 3; }');
  await compile(page);
  await expect(page.getByLabel('Assembly output')).toContainText('offline');
  await context.setOffline(false);
});

for (const [host, url] of Object.entries(hosts)) {
  test(`${host}: resize and reset panes within the host`, async ({ page }) => {
    await open(page, url);
    if (host === 'jupyterlab') {
      // Host sidebar widths are independent of Fortitudo's saved layout.
      const files = page.getByRole('tab', { name: /^File Browser/ });
      if ((await files.getAttribute('aria-selected')) === 'true') {
        await files.click();
      }
    }
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await edit(page, 'int resized() { return 12; }');
    const workbench = page.locator('#fortitudo-workbench');
    await expect(workbench.locator('.lm-DockPanel')).toHaveCount(0);
    const source = workbench.getByRole('region', {
      name: 'Source pane',
      exact: true
    });
    await expect(source).toBeVisible();
    const width = () => source.evaluate(node => node.clientWidth);
    const original = await width();
    const handle = workbench.locator(
      '.lm-SplitPanel[data-orientation="horizontal"] ' +
        '> .lm-SplitPanel-handle:not(.lm-mod-hidden)'
    );
    const from = await handle.boundingBox();
    if (!from) {
      throw new Error('The workbench divider is not laid out.');
    }
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 100, y, { steps: 20 });
    await page.mouse.up();
    await expect.poll(width).toBeLessThan(original - 80);
    const resized = await width();
    await reopen(page, url);
    await expect.poll(width).toBeGreaterThan(resized - 3);
    await expect.poll(width).toBeLessThan(resized + 3);
    // Jupyter may defer saving its open tabs; its launcher can reopen us.
    await open(page, url);
    await expect(source).toBeVisible();
    await expect.poll(width).toBeGreaterThan(resized - 3);
    await expect.poll(width).toBeLessThan(resized + 3);
    await expect(page.getByRole('textbox', { name: 'Source code' })).toHaveText(
      'int resized() { return 12; }'
    );
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect.poll(width).toBeGreaterThan(original - 3);
    await expect.poll(width).toBeLessThan(original + 3);
    await expect(workbench.getByRole('tablist')).toHaveCount(2);
    await page.setViewportSize({ width: 650, height: 720 });
    await expect(
      page.getByRole('button', { name: 'Compile', exact: true })
    ).toBeInViewport();
    await expect(workbench.getByRole('alert')).toHaveCount(0);
  });
}

test('previously docked tab groups restore and save their selection', async ({
  page
}) => {
  await open(page, standalone);
  await page.evaluate(() => {
    localStorage.setItem(
      'fortitudo:session:v1',
      JSON.stringify({
        version: 1,
        source: 'int grouped() { return 12; }',
        options: {
          language: 'cpp',
          target: 'wasm32-unknown-emscripten',
          optimization: 2
        },
        layout: {
          type: 'split-area',
          orientation: 'horizontal',
          sizes: [0.4, 0.6],
          children: [
            { type: 'tab-area', widgets: ['source'], currentIndex: 0 },
            {
              type: 'tab-area',
              widgets: ['assembly', 'diagnostics'],
              currentIndex: 0
            }
          ]
        }
      })
    );
  });
  await page.reload();
  const workbench = page.locator('#fortitudo-workbench');
  await expect(workbench.getByRole('tablist')).toHaveCount(2);
  await expect(page.getByLabel('Assembly output')).toBeVisible();
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByLabel('Assembly output')).toBeHidden();
  await page.reload();
  await expect(page.getByLabel('Diagnostics pane')).toBeVisible();
  await expect(page.getByLabel('Assembly output')).toBeHidden();
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(workbench.getByRole('tablist')).toHaveCount(2);
  await expect(page.getByLabel('Assembly output')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Source code' })).toHaveText(
    'int grouped() { return 12; }'
  );
  await compile(page);
  await expect(page.getByLabel('Assembly output')).toContainText('grouped');
});

for (const asset of ['Compiler.js', 'Compiler.data']) {
  test(`missing ${asset} fails initialization and permits retry`, async ({
    page
  }) => {
    await page.route(`**/compiler/${asset}`, route =>
      route.fulfill({
        status: 404,
        body: 'Missing'
      })
    );
    await open(page, standalone);
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retry compilation' })
    ).toBeEnabled();
    await page.unrouteAll();
    await page.getByRole('button', { name: 'Retry compilation' }).click();
    await expect(page.getByLabel('Assembly output')).toContainText('i32.mul');
  });
}
