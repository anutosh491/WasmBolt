import {
  loadCapabilities,
  manifestCapabilities,
  threadedRuntimeSupport
} from '../compiler/capabilities';
import { initial, snapshot } from '../model';
import { session } from '../persistence';

const asset = {
  bytes: 1,
  sha256: '0'.repeat(64)
};

const manifest = {
  format: 1,
  clangdOrigin: 'source',
  clangdThreaded: true,
  debuggerOrigin: 'source',
  files: {
    'clangd-worker.js': asset,
    'clangd/clangd.js': asset,
    'clangd/clangd.wasm.gz': asset,
    'debug-worker.js': asset,
    'lldb-dap/lldb-dap.js': asset,
    'lldb-dap/lldb-dap.wasm': asset,
    'lldb-dap/lldb-dap.worker.js': asset
  }
};

afterEach(() => jest.restoreAllMocks());

it('enables only complete source-built optional runtime groups', () => {
  expect(manifestCapabilities(manifest)).toEqual({
    clangd: true,
    debugger: true
  });
  expect(
    manifestCapabilities({
      ...manifest,
      files: {
        ...manifest.files,
        'clangd/clangd.wasm.gz': undefined,
        'lldb-dap/lldb-dap.worker.js': undefined
      }
    })
  ).toEqual({ clangd: false, debugger: false });
  expect(
    manifestCapabilities({ ...manifest, debuggerOrigin: 'experimental' })
  ).toEqual({ clangd: true, debugger: false });
});

it('keeps manifest failure independent from core compiler startup', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  await expect(
    loadCapabilities(new URL('https://example.test/compiler/worker.js'))
  ).resolves.toEqual({ clangd: false, debugger: false });
});

it('requires browser isolation and shared memory for threaded services', () => {
  expect(threadedRuntimeSupport(true, true)).toBe(true);
  expect(threadedRuntimeSupport(false, true)).toBe(false);
  expect(threadedRuntimeSupport(true, false)).toBe(false);
});

it('accepts a saved layout without the optional debugger pane', () => {
  const value = snapshot(initial());
  const layout = {
    type: 'tab-area' as const,
    widgets: [
      'explorer',
      'source',
      'outputs',
      'diagnostics',
      'terminal',
      'run',
      'pipelines'
    ] as const,
    currentIndex: 0
  };
  expect(session({ ...value, layout })?.layout).toEqual(layout);
});
