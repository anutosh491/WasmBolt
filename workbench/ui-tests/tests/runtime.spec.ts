import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import type { Output } from '../../src/compiler/protocol';
import type { Options, Result } from '../../src/compiler/types';

const standalone = 'http://127.0.0.1:8765/dist/standalone/';
const xtensorArchive = 'packages/xtensor-0.27.1-h0b0027f_0.tar.gz';

test('runtime library aliases resolve to their payloads @compat', async ({
  page
}) => {
  await page.goto(standalone);
  await page
    .getByRole('textbox', { name: 'Source code' })
    .fill(
      [
        '#include <sys/stat.h>',
        'extern "C" int aliases() {',
        '  const char *paths[] = {',
        '    "/lib/libopenblas.so", "/lib/libopenblas.so.0",',
        '    "/lib/libz.so", "/lib/libz.so.1"',
        '  };',
        '  struct stat links[4], files[4];',
        '  for (int i = 0; i < 4; ++i) {',
        '    if (lstat(paths[i], &links[i]) || stat(paths[i], &files[i]))',
        '      return -1;',
        '    if (!S_ISLNK(links[i].st_mode) || !S_ISREG(files[i].st_mode))',
        '      return -2;',
        '    if (files[i].st_size == 0) return -3;',
        '  }',
        '  if (files[0].st_ino != files[1].st_ino) return -4;',
        '  if (files[2].st_ino != files[3].st_ino) return -5;',
        '  return 4;',
        '}'
      ].join('\n')
    );
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 4');
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await page
    .getByLabel('Compiler command')
    .fill(
      'wasm-ld -shared --unresolved-symbols=import-dynamic ' +
        'output.o -L/lib -lopenblas -lz -o linked.wasm'
    );
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(page.getByLabel('Command log')).toContainText('Exit 0');
});

test('real compiler: standards, headers, targets, repetition @compat', async ({
  page
}, testInfo) => {
  await page.goto(standalone);
  const measurements = await page.evaluate(async () => {
    const base = new URL('compiler/', document.baseURI).href;
    // Observe real Wasm memory allocation without adding a production API.
    const probe = `
      let memory;
      const Memory = WebAssembly.Memory;
      WebAssembly.Memory = class extends Memory {
        constructor(options) { super(options); memory = this; }
      };
      const send = self.postMessage.bind(self);
      self.postMessage = message => send({
        ...message, memoryBytes: memory?.buffer.byteLength ?? null
      });
      await import(${JSON.stringify(`${base}worker.js`)});
      send({ kind: "probe-ready" });
    `;
    const blob = URL.createObjectURL(
      new Blob([probe], {
        type: 'text/javascript'
      })
    );
    const worker = new Worker(blob, { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = () => resolve();
      worker.onerror = event => reject(new Error(event.message));
    });
    let id = 0;
    function send(message: object): Promise<
      Output & {
        memoryBytes: number | null;
      }
    > {
      return new Promise((resolve, reject) => {
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = event => {
          if (event.data.kind === 'progress') {
            return;
          } else if (event.data.kind === 'error') {
            reject(new Error(event.data.message));
          } else {
            resolve(event.data);
          }
        };
        worker.postMessage({ ...message, id: ++id });
      });
    }
    try {
      const start = performance.now();
      const ready = await send({ kind: 'initialize', base });
      if (ready.kind !== 'ready') {
        throw new Error('Expected capabilities.');
      }
      const initializationMs = performance.now() - start;
      const results: {
        name: string;
        result: Pick<
          Result,
          'id' | 'exitCode' | 'duration' | 'diagnostics' | 'stderr' | 'commands'
        > & {
          artifacts: { kind: string; bytes: number }[];
          stages: {
            name: string;
            status: string;
            stderr: string;
            duration: number;
          }[];
        };
        memoryBytes: number | null;
      }[] = [];
      async function compile(name: string, source: string, options: Options) {
        const response = await send({
          kind: 'compile',
          request: {
            id: id + 1,
            source,
            options
          }
        });
        if (response.kind !== 'result') {
          throw new Error('Expected a compiler result.');
        }
        results.push({
          name,
          result: {
            id: response.result.id,
            exitCode: response.result.exitCode,
            duration: response.result.duration,
            diagnostics: response.result.diagnostics,
            stderr: response.result.stderr.slice(0, 2000),
            commands: response.result.commands,
            artifacts: response.result.artifacts.map(artifact => ({
              kind: artifact.kind,
              bytes:
                artifact.format === 'text'
                  ? artifact.text.length
                  : artifact.data.byteLength
            })),
            stages: response.result.stages.map(stage => ({
              name: stage.name,
              status: stage.status,
              stderr: stage.stderr.slice(0, 2000),
              duration: stage.duration
            }))
          },
          memoryBytes: response.memoryBytes
        });
      }
      const options: Options = {
        language: 'cpp',
        target: 'wasm32-unknown-emscripten',
        optimization: 2,
        llvmPipeline: null,
        analysisPipeline: 'print<domtree>,print<loops>',
        mlirPipeline: 'builtin.module(canonicalize,cse)'
      };
      await compile(
        'c++23-headers',
        [
          '#include <vector>',
          '#include <cstdint>',
          'constexpr int answer = 42;',
          'int size(const std::vector<std::uint32_t>& v) {',
          '  if consteval { return answer; } else { return v.size(); }',
          '}'
        ].join('\n'),
        options
      );
      await compile(
        'c23-headers',
        [
          '#include <stdint.h>',
          'constexpr int answer = 42;',
          'uint32_t value(void) { return answer; }'
        ].join('\n'),
        { ...options, language: 'c' }
      );
      await compile('syntax-error', 'int broken( {', options);
      for (const target of ready.info.targets) {
        for (const optimization of [0, 1, 2, 3] as const) {
          await compile(
            `${target}-O${optimization}`,
            'int square(int x) { return x * x; }',
            { ...options, target, optimization }
          );
        }
        if (target !== options.target) {
          await compile(
            `${target}-no-system-headers`,
            '#include <stdio.h>\nint value() { return 42; }',
            { ...options, target }
          );
        }
      }
      return {
        info: ready.info,
        initializationMs,
        initialMemoryBytes: ready.memoryBytes,
        results
      };
    } finally {
      worker.terminate();
      URL.revokeObjectURL(blob);
    }
  });
  await testInfo.attach('compiler-measurements.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json'
  });
  expect(measurements.info.targets).toHaveLength(3);
  for (const { name, result } of measurements.results) {
    if (name === 'syntax-error' || name.endsWith('-no-system-headers')) {
      expect(result.exitCode, name).not.toBe(0);
      expect(result.diagnostics.length, name).toBeGreaterThan(0);
    } else {
      expect(result.exitCode, `${name}: ${result.stderr}`).toBe(0);
      expect(
        result.artifacts.some(
          artifact => artifact.kind === 'assembly' && artifact.bytes > 0
        ),
        name
      ).toBe(true);
      expect(
        result.stages.every(stage => stage.status === 'success'),
        name
      ).toBe(true);
    }
  }
});

