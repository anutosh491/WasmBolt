const runtimeBase = new URL('../../../compiler/clangd/', import.meta.url);
postMessage({ kind: 'progress', stage: 'importing clangd.js' });
const factory = (await import(new URL('clangd.js', runtimeBase))).default;
postMessage({ kind: 'progress', stage: 'imported clangd.js' });

const input = [];
let wake = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let output = [];
let expected = null;

async function decompress(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`clangd Wasm failed to load (${response.status})`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the clangd runtime');
  }
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  return URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
}

function stdin() {
  return input.shift() ?? null;
}

function stdinReady() {
  if (input.length) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    wake = resolve;
  });
}

function headerEnd(bytes) {
  for (let index = 0; index + 3 < bytes.length; index += 1) {
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

function stdout(byte) {
  output.push(byte);
  for (;;) {
    if (expected === null) {
      const end = headerEnd(output);
      if (end < 0) {
        return;
      }
      const header = decoder.decode(new Uint8Array(output.slice(0, end)));
      output = output.slice(end + 4);
      const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!match) {
        continue;
      }
      expected = Number(match[1]);
    }
    if (output.length < expected) {
      return;
    }
    const body = output.slice(0, expected);
    output = output.slice(expected);
    expected = null;
    postMessage({
      kind: 'lsp',
      message: JSON.parse(decoder.decode(new Uint8Array(body)))
    });
  }
}

let stderrLine = '';
function stderr(byte) {
  if (byte === 10) {
    if (stderrLine) {
      postMessage({ kind: 'stderr', message: stderrLine });
    }
    stderrLine = '';
    return;
  }
  stderrLine += String.fromCharCode(byte);
}

postMessage({ kind: 'progress', stage: 'decompressing clangd.wasm.gz' });
const wasm = await decompress(new URL('clangd.wasm.gz', runtimeBase));
postMessage({ kind: 'progress', stage: 'instantiating clangd' });
const module = await factory({
  thisProgram: '/usr/bin/clangd',
  locateFile(path) {
    return path.endsWith('.wasm') ? wasm : new URL(path, runtimeBase).href;
  },
  stdin,
  stdinReady,
  stdout,
  stderr,
  onAbort(reason) {
    postMessage({
      kind: 'error',
      message: `clangd aborted: ${String(reason)}`
    });
  }
});
postMessage({ kind: 'progress', stage: 'clangd instantiated' });

module.FS.mkdirTree('/workspace');
module.FS.writeFile(
  '/workspace/.clangd',
  [
    'CompileFlags:',
    '  Add:',
    '    - --target=wasm32-unknown-emscripten',
    '    - -std=c++23',
    '    - -nostdinc',
    '    - -resource-dir=/lib/clang/23',
    '    - -isystem/include/c++/v1',
    '    - -isystem/include/compat',
    '    - -isystem/include',
    '    - -Wno-unknown-warning-option',
    'Index:',
    '  StandardLibrary: false'
  ].join('\n')
);

postMessage({ kind: 'progress', stage: 'starting clangd main' });
const execution = module.callMain([
  '--background-index=false',
  '--clang-tidy=false',
  '--log=error'
]);
postMessage({ kind: 'progress', stage: 'clangd main yielded' });
if (execution instanceof Promise) {
  execution.catch(reason => {
    postMessage({ kind: 'error', message: `clangd failed: ${String(reason)}` });
  });
}

onmessage = event => {
  if (event.data?.kind === 'write') {
    module.FS.writeFile(event.data.path, event.data.contents);
    return;
  }
  if (event.data?.kind !== 'lsp') {
    return;
  }
  const body = encoder.encode(JSON.stringify(event.data.message));
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  input.push(...header, ...body);
  wake?.();
  wake = null;
};

postMessage({ kind: 'ready' });
