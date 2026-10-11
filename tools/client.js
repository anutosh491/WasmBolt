import { tools, tokenize } from "./registry.js";
import { compileWasm } from "../runtime/load-wasm.js";

const analysisTools = new Set(["opt", "llc", "mlir-opt", "dot"]);
const compiledModules = new Map();
let analysisWorker, sequence = 0;

export function prepareTool(program) {
  if (!compiledModules.has(program))
    compiledModules.set(program, compileWasm(new URL(`./${tools[program]}.wasm`, import.meta.url))
      .catch(error => { compiledModules.delete(program); throw error; }));
  return compiledModules.get(program);
}

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

export async function runTool(command, FS, inputs = workspaceFiles(FS)) {
  const args = tokenize(command);
  const program = args.shift().split("/").pop();
  const wasmModule = analysisTools.has(program) ? await prepareTool(program) : undefined;
  const files = inputs.map((path) => ({ path, data: FS.readFile(path).slice().buffer }));
  return new Promise((resolve, reject) => {
    // One analysis worker, fresh CLI runtime instances. CLI exit state cannot
    // be reused, but its worker, JS modules and compiled Wasm can.
    // The classic Graphviz script declares global classes and cannot be
    // re-imported. Keep its compiled Wasm cached, with a disposable JS worker.
    const cached = analysisTools.has(program) && program !== 'dot';
    const worker = cached ? (analysisWorker ||= new Worker(new URL("./worker.js", import.meta.url)))
      : new Worker(new URL("./worker.js", import.meta.url));
    const id = ++sequence;
    const cleanup = () => {
      worker.removeEventListener('error', failed);
      worker.removeEventListener('message', completed);
      if (!cached) worker.terminate();
    };
    const failed = (event) => {
      cleanup();
      worker.terminate();
      if (cached) analysisWorker = null;
      reject(new Error(event.message || `${program} worker failed`));
    };
    const completed = ({ data }) => {
      if (data.id !== id) return;
      cleanup();
      if (data.wasmModule) compiledModules.set(program, data.wasmModule);
      for (const file of data.files) {
        FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")));
        FS.writeFile(file.path, new Uint8Array(file.data));
      }
      for (const path of data.deleted) FS.unlink(path);
      resolve(data);
    };
    worker.addEventListener('error', failed);
    worker.addEventListener('message', completed);
    worker.postMessage({ id, program, args, files,
      cacheModule: analysisTools.has(program), wasmModule,
    }, files.map((file) => file.data));
  });
}
