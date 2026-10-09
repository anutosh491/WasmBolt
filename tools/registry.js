// Each entry names a published Emscripten module. Aliases select the driver's
// normal argv[0] behavior; no WasmBolt-specific command implementation.
export const tools = {
  opt: "opt", llc: "llc",
  "mlir-opt": "mlir-opt", "mlir-translate": "mlir-translate", dot: "dot",
  "llvm-ar": "llvm-ar", "llvm-ranlib": "llvm-ar", "llvm-lib": "llvm-ar", "llvm-dlltool": "llvm-ar",
  "llvm-cxxfilt": "llvm-cxxfilt", "llvm-c++filt": "llvm-cxxfilt",
  "llvm-nm": "llvm-nm",
  "llvm-objcopy": "llvm-objcopy", "llvm-strip": "llvm-objcopy",
  "llvm-install-name-tool": "llvm-objcopy", "llvm-bitcode-strip": "llvm-objcopy",
  "llvm-objdump": "llvm-objdump", "llvm-otool": "llvm-objdump",
  "llvm-readobj": "llvm-readobj", "llvm-readelf": "llvm-readobj",
  "llvm-size": "llvm-size",
};

export function tokenize(command) {
  const args = [];
  let current = "", quote = "", escaped = false, started = false;
  for (const character of command.trim()) {
    if (escaped) { current += character; escaped = false; }
    else if (character === "\\" && quote !== "'") { escaped = true; started = true; }
    else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "'" || character === '"') { quote = character; started = true; }
    else if (/\s/.test(character)) {
      if (started) { args.push(current); current = ""; started = false; }
    } else { current += character; started = true; }
  }
  if (escaped || quote) throw new Error("Unterminated quote or escape in command");
  if (started) args.push(current);
  return args;
}
