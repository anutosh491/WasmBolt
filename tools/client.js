import { tools, tokenize } from "./registry.js";

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
    // LLVM tools may exit or shut down their global state. A fresh Worker makes
    // repeated invocations independent while keeping all generated files.
    const worker = new Worker(new URL("./worker.js", import.meta.url));
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || `${program} worker failed`));
    };
    worker.onmessage = ({ data }) => {
      worker.terminate();
      for (const file of data.files) {
        FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")));
        FS.writeFile(file.path, new Uint8Array(file.data));
      }
      for (const path of data.deleted) FS.unlink(path);
      resolve(data);
    };
    worker.postMessage({ program, args, files }, files.map((file) => file.data));
  });
}
