// Persistent clangd process. Browser messages carry LSP and filesystem updates.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const input = [];
let offset = 0, wake = null, module = null, output = [], expected = null;
const post = (kind, value) => postMessage({ kind, ...value });

function stdin() {
  if (!input.length) return null;
  const byte = input[0][offset++];
  if (offset === input[0].length) { input.shift(); offset = 0; }
  return byte;
}
function stdinReady() {
  return input.length ? Promise.resolve() : new Promise(resolve => { wake = resolve; });
}
function stdout(byte) {
  output.push(byte);
  for (;;) {
    if (expected === null) {
      let end = -1;
      for (let i = 0; i + 3 < output.length; i++) {
        if (output[i] === 13 && output[i + 1] === 10 &&
            output[i + 2] === 13 && output[i + 3] === 10) { end = i; break; }
      }
      if (end < 0) return;
      const header = decoder.decode(new Uint8Array(output.slice(0, end)));
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) throw new Error('Invalid clangd response header');
      expected = Number(match[1]); output = output.slice(end + 4);
    }
    if (output.length < expected) return;
    const body = output.slice(0, expected);
    output = output.slice(expected); expected = null;
    post('lsp', { message: JSON.parse(decoder.decode(new Uint8Array(body))) });
  }
}
let stderrLine = '';
function stderr(byte) {
  if (byte !== 10) { stderrLine += String.fromCharCode(byte); return; }
  if (/error|failed|abort/i.test(stderrLine)) post('log', { message: stderrLine });
  stderrLine = '';
}
function write(files) {
  for (const { path, contents } of files) {
    module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    module.FS.writeFile(path, contents);
  }
}
async function start(files) {
  const factory = (await import('./runtime/clangd.js')).default;
  module = await factory({
    thisProgram: '/usr/bin/clangd',
    locateFile: path => new URL(path, new URL('./runtime/', import.meta.url)).href,
    stdin, stdinReady, stdout, stderr,
    onAbort: reason => post('error', { message: `clangd aborted: ${reason}` }),
  });
  write(files);
  module.FS.mkdirTree('/workspace');
  module.FS.writeFile('/workspace/.clangd', 'Index:\n  StandardLibrary: false\n');
  const execution = module.callMain([
    '--background-index=false', '--clang-tidy=false', '--log=error',
    '--offset-encoding=utf-16',
  ]);
  if (execution instanceof Promise)
    execution.catch(error => post('error', { message: error.message || String(error) }));
  post('ready');
}
onmessage = event => {
  const message = event.data;
  if (message.kind === 'start') {
    start(message.files).catch(error => post('error', { message: error.message }));
  } else if (message.kind === 'write') {
    write(message.files);
  } else if (message.kind === 'lsp') {
    const body = encoder.encode(JSON.stringify(message.message));
    input.push(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`), body);
    wake?.(); wake = null;
  }
};
