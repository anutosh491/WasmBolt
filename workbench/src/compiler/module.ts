import { asset, assets } from './assets';
import { isRecord } from './protocol';
import type { Info, Progress, Target } from './types';

export interface IFilesystem {
  mkdirTree(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  readFile(path: string, options: { encoding: 'utf8' }): string;
  chdir(path: string): void;
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  readdir(path: string): string[];
  unlink(path: string): void;
  rmdir(path: string): void;
}

interface IModule {
  FS: IFilesystem;
  loadDynamicLibrary(
    path: string,
    flags: { loadAsync: boolean; global: boolean; nodelete: boolean }
  ): Promise<unknown>;
  ccall(
    name: string,
    result: string,
    types: string[],
    args: unknown[]
  ): unknown;
}

interface IModuleOptions {
  locateFile(path: string): string;
  wasmBinary: Uint8Array;
  getPreloadedPackage(name: string, size: number): ArrayBuffer;
  stdout(byte: number): void;
  stderr(byte: number): void;
}

type Capture<T> = Readonly<{
  value: T;
  stdout: string;
  stderr: string;
}>;

type Call =
  | Readonly<{ status: 'success'; value: number }>
  | Readonly<{ status: 'failed'; message: string }>;

/** One Emscripten instance, owned exclusively by its worker. */
export interface IModuleRuntime {
  readonly info: Info;
  readonly fs: IFilesystem;
  run(command: string): Capture<number>;
  ensureMlir(onProgress: (progress: Progress) => void): Promise<void>;
  call(
    path: string,
    symbol: string,
    signatureCode: number,
    args: readonly number[]
  ): Capture<Call>;
}

/** Load the generated compiler without allowing a bundler to rewrite it. */
export async function initialize(
  base: string,
  onProgress: (progress: Progress) => void
): Promise<IModuleRuntime> {
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) {
    throw new Error(`Compiler manifest could not load (${response.status}).`);
  }
  const manifest: unknown = await response.json();
  if (
    !isRecord(manifest) ||
    manifest.format !== 1 ||
    typeof manifest.version !== 'string' ||
    typeof manifest.resourceDirectory !== 'string'
  ) {
    throw new Error('The compiler manifest is invalid.');
  }
  const url = new URL('Compiler.js', base).href;
  const [loader, { data, wasm }]: [
    unknown,
    { data: ArrayBuffer; wasm: ArrayBuffer }
  ] = await Promise.all([
    import(/* @vite-ignore */ url),
    assets(base, manifest.files, onProgress)
  ]);
  if (!isRecord(loader) || !isModuleFactory(loader.default)) {
    throw new Error('The compiler loader does not export a module factory.');
  }
  // LLVM flushes within diagnostic lines. Capture bytes instead of treating
  // Emscripten's print callbacks as complete lines.
  let stdout: number[] = [];
  let stderr: number[] = [];
  const decoder = new TextDecoder();
  const loaded: unknown = await loader.default({
    locateFile: file => new URL(file, base).href,
    wasmBinary: new Uint8Array(wasm),
    getPreloadedPackage: (name, size) => {
      if (!name.endsWith('Compiler.data') || size !== data.byteLength) {
        throw new Error('The compiler loader and data package do not match.');
      }
      return data;
    },
    stdout: byte => stdout.push(byte),
    stderr: byte => stderr.push(byte)
  });
  if (!isModule(loaded)) {
    throw new Error('The compiler runtime is missing required exports.');
  }
  const version = loaded.ccall('wasmbolt_version', 'string', [], []);
  const backends = loaded.ccall('available_targets', 'string', [], []);
  if (typeof version !== 'string' || typeof backends !== 'string') {
    throw new Error('The compiler did not report its capabilities.');
  }
  if (version !== `LLVM ${manifest.version}`) {
    throw new Error('The compiler version does not match its manifest.');
  }
  const supported: Target[] = [];
  const names = backends.toLowerCase().split(',');
  if (names.some(name => name.includes('wasm'))) {
    supported.push('wasm32-unknown-emscripten');
  }
  if (names.some(name => name.includes('x86'))) {
    supported.push('x86_64-unknown-linux-gnu');
  }
  if (names.some(name => name.includes('aarch64'))) {
    supported.push('aarch64-unknown-linux-gnu');
  }
  const info: Info = {
    version,
    targets: supported,
    resourceDirectory: manifest.resourceDirectory
  };

  let mlir: Promise<void> | null = null;
  function capture<T>(operation: () => T): Capture<T> {
    stdout = [];
    stderr = [];
    const value = operation();
    return {
      value,
      stdout: decoder.decode(Uint8Array.from(stdout)),
      stderr: decoder.decode(Uint8Array.from(stderr))
    };
  }
  return {
    info,
    fs: loaded.FS,
    run(command) {
      return capture(() => {
        const code = loaded.ccall(
          'run_command',
          'number',
          ['string'],
          [command]
        );
        if (typeof code !== 'number' || !Number.isInteger(code)) {
          throw new Error('The compiler returned an invalid exit status.');
        }
        return code;
      });
    },
    async ensureMlir(onProgress) {
      mlir ??= (async () => {
        const bytes = await asset(
          base,
          manifest.files,
          'WasmBoltMlirOpt.so',
          onProgress
        );
        loaded.FS.writeFile('/lib/WasmBoltMlirOpt.so', new Uint8Array(bytes));
        await loaded.loadDynamicLibrary('/lib/WasmBoltMlirOpt.so', {
          loadAsync: true,
          global: false,
          nodelete: true
        });
      })().catch(error => {
        mlir = null;
        throw error;
      });
      await mlir;
    },
    call(path, symbol, signatureCode, args) {
      return capture<Call>(() => {
        try {
          const value = loaded.ccall(
            'load_and_call_numeric',
            'number',
            ['string', 'string', 'number', 'number', 'number'],
            [path, symbol, signatureCode, args[0] ?? 0, args[1] ?? 0]
          );
          const error = loaded.ccall('wasmbolt_call_error', 'string', [], []);
          if (typeof error !== 'string' || typeof value !== 'number') {
            throw new Error('The runner returned an invalid result.');
          }
          return error
            ? { status: 'failed', message: error }
            : { status: 'success', value };
        } catch (error) {
          // Preserve bytes already written by a program that traps. Its
          // worker is discarded by the runner after this failure response.
          return { status: 'failed', message: String(error) };
        }
      });
    }
  };
}

function isModuleFactory(
  value: unknown
): value is (options: IModuleOptions) => Promise<unknown> {
  return typeof value === 'function';
}

function isModule(value: unknown): value is IModule {
  if (
    !isRecord(value) ||
    typeof value.ccall !== 'function' ||
    typeof value._wasmbolt_call_error !== 'function' ||
    typeof value.loadDynamicLibrary !== 'function' ||
    !isRecord(value.FS)
  ) {
    return false;
  }
  const fs = value.FS;
  return [
    'chdir',
    'stat',
    'isDir',
    'mkdirTree',
    'writeFile',
    'readFile',
    'readdir',
    'unlink',
    'rmdir'
  ].every(name => typeof fs[name] === 'function');
}
