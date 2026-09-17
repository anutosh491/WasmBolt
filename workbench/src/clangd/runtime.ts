import { asset } from '../compiler/assets';
import { isRecord } from '../compiler/protocol';
import { isClangdInput } from './protocol';
import type { ClangdInput, ClangdOutput, JsonRpcMessage } from './protocol';

type EmscriptenFileSystem = Readonly<{
  mkdirTree(path: string): void;
  writeFile(path: string, contents: string): void;
}>;

type ClangdModule = Readonly<{
  FS: EmscriptenFileSystem;
  callMain(args: readonly string[]): unknown;
}>;

type ClangdFactory = (
  options: Record<string, unknown>
) => Promise<ClangdModule>;

export interface IClangdWorkerScope {
  location: WorkerLocation;
  postMessage(message: ClangdOutput): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ): void;
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function parent(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '/workspace';
}

function workspacePath(path: string): boolean {
  return (
    path.startsWith('/workspace/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path
      .slice('/workspace/'.length)
      .split('/')
      .some(part => !part || part === '.' || part === '..')
  );
}

/** Installs the clangd runtime protocol in a dedicated module Worker. */
export function installClangdWorker(scope: IClangdWorkerScope): void {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stdin: number[] = [];
  let stdinReady: (() => void) | null = null;
  let stdout: number[] = [];
  let expected: number | null = null;
  let stderr = '';
  let module: ClangdModule | null = null;
  let loading: Promise<void> | null = null;

  function post(output: ClangdOutput): void {
    scope.postMessage(output);
  }

  function writeLsp(value: JsonRpcMessage): void {
    const body = encoder.encode(JSON.stringify(value));
    const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
    stdin.push(...header, ...body);
    stdinReady?.();
    stdinReady = null;
  }

  function readStdin(): number | null {
    return stdin.shift() ?? null;
  }

  function waitForStdin(): Promise<void> {
    if (stdin.length) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      stdinReady = resolve;
    });
  }

  function headerEnd(bytes: readonly number[]): number {
    for (let index = 0; index <= bytes.length - 4; index += 1) {
      if (
        bytes[index] === 13 &&
        bytes[index + 1] === 10 &&
        bytes[index + 2] === 13 &&
        bytes[index + 3] === 10
      ) {
        return index;
      }
    }
    return -1;
  }

  function readStdout(character: number): void {
    stdout.push(character);
    while (true) {
      if (expected === null) {
        const end = headerEnd(stdout);
        if (end < 0) {
          return;
        }
        const header = decoder.decode(new Uint8Array(stdout.slice(0, end)));
        const length = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
        stdout = stdout.slice(end + 4);
        if (!length) {
          continue;
        }
        expected = Number(length[1]);
      }
      if (stdout.length < expected) {
        return;
      }
      const body = stdout.slice(0, expected);
      stdout = stdout.slice(expected);
      expected = null;
      try {
        post({
          kind: 'lsp',
          message: JSON.parse(
            decoder.decode(new Uint8Array(body))
          ) as JsonRpcMessage
        });
      } catch (reason) {
        post({
          kind: 'error',
          message: `Invalid clangd response: ${message(reason)}`
        });
      }
    }
  }

  function readStderr(character: number): void {
    if (character === 10) {
      if (stderr && /error|failed|abort/i.test(stderr)) {
        post({ kind: 'log', message: stderr });
      }
      stderr = '';
      return;
    }
    stderr += String.fromCharCode(character);
  }

  async function decompress(compressed: ArrayBuffer): Promise<string> {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress the clangd runtime.');
    }
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const wasm = await new Response(stream).arrayBuffer();
    return URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
  }

  async function start(base: string): Promise<void> {
    const runtimeBase = new URL(base, scope.location.href);
    const root = new URL('../', runtimeBase);
    const response = await fetch(new URL('manifest.json', root));
    if (!response.ok) {
      throw new Error(`clangd manifest could not load (${response.status}).`);
    }
    const manifest: unknown = await response.json();
    if (
      !isRecord(manifest) ||
      manifest.format !== 1 ||
      manifest.clangdOrigin !== 'source' ||
      typeof manifest.version !== 'string' ||
      typeof manifest.revision !== 'string'
    ) {
      throw new Error('The clangd manifest is invalid or not source-built.');
    }
    const compressed = await asset(
      root.href,
      manifest.files,
      'clangd/clangd.wasm.gz',
      progress => {
        if (progress.phase === 'downloading') {
          const download = progress.downloads[0];
          if (download) {
            post({
              kind: 'progress',
              loaded: download.loaded,
              total: download.total
            });
          }
        }
      }
    );
    const wasm = await decompress(compressed);
    const imported = (await import(
      /* @vite-ignore */ new URL('clangd.js', runtimeBase).href
    )) as { default?: ClangdFactory };
    if (!imported.default) {
      throw new Error('The clangd runtime does not export a module factory.');
    }
    module = await imported.default({
      thisProgram: '/usr/bin/clangd',
      locateFile: (path: string) =>
        path.endsWith('.wasm') ? wasm : new URL(path, runtimeBase).href,
      stdin: readStdin,
      stdinReady: waitForStdin,
      stdout: readStdout,
      stderr: readStderr,
      onAbort: (reason: unknown) =>
        post({ kind: 'error', message: `clangd aborted: ${message(reason)}` })
    });
    module.FS.mkdirTree('/workspace');
    module.FS.writeFile(
      '/workspace/.clangd',
      [
        'CompileFlags:',
        '  Add:',
        '    - --target=wasm32-unknown-emscripten',
        '    - -std=c++23',
        '    - -nostdinc',
        `    - -resource-dir=/lib/clang/${manifest.version.split('.')[0]}`,
        '    - -isystem/include/wasm32-emscripten/c++/v1',
        '    - -isystem/include/c++/v1',
        `    - -isystem/lib/clang/${manifest.version.split('.')[0]}/include`,
        '    - -isystem/include/wasm32-emscripten',
        '    - -isystem/include'
      ].join('\n')
    );
    const execution = module.callMain([
      '--background-index=false',
      '--clang-tidy=false',
      '--log=error'
    ]);
    if (execution instanceof Promise) {
      void execution.catch(reason =>
        post({ kind: 'error', message: `clangd failed: ${message(reason)}` })
      );
    }
    post({ kind: 'ready' });
  }

  function receive(input: ClangdInput): void {
    if (input.kind === 'start') {
      if (!loading) {
        loading = start(input.base).catch(reason => {
          post({ kind: 'error', message: message(reason) });
          loading = null;
        });
      }
      return;
    }
    if (input.kind === 'lsp') {
      writeLsp(input.message);
      return;
    }
    if (!module || !workspacePath(input.path)) {
      post({ kind: 'error', message: `Invalid workspace path: ${input.path}` });
      return;
    }
    module.FS.mkdirTree(parent(input.path));
    module.FS.writeFile(input.path, input.contents);
  }

  scope.addEventListener('message', event => {
    if (!isClangdInput(event.data)) {
      post({ kind: 'error', message: 'Invalid clangd worker request.' });
      return;
    }
    receive(event.data);
  });
}
