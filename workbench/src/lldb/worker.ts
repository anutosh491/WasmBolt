import { asset } from '../compiler/assets';
import { restore } from '../compiler/files';
import type { IFilesystem } from '../compiler/module';
import { isRecord } from '../compiler/protocol';
import type { Progress } from '../compiler/types';
import { isLldbInput, lldbInvocation } from './protocol';
import type { LldbInput, LldbOutput } from './protocol';

type LldbModule = Readonly<{
  FS: IFilesystem;
  callMain(args: readonly string[]): unknown;
  ccall(
    name: string,
    result: string,
    argumentTypes: readonly string[],
    arguments_: readonly string[]
  ): unknown;
}>;

type LldbFactory = (options: Record<string, unknown>) => Promise<LldbModule>;

const scope: DedicatedWorkerGlobalScope = self;
let running = false;

scope.addEventListener('message', event => {
  const value: unknown = event.data;
  const id =
    isRecord(value) && Number.isSafeInteger(value.id) ? Number(value.id) : 0;
  if (!isLldbInput(value)) {
    reply({ kind: 'error', id, message: 'Invalid LLDB request.' });
    return;
  }
  if (running) {
    reply({ kind: 'error', id, message: 'This LLDB worker is busy.' });
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

async function run(input: LldbInput): Promise<void> {
  const invocation = lldbInvocation(input.request.command);
  if (!input.request.files.some(file => file.path === invocation.target)) {
    throw new Error(`${invocation.target} is not in the workspace.`);
  }
  const progress = (value: Progress) =>
    reply({ kind: 'progress', id: input.id, progress: value });
  const response = await fetch(new URL('manifest.json', input.base));
  if (!response.ok) {
    throw new Error(`Compiler manifest could not load (${response.status}).`);
  }
  const manifest: unknown = await response.json();
  if (
    !isRecord(manifest) ||
    manifest.format !== 1 ||
    manifest.lldbOrigin !== 'source' ||
    typeof manifest.revision !== 'string'
  ) {
    throw new Error('The LLDB manifest is invalid or not source-built.');
  }
  const [loader, wasm]: [unknown, ArrayBuffer] = await Promise.all([
    import(/* @vite-ignore */ new URL('lldb/lldb.js', input.base).href),
    asset(input.base, manifest.files, 'lldb/lldb.wasm', progress)
  ]);
  if (!isRecord(loader) || typeof loader.default !== 'function') {
    throw new Error('The LLDB loader has no module factory.');
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  const start = performance.now();
  progress({ phase: 'working', stage: 'lldb' });
  const compiled = await WebAssembly.compile(wasm);
  const module = await (loader.default as LldbFactory)({
    noInitialRun: true,
    locateFile: (path: string) =>
      path.endsWith('.wasm')
        ? new URL('lldb/lldb.wasm', input.base).href
        : new URL(`lldb/${path}`, input.base).href,
    wasmBinary: new Uint8Array(wasm),
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receive: (
        instance: WebAssembly.Instance,
        module: WebAssembly.Module
      ) => void
    ) => {
      void WebAssembly.instantiate(compiled, imports).then(instance =>
        receive(instance, compiled)
      );
      return {};
    },
    print: (line: unknown) => stdout.push(String(line)),
    printErr: (line: unknown) => {
      const text = String(line);
      if (!/^\[(?:LLDB|WAMR|RSP)(?:\/| )/.test(text)) {
        stderr.push(text);
      }
    }
  });
  restore(module.FS, input.request.files);
  const status = Number(module.callMain([invocation.target])) || 0;
  if (status === 0) {
    for (const command of invocation.commands) {
      const output = module.ccall(
        'wasmbolt_lldb_command',
        'string',
        ['string'],
        [command]
      );
      if (typeof output === 'string' && output) {
        stdout.push(output.replace(/\n$/, ''));
      }
    }
  }
  reply({
    kind: 'result',
    id: input.id,
    result: {
      id: input.request.id,
      files: input.request.files,
      stage: {
        name: 'lldb',
        status: status === 0 ? 'success' : 'failed',
        commands: [input.request.command],
        diagnostics: [],
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        exitCode: status,
        duration: performance.now() - start
      }
    }
  });
}

function reply(output: LldbOutput): void {
  scope.postMessage(output);
}
