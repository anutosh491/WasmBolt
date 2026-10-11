import createCompiler from './wasmbolt-swift.js';
import { downloadWasm } from '../../runtime/load-wasm.js';
import { installSdk, loadSdk } from './sdk.js';

let compiler, stdout = [], stderr = [];
let foundation;
const installFoundation = () => foundation ||= installSdk(compiler.FS, loadSdk('foundation.tar.gz'))
  .catch(error => { foundation = null; throw error; });
function importsFoundation(path) {
  try {
    return /\bimport\s+(?:(?:class|struct|enum|func|var|let|typealias)\s+)?(?:Foundation\w*|CoreFoundation|_Foundation\w*)\b/
      .test(compiler.FS.readFile(path, { encoding: 'utf8' }));
  } catch { return false; }
}
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
self.onmessage = async ({ data: { id, command, args, inputs = [], paths = [] } }) => {
  try {
    if (command === 'initialize') {
      if (!crossOriginIsolated) throw new Error('Swift needs COOP/COEP headers and shared memory');
      const [module, sdk] = await Promise.all([
        downloadWasm(new URL('./wasmbolt-swift.wasm', import.meta.url)).then(binary => createCompiler({
        noInitialRun: true, noExitRuntime: true,
        locateFile: name => new URL(name, import.meta.url).href,
        wasmBinary: new Uint8Array(binary),
        print: text => stdout.push(text), printErr: text => stderr.push(text),
        })), loadSdk()]);
      compiler = module;
      await installSdk(compiler.FS, sdk);
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
    for (const path of files().keys())
      if (!paths.includes(path)) compiler.FS.unlink(path);
    for (const { path, bytes } of inputs) {
      compiler.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      compiler.FS.writeFile(path, bytes);
    }
    const before = files();
    // Load the optional SDK for imports or explicitly requested libraries.
    // Unrelated example files in the workspace must not trigger this download.
    const needsFoundation = args.some(argument => /^-l(?:Foundation|CoreFoundation|_Foundation|xml2)/.test(argument) ||
      (/\.swift$/.test(argument) && importsFoundation(argument)));
    if (needsFoundation) await installFoundation();
    stdout = []; stderr = [];
    let code = compiler.ccall('wb_swift_run', 'number', ['string'], [JSON.stringify(args)]);
    // Imported user modules can themselves depend on Foundation.
    if (code && !foundation && compiler.ccall('wb_swift_can_run_again', 'number', [], []) === 1 &&
        stderr.some(line => /(?:Foundation|CoreFoundation|xml2)/.test(line))) {
      await installFoundation();
      stdout = []; stderr = [];
      code = compiler.ccall('wb_swift_run', 'number', ['string'], [JSON.stringify(args)]);
    }
    if (compiler.ccall('wb_swift_can_run_again', 'number', [], []) !== 1)
      throw new Error('Swift linker failed; reload the page before retrying');
    const outputs = [...files()].filter(([path, stamp]) => before.get(path) !== stamp)
      .map(([path]) => ({ path, bytes: compiler.FS.readFile(path) }));
    postMessage({ id, result: { code, stdout, stderr, files: outputs } },
      outputs.map(file => file.bytes.buffer));
  } catch (error) { postMessage({ id, error: error.message }); }
};
