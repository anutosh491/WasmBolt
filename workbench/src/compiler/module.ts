import { assetGroup, assets } from './assets';
import type { CallSignature } from './execution';
import { installPackages } from './packages';
import type { PipelineTool } from './pipeline';
import { isRecord } from './protocol';
import { isTarget } from './types';
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
  getWasmTableEntry(index: number): (...args: number[]) => unknown;
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
  readonly isolatedTools: readonly PipelineTool[];
  prepareDebugSysroot(onProgress: (progress: Progress) => void): Promise<void>;
  run(args: readonly string[]): Capture<number>;
  call(
    path: string,
    symbol: string,
    signature: CallSignature,
    args: readonly number[]
  ): Capture<Call>;
}

/** Load the generated compiler without allowing a bundler to rewrite it. */
export async function initialize(
  base: string,
  onProgress: (progress: Progress) => void
): Promise<IModuleRuntime> {
  const response = await fetch(new URL('manifest.json', base), {
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error(`Compiler manifest could not load (${response.status}).`);
  }
  const manifest: unknown = await response.json();
  if (
    !isRecord(manifest) ||
    manifest.format !== 1 ||
    typeof manifest.version !== 'string' ||
    typeof manifest.emscripten !== 'string' ||
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
  await installPackages(base, manifest.files, loaded.FS, onProgress);
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
  const pipelineAvailable =
    manifest.pipelineOrigin !== undefined &&
    hasAssets(manifest.files, [
      'opt/opt.js',
      'opt/opt.wasm',
      'llc/llc.js',
      'llc/llc.wasm'
    ]);
  if (
    pipelineAvailable &&
    Array.isArray(manifest.pipelineTargets) &&
    manifest.pipelineTargets.every(isTarget)
  ) {
    for (const target of manifest.pipelineTargets) {
      if (!supported.includes(target)) {
        supported.push(target);
      }
    }
  }
  const info: Info = {
    version,
    targets: supported,
    resourceDirectory: manifest.resourceDirectory
  };
  const isolatedTools: PipelineTool[] = [];
  if (pipelineAvailable) {
    isolatedTools.push('opt', 'llc');
  }
  if (
    manifest.mlirOrigin !== undefined &&
    hasAssets(manifest.files, [
      'mlir/mlir-opt.js',
      'mlir/mlir-opt.wasm',
      'mlir/mlir-translate.js',
      'mlir/mlir-translate.wasm'
    ])
  ) {
    isolatedTools.push('mlir-opt', 'mlir-translate');
  }
  const debugSysrootNames = [
    'crt1.o',
    'libGL-getprocaddr.a',
    'libal.a',
    'libhtml5.a',
    'libstandalonewasm-nocatch.a',
    'libstubs-debug.a',
    'libc-debug.a',
    'libdlmalloc-debug.a',
    'libcompiler_rt.a',
    'libc++-noexcept.a',
    'libc++abi-debug-noexcept.a',
    'libsockets.a'
  ];
  const debugSysrootAssets = debugSysrootNames.map(
    name => `debug-sysroot/${name}`
  );
  const debugSysrootAvailable =
    manifest.debugSysrootOrigin !== undefined &&
    manifest.debugSysrootEmscripten === manifest.emscripten &&
    hasAssets(manifest.files, debugSysrootAssets);
  let debugSysroot: Promise<void> | null = null;

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
    isolatedTools,
    prepareDebugSysroot(onProgress) {
      if (!debugSysrootAvailable) {
        return Promise.reject(
          new Error('The matching Emscripten debug runtime is unavailable.')
        );
      }
      if (!debugSysroot) {
        debugSysroot = assetGroup(
          base,
          manifest.files,
          debugSysrootAssets,
          onProgress
        ).then(buffers => {
          const directory = '/lib/wasm32-emscripten';
          loaded.FS.mkdirTree(directory);
          buffers.forEach((buffer, index) => {
            loaded.FS.writeFile(
              `${directory}/${debugSysrootNames[index]}`,
              new Uint8Array(buffer)
            );
          });
        });
        void debugSysroot.catch(() => {
          debugSysroot = null;
        });
      }
      return debugSysroot;
    },
    run(args) {
      return capture(() => {
        const encoded = packArguments(args);
        const code = loaded.ccall(
          'run_tool',
          'number',
          ['array', 'number'],
          [encoded, encoded.byteLength]
        );
        if (typeof code !== 'number' || !Number.isInteger(code)) {
          throw new Error('The compiler returned an invalid exit status.');
        }
        const canRunAgain = loaded.ccall(
          'wasmbolt_can_run_again',
          'number',
          [],
          []
        );
        if (canRunAgain !== 1) {
          throw new Error(
            'The linker cannot safely run again; restart its compiler worker.'
          );
        }
        return code;
      });
    },
    call(path, symbol, signature, args) {
      return capture<Call>(() => {
        try {
          const address = loaded.ccall(
            'resolve_symbol',
            'number',
            ['string', 'string'],
            [path, symbol]
          );
          const error = loaded.ccall('wasmbolt_call_error', 'string', [], []);
          if (typeof error !== 'string' || typeof address !== 'number') {
            throw new Error('The runner returned an invalid result.');
          }
          if (error) {
            return { status: 'failed', message: error };
          }
          const fn = loaded.getWasmTableEntry(address);
          if (typeof fn !== 'function') {
            throw new Error('The resolved symbol is not callable.');
          }
          const value = fn(
            ...args.map((arg, index) =>
              signature.params[index] === 'i32' ? arg | 0 : arg
            )
          );
          if (signature.results.length === 0) {
            return { status: 'success', value: 0 };
          }
          if (typeof value !== 'number') {
            throw new Error('The function returned an invalid scalar value.');
          }
          return { status: 'success', value };
        } catch (error) {
          // Preserve bytes already written by a program that traps. Its
          // worker is discarded by the runner after this failure response.
          return { status: 'failed', message: String(error) };
        }
      });
    }
  };
}

function hasAssets(files: unknown, names: readonly string[]): boolean {
  return isRecord(files) && names.every(name => isRecord(files[name]));
}

function isModuleFactory(
  value: unknown
): value is (options: IModuleOptions) => Promise<unknown> {
  return typeof value === 'function';
}

function packArguments(args: readonly string[]): Uint8Array {
  if (args.length === 0 || args.some(arg => arg.includes('\0'))) {
    throw new Error('A tool invocation requires non-null argv strings.');
  }
  const encoder = new TextEncoder();
  const encoded = args.map(arg => encoder.encode(arg));
  const packed = new Uint8Array(
    encoded.reduce((size, arg) => size + arg.byteLength + 1, 0)
  );
  let offset = 0;
  for (const arg of encoded) {
    packed.set(arg, offset);
    offset += arg.byteLength + 1;
  }
  return packed;
}

function isModule(value: unknown): value is IModule {
  if (
    !isRecord(value) ||
    typeof value.ccall !== 'function' ||
    typeof value._wasmbolt_call_error !== 'function' ||
    typeof value._wasmbolt_can_run_again !== 'function' ||
    typeof value._resolve_symbol !== 'function' ||
    typeof value.getWasmTableEntry !== 'function' ||
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
