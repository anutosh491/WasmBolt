let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => runToolJob(data)); };
async function runToolJob({ id, program, args, files, cacheModule, wasmModule }) {
  const { tools } = await import("./registry.js");
  const { workspaceFiles } = await import("./client.js");
  const stdout = [], stderr = [], original = new Map();
  let module, rejectInstantiation, status = 0, error = "";
  try {
    const options = {
      noInitialRun: true,
      thisProgram: program,
      locateFile: (path) => new URL(path, self.location.href).href,
      print: (line) => stdout.push(String(line)),
      printErr: (line) => stderr.push(String(line)),
    };
    const { compileWasm } = await import("../runtime/load-wasm.js");
    wasmModule ||= await compileWasm(new URL(`./${tools[program]}.wasm`, self.location.href));
    options.instantiateWasm = (imports, receive) => {
      WebAssembly.instantiate(wasmModule, imports)
        .then(instance => receive(instance, wasmModule)).catch(error => rejectInstantiation(error));
      return {};
    };
    if (program === "dot") {
      // The published Graphviz CLI uses classic Emscripten JS. Its global
      // filesystem and entry point are replaced for each CLI invocation.
      module = await new Promise((resolve, reject) => {
        rejectInstantiation = reject;
        self.Module = { ...options,
          onRuntimeInitialized: () => resolve({ FS: self.FS, callMain: self.callMain }),
          onAbort: (reason) => reject(new Error(String(reason))),
        };
        importScripts("./dot.js");
      });
    } else {
      const { default: createTool } = await import(`./${tools[program]}.js`);
      module = await new Promise((resolve, reject) => {
        rejectInstantiation = reject;
        createTool(options).then(resolve, reject);
      });
    }
    module.FS.mkdirTree("/workspace");
    for (const file of files) {
      const bytes = new Uint8Array(file.data);
      module.FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")));
      module.FS.writeFile(file.path, bytes);
      original.set(file.path, bytes);
    }
    module.FS.chdir("/workspace");
    status = module.callMain(args) || 0;
  } catch (exception) {
    status = Number.isInteger(exception?.status) ? exception.status : 1;
    if (status) error = exception?.message || String(exception);
  }
  const generated = [], deleted = [];
  if (module) {
    const paths = new Set(workspaceFiles(module.FS));
    for (const path of paths) {
      const bytes = module.FS.readFile(path).slice();
      const previous = original.get(path);
      if (previous?.length === bytes.length && bytes.every((byte, i) => byte === previous[i])) continue;
      generated.push({ path, data: bytes.buffer });
    }
    for (const path of original.keys()) if (!paths.has(path)) deleted.push(path);
  }
  self.postMessage({ id, status, error, stdout, stderr, files: generated, deleted, wasmModule: cacheModule ? wasmModule : undefined }, generated.map((file) => file.data));
}
