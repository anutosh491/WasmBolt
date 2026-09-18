import { asset } from './assets';
import { files, restore } from './files';
import type { IFilesystem } from './module';
import { isRecord } from './protocol';
import { isUtilityInput } from './utility';
import type { UtilityOutput } from './utility';
import type { Progress } from './types';

interface IUtilityModule {
  FS: IFilesystem;
}

interface IUtilityOptions {
  arguments: readonly string[];
  wasmBinary: Uint8Array;
  locateFile(path: string): string;
  preRun: readonly ((module: IUtilityModule) => void)[];
  print(line: string): void;
  printErr(line: string): void;
  onExit(status: number): void;
}

function reply(output: UtilityOutput): void {
  const buffers =
    output.kind === 'result'
      ? output.files.map(file => file.data.buffer).filter(isArrayBuffer)
      : [];
  self.postMessage(output, { transfer: buffers });
}

self.addEventListener('message', async (event: MessageEvent<unknown>) => {
  const input = event.data;
  if (!isUtilityInput(input)) {
    throw new Error('Invalid LLVM utility request.');
  }
  const progress = (progress: Progress) =>
    reply({ kind: 'progress', id: input.id, progress });
  const start = performance.now();
  let module: IUtilityModule | null = null;
  let exitCode: number | null = null;
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const manifestResponse = await fetch(new URL('manifest.json', input.base));
    if (!manifestResponse.ok) {
      throw new Error(
        `Compiler manifest could not load (${manifestResponse.status}).`
      );
    }
    const manifest: unknown = await manifestResponse.json();
    if (!isRecord(manifest)) {
      throw new Error('The compiler manifest is invalid.');
    }
    const loaderUrl = new URL('llvm/llvm.js', input.base).href;
    const [loader, wasm]: [unknown, ArrayBuffer] = await Promise.all([
      import(/* @vite-ignore */ loaderUrl),
      asset(input.base, manifest.files, 'llvm/llvm.wasm', progress)
    ]);
    if (!isRecord(loader) || typeof loader.default !== 'function') {
      throw new Error('The LLVM utility loader is invalid.');
    }
    try {
      await loader.default({
        arguments: input.args,
        wasmBinary: new Uint8Array(wasm),
        locateFile: path => new URL(`llvm/${path}`, input.base).href,
        preRun: [
          (instance: IUtilityModule) => {
            module = instance;
            restore(instance.FS, input.request.files);
          }
        ],
        print: line => stdout.push(String(line)),
        printErr: line => stderr.push(String(line)),
        onExit: status => {
          exitCode = status;
        }
      } satisfies IUtilityOptions);
    } catch (error) {
      if (exitCode === null) {
        throw error;
      }
    }
    const initialized = module as IUtilityModule | null;
    if (!initialized) {
      throw new Error('The LLVM utility did not initialize its filesystem.');
    }
    const out = stdout.join('\n');
    const err = stderr.join('\n');
    if (input.stdout) {
      initialized.FS.writeFile(input.stdout, out);
    }
    if (input.stderr) {
      initialized.FS.writeFile(input.stderr, err);
    }
    reply({
      kind: 'result',
      id: input.id,
      files: files(initialized.FS),
      stdout: out,
      stderr: err,
      exitCode: exitCode ?? 0,
      duration: performance.now() - start
    });
  } catch (error) {
    reply({
      kind: 'error',
      id: input.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function isArrayBuffer(value: ArrayBufferLike): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}
