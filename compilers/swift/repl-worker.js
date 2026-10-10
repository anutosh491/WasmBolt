import createREPL from './wasmbolt-swift-repl.js';
import { installSdk } from './sdk.js';

let repl, stdout = [], stderr = [], input = '';
self.onmessage = async ({ data: { id, command, source, wasmBinary } }) => {
  try {
    stdout = []; stderr = [];
    if (command === 'initialize') {
      if (!crossOriginIsolated) throw new Error('Swift REPL needs COOP/COEP headers');
      repl = await createREPL({ noInitialRun: true, noExitRuntime: true,
        locateFile: name => new URL(name, import.meta.url).href,
        wasmBinary: new Uint8Array(wasmBinary),
        print: text => stdout.push(text), printErr: text => stderr.push(text) });
      await installSdk(repl.FS);
      repl.FS.mkdirTree('/workspace'); repl.FS.chdir('/workspace');
      const code = repl.ccall('wb_swift_repl_initialize', 'number', [], []);
      postMessage({ id, code, stdout, stderr });
      return;
    }
    if (!repl) throw new Error('Swift REPL is not ready');
    input += source + '\n';
    if (!repl.ccall('wb_swift_repl_is_complete', 'number', ['string'], [input])) {
      postMessage({ id, code: 0, incomplete: true, stdout, stderr });
      return;
    }
    const cell = input; input = '';
    const code = repl.ccall('wb_swift_repl_execute', 'number', ['string'], [cell]);
    postMessage({ id, code, stdout, stderr });
  } catch (error) { postMessage({ id, error: error.message, stdout, stderr }); }
};