test('standalone compiles the packaged xtensor example', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(standalone);
  const source = page.getByRole('textbox', { name: 'Source code' });
  await expect(source).toBeVisible();
  await page.getByRole('button', { name: 'xtensor.cpp', exact: true }).click();
  await expect(source).toContainText(
    '#include <xtensor/containers/xarray.hpp>'
  );

  // Compile only the selected representation and its prerequisites.
  await page.getByRole('tab', { name: 'LLVM IR', exact: true }).click();
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Compilation complete' })
  ).toBeVisible();
  const output = page.getByLabel('LLVM IR pane');
  await expect(page.getByLabel('LLVM IR output')).toContainText(
    'class.xt::xarray_container'
  );
  const downloaded = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download' }).click();
  const path = await (await downloaded).path();
  if (!path) {
    throw new Error('The LLVM IR download has no local path.');
  }
  expect(await readFile(path, 'utf8')).toContain('xtensor_broadcast_sum');
  await expect(page.getByText(/file exceeds its manifest size/i)).toHaveCount(
    0
  );
  expect(errors).toEqual([]);
});

test('Compile and Run keeps the normal C++ path in one worker', async ({
  page
}) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  await page.goto(standalone);
  await page
    .getByRole('textbox', { name: 'Source code' })
    .fill('int answer() { return 42; }');
  await page
    .getByRole('button', { name: 'Compile and Run', exact: true })
    .click();
  await expect(page.getByLabel('Execution result')).toContainText('Return: 42');

  const log = page.getByLabel('Command log');
  await expect(log).toContainText('clang++ -x c++');
  await expect(log).toContainText('-O2 -c /workspace/snippet.cpp');
  await expect(log).toContainText(
    'wasm-ld -shared --unresolved-symbols=import-dynamic ' +
      '/workspace/output.o ' +
      '-o /workspace/program.wasm'
  );
  await expect(log).not.toContainText('wasmbolt:/workspace $ opt ');
  await expect(log).not.toContainText('wasmbolt:/workspace $ llc ');
  const loadedPipelineWorker = requested.some(url =>
    /\/(opt|llc)\/[^/]+\.(js|wasm)$/.test(url)
  );
  expect(loadedPipelineWorker).toBe(false);
});

test('asset types, package encoding, and lazy MLIR loading', async ({
  page,
  request
}) => {
  const requested: string[] = [];
  page.on('request', req => requested.push(req.url()));
  await page.goto(standalone);
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByLabel('Assembly output')).toContainText('i32.mul');
  expect(requested.some(url => url.endsWith('.so'))).toBe(false);
  for (const [name, type] of [
    ['worker.js', /javascript/],
    ['Compiler.js', /javascript/],
    ['Compiler.wasm', /application\/wasm/],
    ['Compiler.data', /application\/octet-stream/],
    [xtensorArchive, /application\/gzip/]
  ] as const) {
    const response = await request.head(`${standalone}compiler/${name}`);
    expect(response.status(), name).toBe(200);
    expect(response.headers()['content-type'], name).toMatch(type);
    if (name.endsWith('.tar.gz')) {
      expect(response.headers()['content-encoding'], name).toBeUndefined();
    }
  }
});
