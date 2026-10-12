import createREPL from './wasmbolt-swift-repl.js';
import { installSdk, loadSdk } from './sdk.js';

let repl, foundation, stdout = [], stderr = [], input = '';
self.onmessage = async ({ data: { id, command, source, compiledModule, sdk, baseSdk } }) => {
  try {
    stdout = []; stderr = [];
    if (command === 'initialize') {
      if (!crossOriginIsolated) throw new Error('Swift REPL needs COOP/COEP headers');
      const [module, archive] = await Promise.all([createREPL({ noInitialRun: true, noExitRuntime: true,
        locateFile: name => new URL(name, import.meta.url).href,
        instantiateWasm(imports, receive) {
          const instance = new WebAssembly.Instance(compiledModule, imports);
          receive(instance, compiledModule);
          return instance.exports;
        },
        print: text => stdout.push(text), printErr: text => stderr.push(text) }),
        sdk || loadSdk('repl-modules.tar.gz')]);
      repl = module;
      await installSdk(repl.FS, baseSdk || loadSdk());
      await installSdk(repl.FS, archive);
      repl.FS.mkdirTree('/workspace'); repl.FS.chdir('/workspace');
      const code = repl.ccall('wb_swift_repl_initialize', 'number', [], []);
      postMessage({ id, code, stdout, stderr, inputNumber: 1 });
      return;
    }
    if (!repl) throw new Error('Swift REPL is not ready');
    if (/\bimport\s+(?:Foundation|FoundationEssentials|FoundationInternationalization|CoreFoundation|Synchronization|_Concurrency|_StringProcessing|_RegexParser|EmscriptenLibc)\b/.test(source)) {
      foundation ||= (async () => {
        await installSdk(repl.FS, loadSdk('repl-foundation.tar.gz'));
        const directory = '/swift/lib/swift/emscripten';
        const names = JSON.parse(repl.FS.readFile(`${directory}/repl-libraries.json`, { encoding: 'utf8' }));
        for (const name of names) {
          if (!/^[\w]+$/.test(name)) throw new Error('Invalid REPL library name');
          if (name !== 'Foundation') repl.FS.symlink('libFoundation.so', `${directory}/lib${name}.so`);
        }
      })().catch(error => { foundation = null; throw error; });
      await foundation;
    }
    input += source + '\n';
    if (!repl.ccall('wb_swift_repl_is_complete', 'number', ['string'], [input])) {
      postMessage({ id, code: 0, incomplete: true, stdout, stderr });
      return;
    }
    const cell = input; input = '';
    const code = repl.ccall('wb_swift_repl_execute', 'number', ['string'], [cell]);
    postMessage({ id, code, stdout, stderr,
      inputNumber: repl.ccall('wb_swift_repl_input_number', 'number', [], []) });
  } catch (error) { postMessage({ id, error: error.message, stdout, stderr }); }
};
