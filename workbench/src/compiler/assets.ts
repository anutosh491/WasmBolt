import { isRecord } from './protocol';
import type { Download, Progress } from './types';

type Asset = Readonly<{ name: string; bytes: number; sha256: string }>;

/** Stream both large assets, then verify them before the runtime uses them. */
export async function assets(
  base: string,
  files: unknown,
  onProgress: (progress: Progress) => void
): Promise<{ data: ArrayBuffer; wasm: ArrayBuffer }> {
  const [data, wasm] = await loadAssets(
    base,
    files,
    ['Compiler.data', 'Compiler.wasm'],
    onProgress
  );
  return { data, wasm };
}

/** Optional drivers have the same integrity and progress contract as core. */
export async function asset(
  base: string,
  files: unknown,
  name: string,
  onProgress: (progress: Progress) => void
): Promise<ArrayBuffer> {
  return (await loadAssets(base, files, [name], onProgress))[0];
}

/** Load one optional runtime group as one verified operation. */
export async function assetGroup(
  base: string,
  files: unknown,
  names: readonly string[],
  onProgress: (progress: Progress) => void
): Promise<readonly ArrayBuffer[]> {
  return loadAssets(base, files, names, onProgress);
}

async function loadAssets(
  base: string,
  files: unknown,
  names: readonly string[],
  onProgress: (progress: Progress) => void
): Promise<ArrayBuffer[]> {
  if (!crypto.subtle) {
    throw new Error('Compiler verification requires HTTPS or localhost.');
  }
  const entries = names.map(name => {
    const entry = isRecord(files) ? files[name] : null;
    if (
      !isRecord(entry) ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      typeof entry.bytes !== 'number' ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0
    ) {
      throw new Error(`The manifest does not describe ${name}.`);
    }
    return { name, bytes: entry.bytes, sha256: entry.sha256 };
  });
  let downloads: readonly Download[] = entries.map(entry => ({
    name: entry.name,
    loaded: 0,
    total: entry.bytes
  }));
  onProgress({ phase: 'downloading', downloads });
  const controller = new AbortController();
  let reported = -Infinity;
  try {
    const buffers = await Promise.all(
      entries.map((entry, index) =>
        download(entry, base, controller.signal, loaded => {
          if (controller.signal.aborted) {
            return;
          }
          downloads = downloads.map((download, i) =>
            i === index ? { ...download, loaded } : download
          );
          const now = performance.now();
          // Bound UI updates without owning a timer or losing completion.
          if (now - reported >= 100 || loaded === entry.bytes) {
            reported = now;
            onProgress({ phase: 'downloading', downloads });
          }
        })
      )
    );
    onProgress({ phase: 'preparing' });
    // Fetch integrity buffers the whole response before exposing its body.
    // Verify explicitly so download progress reflects bytes as they arrive.
    await Promise.all(
      entries.map(async (entry, index) => {
        const digest = await crypto.subtle.digest('SHA-256', buffers[index]);
        const hash = Array.from(new Uint8Array(digest), byte =>
          byte.toString(16).padStart(2, '0')
        ).join('');
        if (hash !== entry.sha256) {
          throw new Error(`${entry.name} failed integrity verification.`);
        }
      })
    );
    return buffers;
  } finally {
    // A failed asset must not leave its sibling downloading in the worker.
    controller.abort();
  }
}

async function download(
  entry: Asset,
  base: string,
  signal: AbortSignal,
  onProgress: (loaded: number) => void
): Promise<ArrayBuffer> {
  try {
    const url = new URL(entry.name, base);
    url.searchParams.set('sha256', entry.sha256);
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('The response has no body.');
    }
    const bytes = new Uint8Array(entry.bytes);
    const reader = response.body.getReader();
    let loaded = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (loaded + value.byteLength > entry.bytes) {
          throw new Error('The file exceeds its manifest size.');
        }
        bytes.set(value, loaded);
        loaded += value.byteLength;
        onProgress(loaded);
      }
    } finally {
      reader.releaseLock();
    }
    if (loaded !== entry.bytes) {
      throw new Error('The file size does not match its manifest.');
    }
    return bytes.buffer;
  } catch (error) {
    throw new Error(`${entry.name} could not load: ${String(error)}`);
  }
}
