import createCompiler from './wasmbolt-swift.js';
import { downloadWasm } from '../../runtime/load-wasm.js';
import { installSdk } from './sdk.js';

let compiler, stdout = [], stderr = [];
const files = () => {
  const result = new Map();
  function walk(directory) {
    for (const name of compiler.FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      const path = `${directory}/${name}`, stat = compiler.FS.stat(path);
      if (compiler.FS.isDir(stat.mode)) walk(path);
      else result.set(path, `${stat.size}:${stat.mtime.getTime()}`);
    }
  }
  walk('/workspace');
  return result;
};
self.onmessage = async ({ data: { id, command, args, inputs = [] } }) => {
  try {
    if (command === 'initialize') {
      if (!crossOriginIsolated) throw new Error('Swift needs COOP/COEP headers and shared memory');
      const binary = await downloadWasm(new URL('./wasmbolt-swift.wasm', import.meta.url));
      compiler = await createCompiler({
        noInitialRun: true, noExitRuntime: true,
        locateFile: name => new URL(name, import.meta.url).href,
        wasmBinary: new Uint8Array(binary),
        print: text => stdout.push(text), printErr: text => stderr.push(text),
      });
      await installSdk(compiler.FS);
      // Paths used by native driver tool discovery. Jobs execute in-process.
      compiler.FS.mkdirTree('/swift/bin');
      for (const tool of ['swift', 'swiftc', 'swift-frontend', 'swift-autolink-extract', 'clang', 'wasm-ld']) {
        const path = `/swift/bin/${tool}`;
        compiler.FS.writeFile(path, '');
        compiler.FS.chmod(path, 0o755);
      }
      compiler.FS.mkdirTree('/workspace');
      compiler.FS.chdir('/workspace');
      postMessage({ id, result: {} });
      return;
    }
    if (!compiler) throw new Error('Swift compiler is not ready');
    for (const { path, bytes } of inputs) {
      compiler.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      compiler.FS.writeFile(path, bytes);
    }
    const before = files();
    stdout = []; stderr = [];
    const code = compiler.ccall('wb_swift_run', 'number', ['string'], [JSON.stringify(args)]);
    if (compiler.ccall('wb_swift_can_run_again', 'number', [], []) !== 1)
      throw new Error('Swift linker failed; reload the page before retrying');
    const outputs = [...files()].filter(([path, stamp]) => before.get(path) !== stamp)
      .map(([path]) => ({ path, bytes: compiler.FS.readFile(path) }));
    postMessage({ id, result: { code, stdout, stderr, files: outputs } },
      outputs.map(file => file.bytes.buffer));
  } catch (error) { postMessage({ id, error: error.message }); }
};
