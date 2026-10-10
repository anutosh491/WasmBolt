import { tools, tokenize } from "./registry.js";

const analysisTools = new Set(["opt", "llc", "mlir-opt", "dot"]);
const compiledModules = new Map();

export function workspaceFiles(FS, directory = "/workspace") {
  return FS.readdir(directory).filter((name) => name !== "." && name !== "..")
    .flatMap((name) => {
      const path = `${directory}/${name}`;
      return FS.isDir(FS.stat(path).mode) ? workspaceFiles(FS, path) : [path];
    }).sort();
}

export function isToolCommand(command) {
  return Object.hasOwn(tools, tokenize(command)[0]?.split("/").pop());
}

export function runTool(command, FS) {
  const args = tokenize(command);
  const program = args.shift().split("/").pop();
  const files = workspaceFiles(FS).map((path) => ({ path, data: FS.readFile(path).slice().buffer }));
  return new Promise((resolve, reject) => {
    // Retain compiled analysis code, but give CLI shutdown and globals a fresh
    // instance for each command. Utility tools remain disposable.
    const worker = new Worker(new URL("./worker.js", import.meta.url));
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || `${program} worker failed`));
    };
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.wasmModule) compiledModules.set(program, data.wasmModule);
      for (const file of data.files) {
        FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")));
        FS.writeFile(file.path, new Uint8Array(file.data));
      }
      for (const path of data.deleted) FS.unlink(path);
      resolve(data);
    };
    worker.postMessage({ program, args, files,
      cacheModule: analysisTools.has(program), wasmModule: compiledModules.get(program),
    }, files.map((file) => file.data));
  });
}
