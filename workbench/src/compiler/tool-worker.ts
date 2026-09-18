import { asset } from './assets';
import { diagnostics } from './diagnostics';
import { files, restore } from './files';
import type { IFilesystem } from './module';
import { isRecord } from './protocol';
import type { Progress } from './types';
import type { ToolInput, ToolOutput } from './tool-protocol';
import { isToolInput, requestArgv, requestCommand } from './tool-protocol';

interface IToolModule {
  FS: IFilesystem;
  callMain(args: readonly string[]): unknown;
}

interface IToolOptions {
  noInitialRun: boolean;
  thisProgram: string;
  locateFile(path: string): string;
  wasmBinary: Uint8Array;
  print(line: string): void;
  printErr(line: string): void;
}

type ToolFactory = (options: IToolOptions) => Promise<unknown>;

const scope: DedicatedWorkerGlobalScope = self;
let running = false;

scope.addEventListener('message', event => {
  const value: unknown = event.data;
  const id =
    isRecord(value) && Number.isSafeInteger(value.id) ? Number(value.id) : 0;
  if (!isToolInput(value)) {
    reply({ kind: 'error', id, message: 'Invalid isolated-tool request.' });
    return;
  }
  if (running) {
    reply({ kind: 'error', id, message: 'This tool worker is busy.' });
    return;
  }
  running = true;
  void run(value).catch(error => {
    reply({
      kind: 'error',
      id: value.id,
      message: error instanceof Error ? error.message : String(error)
    });
  });
});

async function run(input: ToolInput): Promise<void> {
  const { request, runtime } = input;
  const argv = requestArgv(request);
  const progress = (value: Progress) => {
    reply({ kind: 'progress', id: input.id, progress: value });
  };
  const response = await fetch(
    new URL(runtime.manifest ?? 'manifest.json', input.base)
  );
  if (!response.ok) {
    throw new Error(`Tool manifest could not load (${response.status}).`);
  }
  const manifest: unknown = await response.json();
  if (!isRecord(manifest) || manifest.format !== 1) {
    throw new Error('The tool manifest is invalid.');
  }
  const loaderUrl = new URL(runtime.loader, input.base).href;
  const [loader, wasm]: [unknown, ArrayBuffer] = await Promise.all([
    import(/* @vite-ignore */ loaderUrl),
    asset(input.base, manifest.files, runtime.wasm, progress)
  ]);
  if (!isRecord(loader) || !isFactory(loader.default)) {
    throw new Error(`${runtime.name} has no Emscripten module factory.`);
  }

  let module: IToolModule | null = null;
  let exitCode = 0;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const start = performance.now();
  progress({ phase: 'working', stage: runtime.name });
  try {
    const loaded: unknown = await loader.default({
      noInitialRun: true,
      thisProgram: argv[0],
      locateFile: path => new URL(path, input.base).href,
      wasmBinary: new Uint8Array(wasm),
      print: line => stdout.push(String(line)),
      printErr: line => stderr.push(String(line))
    });
    if (!isModule(loaded)) {
      throw new Error(`${runtime.name} filesystem is unavailable.`);
    }
    module = loaded;
    restore(module.FS, request.files);
    exitCode = Number(module.callMain(argv.slice(1))) || 0;
  } catch (error) {
    if (!isExit(error)) {
      throw error;
    }
    exitCode = error.status;
  }
  if (!module) {
    throw new Error(`${runtime.name} did not initialize its filesystem.`);
  }
  const snapshot = files(module.FS).map(file => ({
    path: file.path,
    data: file.data.slice()
  }));
  const errorText = stderr.join('\n');
  reply(
    {
      kind: 'result',
      id: input.id,
      result: {
        id: request.id,
        files: snapshot,
        stage: {
          name: runtime.name,
          status: exitCode === 0 ? 'success' : 'failed',
          commands: [requestCommand(request)],
          diagnostics: diagnostics(errorText),
          stdout: stdout.join('\n'),
          stderr: errorText,
          exitCode,
          duration: performance.now() - start
        }
      }
    },
    snapshot
      .map(file => file.data.buffer)
      .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
  );
}

function isFactory(value: unknown): value is ToolFactory {
  return typeof value === 'function';
}

function isModule(value: unknown): value is IToolModule {
  if (
    !isRecord(value) ||
    !isRecord(value.FS) ||
    typeof value.callMain !== 'function'
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

function isExit(value: unknown): value is { status: number } {
  return (
    isRecord(value) &&
    value.name === 'ExitStatus' &&
    Number.isSafeInteger(value.status)
  );
}

function reply(output: ToolOutput, transfer: Transferable[] = []): void {
  scope.postMessage(output, transfer);
}
