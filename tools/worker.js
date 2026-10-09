self.onmessage = async ({ data: { program, args, files } }) => {
  const { tools } = await import("./registry.js");
  const { workspaceFiles } = await import("./client.js");
  const stdout = [], stderr = [], original = new Map();
  let module, status = 0, error = "";
  try {
    const options = {
      noInitialRun: true,
      thisProgram: program,
      locateFile: (path) => new URL(path, self.location.href).href,
      print: (line) => stdout.push(String(line)),
      printErr: (line) => stderr.push(String(line)),
    };
    if (program === "dot") {
      // The published Graphviz CLI uses classic Emscripten JS. Its global
      // filesystem and entry point live only in this disposable Worker.
      module = await new Promise((resolve, reject) => {
        self.Module = { ...options,
          onRuntimeInitialized: () => resolve({ FS: self.FS, callMain: self.callMain }),
          onAbort: (reason) => reject(new Error(String(reason))),
        };
        importScripts("./dot.js");
      });
    } else {
      const { default: createTool } = await import(`./${tools[program]}.js`);
      module = await createTool(options);
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
  self.postMessage({ status, error, stdout, stderr, files: generated, deleted }, generated.map((file) => file.data));
};
