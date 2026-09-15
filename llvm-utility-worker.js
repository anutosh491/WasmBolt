import createLLVM from "./llvm.js";

const utilityNames = new Map([
  ["llvm-ar", "ar"],
  ["llvm-bitcode-strip", "bitcode-strip"],
  ["llvm-c++filt", "c++filt"],
  ["llvm-cxxfilt", "cxxfilt"],
  ["llvm-dlltool", "dlltool"],
  ["llvm-extract-bundle-entry", "extract-bundle-entry"],
  ["llvm-install-name-tool", "install-name-tool"],
  ["llvm-lib", "lib"],
  ["llvm-nm", "nm"],
  ["llvm-objcopy", "objcopy"],
  ["llvm-objdump", "objdump"],
  ["llvm-otool", "otool"],
  ["llvm-ranlib", "ranlib"],
  ["llvm-readelf", "readelf"],
  ["llvm-readobj", "readobj"],
  ["llvm-size", "size"],
  ["llvm-strip", "strip"],
]);

function fingerprint(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.byteLength}:${hash >>> 0}`;
}

function workspaceFiles(module, directory = "/workspace") {
  const files = [];
  for (const name of module.FS.readdir(directory)) {
    if (name === "." || name === "..") continue;
    const path = `${directory}/${name}`;
    if (module.FS.isDir(module.FS.stat(path).mode))
      files.push(...workspaceFiles(module, path));
    else
      files.push(path);
  }
  return files;
}

function tokenize(command) {
  const args = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const character of command.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }

  if (escaped || quote)
    throw new Error("unterminated quote or escape in command");
  if (current) args.push(current);
  return args;
}

self.onmessage = async ({ data }) => {
  const { id, command, files } = data;
  const stdout = [];
  const stderr = [];
  const originalFiles = new Map();
  let module;
  let responded = false;

  const respond = (message) => {
    if (responded) return;
    responded = true;
    const generatedFiles = [];
    if (message.ok && module) {
      for (const path of workspaceFiles(module)) {
        const bytes = module.FS.readFile(path).slice();
        if (originalFiles.get(path) === fingerprint(bytes)) continue;
        generatedFiles.push({ path, data: bytes.buffer });
      }
    }
    self.postMessage(
      { id, stdout, stderr, generatedFiles, ...message },
      generatedFiles.map((file) => file.data),
    );
  };

  try {
    const args = tokenize(command);
    const subcommand = utilityNames.get(args.shift());
    if (!subcommand)
      throw new Error("unsupported LLVM utility");

    await createLLVM({
      arguments: [subcommand, ...args],
      locateFile: (path) => new URL(path, import.meta.url).href,
      preRun: [
        (instance) => {
          module = instance;
          module.FS.mkdirTree("/workspace");
          for (const file of files) {
            const bytes = new Uint8Array(file.data);
            module.FS.writeFile(file.path, bytes);
            originalFiles.set(file.path, fingerprint(bytes));
          }
          module.FS.chdir("/workspace");
        },
      ],
      print: (line) => stdout.push(String(line)),
      printErr: (line) => stderr.push(String(line)),
      onExit: (status) => respond({ ok: status === 0, status }),
    });

    respond({ ok: true, status: 0 });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 1;
    respond({
      ok: false,
      status,
      error: error?.message || String(error),
    });
  }
};
