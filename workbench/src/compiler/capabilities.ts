import { isRecord } from './protocol';

export type Capabilities = Readonly<{
  clangd: boolean;
  debugger: boolean;
}>;

const unavailable: Capabilities = {
  clangd: false,
  debugger: false
};

/** Threaded Wasm needs both shared memory and cross-origin isolation. */
export function threadedRuntimeSupport(
  isolated = globalThis.crossOriginIsolated === true,
  sharedMemory = typeof globalThis.SharedArrayBuffer === 'function'
): boolean {
  return isolated && sharedMemory;
}

/** Read optional runtime availability without making it a core dependency. */
export async function loadCapabilities(workerUrl: URL): Promise<Capabilities> {
  try {
    const response = await fetch(new URL('manifest.json', workerUrl), {
      cache: 'no-store'
    });
    if (!response.ok) {
      return unavailable;
    }
    return manifestCapabilities(await response.json());
  } catch {
    return unavailable;
  }
}

/** Treat a capability as available only when every packaged asset is valid. */
export function manifestCapabilities(manifest: unknown): Capabilities {
  if (!isRecord(manifest) || manifest.format !== 1) {
    return unavailable;
  }
  const files = manifest.files;
  return {
    clangd:
      manifest.clangdOrigin === 'source' &&
      manifest.clangdThreaded === true &&
      hasAssets(files, [
        'clangd-worker.js',
        'clangd/clangd.js',
        'clangd/clangd.wasm.gz'
      ]),
    debugger:
      manifest.debuggerOrigin === 'source' &&
      hasAssets(files, [
        'debug-worker.js',
        'lldb-dap/lldb-dap.js',
        'lldb-dap/lldb-dap.wasm',
        'lldb-dap/lldb-dap.worker.js'
      ])
  };
}

function hasAssets(files: unknown, names: readonly string[]): boolean {
  return (
    isRecord(files) &&
    names.every(name => {
      const entry = files[name];
      return (
        isRecord(entry) &&
        typeof entry.bytes === 'number' &&
        Number.isSafeInteger(entry.bytes) &&
        entry.bytes > 0 &&
        typeof entry.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(entry.sha256)
      );
    })
  );
}
