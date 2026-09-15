import createLLVM from "./llvm.js";

const utilityNames = new Map([
  ["llvm-readobj", "readobj"],
  ["llvm-nm", "nm"],
  ["llvm-size", "size"],
  ["llvm-cxxfilt", "cxxfilt"],
]);

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
  let responded = false;

  const respond = (message) => {
    if (responded) return;
    responded = true;
    self.postMessage({ id, stdout, stderr, ...message });
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
        (module) => {
          module.FS.mkdirTree("/workspace");
          for (const file of files)
            module.FS.writeFile(file.path, new Uint8Array(file.data));
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
