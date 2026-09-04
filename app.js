const $ = (selector) => document.querySelector(selector);

const elements = {
  source: $("#source"),
  output: $("#output"),
  cfgView: $("#cfg-view"),
  cfgImage: $("#cfg-image"),
  log: $("#log"),
  status: $("#status"),
  statusDot: $("#status-dot"),
  version: $("#version"),
  targets: $("#targets"),
  language: $("#language"),
  optimization: $("#optimization"),
  target: $("#target"),
  filename: $("#filename"),
  compile: $("#compile"),
  compileRun: $("#compile-run"),
  loadWasm: $("#load-wasm"),
  fileBrowser: $("#file-browser"),
  fileSelect: $("#file-select"),
  openFile: $("#open-file"),
  downloadFile: $("#download-file"),
  runner: $("#runner"),
  symbol: $("#symbol"),
  signature: $("#signature"),
  argA: $("#arg-a"),
  argB: $("#arg-b"),
  argAWrap: $("#arg-a-wrap"),
  argBWrap: $("#arg-b-wrap"),
  execute: $("#execute"),
  result: $("#result"),
  command: $("#command"),
  runCommand: $("#run-command"),
};

const examples = {
  cpp: `int sum_invariant(int N, int x) {
  int out = 0;

  for (int i = 0; i < N; ++i) {
    int invariant = x * 3;
    out += invariant;
  }

  return out > 0 ? out : 0;
}`,
  c: `int sum_invariant(int N, int x) {
  int out = 0;

  for (int i = 0; i < N; ++i) {
    int invariant = x * 3;
    out += invariant;
  }

  return out;
}`,
  llvm: `define i32 @absolute_difference(i32 %a, i32 %b) {
entry:
  %greater = icmp sgt i32 %a, %b
  br i1 %greater, label %a_greater, label %b_greater

a_greater:
  %left = sub i32 %a, %b
  ret i32 %left

b_greater:
  %right = sub i32 %b, %a
  ret i32 %right
}`,
};

const outputs = {
  ast: "",
  ir: "",
  optimized: "",
  analysis: "Analysis-only command output appears here.",
  cfg: "Generate LLVM IR to render its control-flow graph.",
  assembly: "",
  wasm: "Choose a stage or build the program to begin.",
  files: "The browser filesystem is empty.",
};

let compiler = null;
let activeCapture = null;
let activeLogCapture = null;
let activeTab = "ir";
let resourceDir = "/lib/clang/23";
let currentModulePath = "";
let buildNumber = 0;
let busy = false;
let cfgObjectUrl = "";
let wasmExportSignatures = new Map();

function appendLog(line, kind = "out") {
  const text = String(line ?? "");
  const rendered = `${kind === "err" ? "[stderr] " : ""}${text}`;
  if (activeCapture) {
    activeCapture.push(text);
    activeLogCapture.push(rendered);
    return;
  }
  elements.log.append(`${rendered}\n`);
  const terminal = $("#terminal-scroll");
  if (terminal) terminal.scrollTop = terminal.scrollHeight;
}

function setStatus(text, state = "ready") {
  elements.status.textContent = text;
  elements.statusDot.className = `status-dot ${state === "ready" ? "" : state}`;
}

function setBusy(value, message = "Working…") {
  busy = value;
  for (const button of [elements.compile, elements.compileRun, elements.loadWasm, elements.runCommand])
    button.disabled = value || !compiler;
  if (value) setStatus(message, "loading");
}

function languageSettings() {
  if (elements.language.value === "llvm") {
    return {
      driver: "",
      filename: "/workspace/input.ll",
      label: "input.ll",
      standard: "",
      x: "",
      llvmIr: true,
    };
  }
  const cpp = elements.language.value === "cpp";
  return {
    driver: cpp ? "clang++" : "clang",
    filename: cpp ? "/workspace/snippet.cpp" : "/workspace/snippet.c",
    label: cpp ? "snippet.cpp" : "snippet.c",
    standard: cpp ? "-std=c++23" : "-std=c23",
    x: cpp ? "c++" : "c",
  };
}

function writeSource() {
  const settings = languageSettings();
  compiler.FS.writeFile(settings.filename, elements.source.value);
  refreshWorkspaceFiles(settings.filename);
  return settings;
}

function readText(path) {
  return compiler.FS.readFile(path, { encoding: "utf8" });
}

function removeIfPresent(path) {
  try { compiler.FS.unlink(path); } catch (_) { /* absent is fine */ }
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll("#tabs button").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === tab));
  elements.output.textContent = outputs[tab] || "No output yet.";
  elements.output.classList.toggle("hidden", tab === "cfg");
  elements.cfgView.classList.toggle("hidden", tab !== "cfg");
  elements.fileBrowser.classList.toggle("hidden", tab !== "files");
}

function renderCfg() {
  for (const path of workspaceFiles()) {
    if (path.endsWith(".dot") || path === "/workspace/cfg.svg")
      removeIfPresent(path);
  }
  run("opt -passes=dot-cfg -disable-output /workspace/optimized.ll");
  const dotPath = workspaceFiles().find((path) => path.endsWith(".dot"));
  if (!dotPath) throw new Error("opt did not emit a CFG DOT file");
  run(`dot -Tsvg ${dotPath} -o /workspace/cfg.svg`);
  const svg = readText("/workspace/cfg.svg");
  if (!svg) throw new Error("Graphviz did not render the CFG");
  if (cfgObjectUrl) URL.revokeObjectURL(cfgObjectUrl);
  cfgObjectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  elements.cfgImage.src = cfgObjectUrl;
  elements.cfgImage.dataset.ready = "true";
  outputs.cfg = `LLVM CFG from ${dotPath}, rendered in-process by Graphviz`;
  refreshWorkspaceFiles("/workspace/cfg.svg");
}

function workspaceFiles() {
  if (!compiler) return [];
  return compiler.FS.readdir("/workspace")
    .filter((name) => name !== "." && name !== "..")
    .map((name) => `/workspace/${name}`)
    .sort();
}

function refreshWorkspaceFiles(preferred = "") {
  const files = workspaceFiles();
  const previous = preferred || elements.fileSelect.value;
  elements.fileSelect.replaceChildren();
  for (const path of files) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path.replace("/workspace/", "");
    elements.fileSelect.append(option);
  }
  if (files.includes(previous)) elements.fileSelect.value = previous;
  outputs.files = files.length
    ? files.map((path) => {
        const size = compiler.FS.stat(path).size;
        return `${path.replace("/workspace/", "").padEnd(28)} ${String(size).padStart(9)} bytes`;
      }).join("\n")
    : "The browser filesystem is empty.";
  if (activeTab === "files") elements.output.textContent = outputs.files;
}

function isTextFile(path) {
  return /\.(?:c|cc|cpp|cxx|h|hpp|ll|mir|s|dot|svg|txt|json)$/i.test(path);
}

function openWorkspaceFile(path = elements.fileSelect.value) {
  if (!path) return;
  elements.fileSelect.value = path;
  if (/\.svg$/i.test(path)) {
    const svg = readText(path);
    if (cfgObjectUrl) URL.revokeObjectURL(cfgObjectUrl);
    cfgObjectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    elements.cfgImage.src = cfgObjectUrl;
    elements.cfgImage.dataset.ready = "true";
    outputs.cfg = `Rendered ${path}`;
    switchTab("cfg");
    return;
  }
  if (isTextFile(path)) {
    outputs.files = readText(path);
  } else {
    const bytes = compiler.FS.readFile(path);
    outputs.files = [
      path,
      `${bytes.byteLength} bytes`,
      "",
      "Binary file. Use Download to inspect it with external tooling.",
    ].join("\n");
  }
  switchTab("files");
}

function downloadWorkspaceFile() {
  const path = elements.fileSelect.value;
  if (!path) return;
  const bytes = compiler.FS.readFile(path);
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.split("/").pop();
  anchor.click();
  URL.revokeObjectURL(url);
}

function commandOutputPath(command) {
  const match = command.match(/(?:^|\s)-o(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match ? (match[1] || match[2] || match[3]) : "";
}

function commandText(settings, action, target = elements.target.value) {
  if (settings.llvmIr)
    throw new Error(`The ${action} action requires C or C++; LLVM IR starts after Clang`);
  const compileTarget = action === "object" ? "wasm32-unknown-emscripten" : target;
  const systemIncludes = compileTarget.startsWith("wasm32-") ? [
      "-isystem /include/wasm32-emscripten/c++/v1",
      "-isystem /include/c++/v1",
      `-isystem ${resourceDir}/include`,
      "-isystem /include/wasm32-emscripten",
      "-Xclang -iwithsysroot/include/compat",
      "-isystem /include",
    ].join(" ") : `-isystem ${resourceDir}/include`;
  const common = `${settings.driver} -x ${settings.x} ${settings.standard} -fno-color-diagnostics -resource-dir=${resourceDir} ${systemIncludes}`;
  if (action === "ast")
    return `${common} -fsyntax-only -Xclang -ast-dump ${settings.filename}`;
  if (action === "ir")
    return `${common} --target=${compileTarget} -O${elements.optimization.value} -Xclang -disable-O0-optnone -S -emit-llvm ${settings.filename} -o /workspace/source.ll`;
  if (action === "object")
    return `${common} --target=wasm32-unknown-emscripten -fPIC -fwasm-exceptions -O${elements.optimization.value} -c ${settings.filename} -o /workspace/program.o`;
  throw new Error(`Unknown action ${action}`);
}

function run(command) {
  appendLog("");
  activeCapture = [];
  activeLogCapture = [];
  let code;
  let captured;
  let capturedLog;
  try {
    code = compiler.ccall("run_command", "number", ["string"], [command]);
    captured = activeCapture.join("\n");
  } finally {
    capturedLog = activeLogCapture.join("\n");
    activeCapture = null;
    activeLogCapture = null;
    if (capturedLog) appendLog(capturedLog);
  }
  if (code !== 0) throw new Error(`Command failed with exit code ${code}`);
  return captured;
}

function emitIr(settings, target) {
  removeIfPresent("/workspace/source.ll");
  if (settings.llvmIr)
    compiler.FS.writeFile("/workspace/source.ll", elements.source.value);
  else
    run(commandText(settings, "ir", target));
  outputs.ir = readText("/workspace/source.ll");
  return outputs.ir;
}

function optimizeIr() {
  removeIfPresent("/workspace/optimized.ll");
  const command = `opt -S -passes=default<O${elements.optimization.value}> /workspace/source.ll -o /workspace/optimized.ll`;
  run(command);
  outputs.optimized = readText("/workspace/optimized.ll");
  return outputs.optimized;
}

function emitAssembly() {
  removeIfPresent("/workspace/output.s");
  const command = `llc -mtriple=${elements.target.value} -filetype=asm -O${elements.optimization.value} /workspace/optimized.ll -o /workspace/output.s`;
  run(command);
  outputs.assembly = readText("/workspace/output.s");
  return outputs.assembly;
}

async function compileSelectedOutput() {
  if (busy) return;
  const stage = activeTab === "wasm" || activeTab === "files" ? "ir" : activeTab;
  setBusy(true, `Compiling ${stage === "cfg" ? "control-flow graph" : stage}…`);
  try {
    const settings = writeSource();
    if (stage === "ast") {
      if (settings.llvmIr) throw new Error("Clang AST is not applicable to LLVM IR input");
      outputs.ast = run(commandText(settings, "ast"));
    } else {
      emitIr(settings, elements.target.value);
      if (stage === "optimized" || stage === "cfg" || stage === "assembly") optimizeIr();
      if (stage === "cfg") renderCfg();
      if (stage === "assembly") emitAssembly();
    }
    switchTab(stage);
    refreshWorkspaceFiles();
    setStatus("Compiler ready");
  } catch (error) {
    appendLog(error.message, "err");
    setStatus("Compilation failed", "error");
  } finally {
    setBusy(false);
  }
}

function publicFunctionExports(exports) {
  const hidden = new Set(["__wasm_call_ctors", "__wasm_apply_data_relocs", "__dso_handle"]);
  return exports
    .filter((entry) => entry.kind === "function" && !hidden.has(entry.name) &&
      (!entry.name.startsWith("_") || /^_Z\d/.test(entry.name)))
    .map((entry) => entry.name);
}

function displayFunctionExport(name) {
  const match = name.match(/^_Z(\d+)/);
  if (!match) return name;
  const start = match[0].length;
  const length = Number(match[1]);
  const sourceName = name.slice(start, start + length);
  return sourceName ? `${sourceName} (C++: ${name})` : name;
}

function parseWasmFunctionSignatures(bytes) {
  let offset = 8;
  const types = [];
  const importedTypes = [];
  const definedTypes = [];
  const exportedFunctions = new Map();
  const valueTypes = new Map([[0x7f, "i32"], [0x7e, "i64"], [0x7d, "f32"], [0x7c, "f64"], [0x70, "funcref"], [0x6f, "externref"]]);
  const uleb = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 0x7f) * (2 ** shift); shift += 7; } while (byte & 0x80);
    return value;
  };
  const name = () => { const size = uleb(); const value = new TextDecoder().decode(bytes.subarray(offset, offset + size)); offset += size; return value; };
  const limits = () => { const flags = uleb(); uleb(); if (flags & 1) uleb(); };
  const vector = (read) => { const count = uleb(); return Array.from({ length: count }, read); };

  while (offset < bytes.length) {
    const id = bytes[offset++];
    const size = uleb();
    const end = offset + size;
    if (id === 1) {
      for (const _ of vector(() => 0)) {
        if (bytes[offset++] !== 0x60) throw new Error("Unsupported Wasm function type");
        const params = vector(() => valueTypes.get(bytes[offset++]) || "?");
        const results = vector(() => valueTypes.get(bytes[offset++]) || "?");
        types.push({ params, results });
      }
    } else if (id === 2) {
      for (const _ of vector(() => 0)) {
        name(); name();
        const kind = bytes[offset++];
        if (kind === 0) importedTypes.push(uleb());
        else if (kind === 1) { offset++; limits(); }
        else if (kind === 2) limits();
        else if (kind === 3) offset += 2;
        else if (kind === 4) { uleb(); uleb(); }
        else throw new Error(`Unsupported Wasm import kind ${kind}`);
      }
    } else if (id === 3) {
      definedTypes.push(...vector(() => uleb()));
    } else if (id === 7) {
      for (const _ of vector(() => 0)) {
        const exportName = name();
        const kind = bytes[offset++];
        const index = uleb();
        if (kind === 0) exportedFunctions.set(exportName, index);
      }
    }
    offset = end;
  }

  const signatures = new Map();
  for (const [exportName, index] of exportedFunctions) {
    const typeIndex = index < importedTypes.length ? importedTypes[index] : definedTypes[index - importedTypes.length];
    const type = types[typeIndex];
    if (type) signatures.set(exportName, `${type.results[0] || "void"}(${type.params.join(", ")})`);
  }
  return signatures;
}

async function inspectWasm(path) {
  const bytes = compiler.FS.readFile(path);
  const module = await WebAssembly.compile(bytes);
  const allExports = WebAssembly.Module.exports(module);
  const functions = publicFunctionExports(allExports);
  wasmExportSignatures = parseWasmFunctionSignatures(bytes);

  elements.symbol.replaceChildren();
  for (const name of functions) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = displayFunctionExport(name);
    elements.symbol.append(option);
  }
  const preferred = functions.find((name) => name === "square_plus_one") || functions[0];
  if (preferred) elements.symbol.value = preferred;

  outputs.wasm = [
    `Module: ${path}`,
    `Size: ${(bytes.byteLength / 1024).toFixed(1)} KiB`,
    "",
    "Exported functions discovered from the generated module:",
    ...(functions.length ? functions.map((name) => `  ${displayFunctionExport(name)}  ${wasmExportSignatures.get(name) || "(signature unavailable)"}`) : ["  (none)"]),
  ].join("\n");
  return functions;
}

async function activateWasm(path) {
  currentModulePath = path;
  const functions = await inspectWasm(path);
  refreshWorkspaceFiles(path);
  switchTab("wasm");
  elements.runner.classList.toggle("hidden", functions.length === 0);
  configureSelectedSymbol();
  if (functions.length) setStatus("Wasm module ready to execute");
  else setStatus("Loaded, but no callable function exports were found", "error");
}

async function loadExistingWasm() {
  if (busy) return;
  const selected = elements.fileSelect.value || "";
  const wasmFiles = workspaceFiles().filter((path) => path.endsWith(".wasm"));
  const path = selected.endsWith(".wasm") ? selected : wasmFiles.at(-1);
  if (!path) {
    setStatus("No .wasm file exists in /workspace", "error");
    switchTab("files");
    return;
  }
  setBusy(true, `Loading ${path.split("/").pop()}…`);
  elements.result.textContent = "";
  try {
    await activateWasm(path);
  } catch (error) {
    currentModulePath = "";
    appendLog(error.message, "err");
    setStatus("Could not load Wasm module", "error");
  } finally {
    setBusy(false);
  }
}

async function compileAndRun() {
  if (busy) return;
  setBusy(true, "Building a dynamically loadable Wasm module…");
  elements.result.textContent = "";
  try {
    const settings = writeSource();
    removeIfPresent("/workspace/program.o");
    if (settings.llvmIr) {
      run(`llc -mtriple=wasm32-unknown-emscripten -filetype=obj -relocation-model=pic -O2 ${settings.filename} -o /workspace/program.o`);
    } else {
      run(commandText(settings, "object"));
    }

    currentModulePath = `/workspace/program-${++buildNumber}.wasm`;
    const link = [
      "wasm-ld", "-shared", "--import-memory", "--experimental-pic",
      "--unresolved-symbols=import-dynamic", "--export-all",
      "--export=__wasm_call_ctors", "--export-if-defined=__wasm_apply_data_relocs",
      "--no-gc-sections", "/workspace/program.o",
      "-o", currentModulePath,
    ].filter(Boolean).join(" ");
    run(link);
    await activateWasm(currentModulePath);
    if (elements.symbol.value && wasmExportSignatures.has(elements.symbol.value)) executeSymbol();
  } catch (error) {
    currentModulePath = "";
    appendLog(error.message, "err");
    setStatus("Build failed", "error");
  } finally {
    setBusy(false);
  }
}

function updateSignatureInputs() {
  const signature = Number(elements.signature.value);
  const argumentsCount = [0, 3, 6].includes(signature) ? 0 : [1, 4].includes(signature) ? 1 : 2;
  elements.argAWrap.classList.toggle("hidden", argumentsCount < 1);
  elements.argBWrap.classList.toggle("hidden", argumentsCount < 2);
}

function executeSymbol() {
  if (!currentModulePath || !elements.symbol.value) return;
  const signature = Number(elements.signature.value);
  const a = Number(elements.argA.value || 0);
  const b = Number(elements.argB.value || 0);
  const result = callSelectedSymbol(signature, a, b);
  elements.result.textContent = Number.isNaN(result) ? "Execution failed" : `Result: ${result}`;
  outputs.wasm = `${outputs.wasm.replace(/\n\nExecution result:[\s\S]*$/, "")}\n\nExecution result:\n  ${displayFunctionExport(elements.symbol.value)}(${[a, b].slice(0, [0, 3, 6].includes(signature) ? 0 : [1, 4].includes(signature) ? 1 : 2).join(", ")}) = ${result}`;
  if (activeTab === "wasm") elements.output.textContent = outputs.wasm;
  appendLog(`=> ${elements.symbol.value} returned ${result}`);
}

function callSelectedSymbol(signature, a, b) {
  activeCapture = [];
  activeLogCapture = [];
  let capturedLog;
  try {
    return compiler.ccall(
      "load_and_call_numeric",
      "number",
      ["string", "string", "number", "number", "number"],
      [currentModulePath, elements.symbol.value, signature, a, b],
    );
  } finally {
    capturedLog = activeLogCapture.join("\n");
    activeCapture = null;
    activeLogCapture = null;
    if (capturedLog) appendLog(capturedLog);
  }
}

function configureSelectedSymbol() {
  const name = elements.symbol.value;
  const signatureCodes = new Map([
    ["i32()", "0"], ["i32(i32)", "1"], ["i32(i32, i32)", "2"],
    ["f64()", "3"], ["f64(f64)", "4"], ["f64(f64, f64)", "5"], ["void()", "6"],
  ]);
  const detected = wasmExportSignatures.get(name);
  const code = signatureCodes.get(detected);
  if (code) elements.signature.value = code;
  elements.signature.title = detected ? `Read from the Wasm type section: ${detected}` : "Choose a signature manually";
  updateSignatureInputs();
}

function resetSource() {
  const language = elements.language.value;
  elements.source.value = examples[language];
  elements.filename.textContent = languageSettings().label;
  currentModulePath = "";
  wasmExportSignatures = new Map();
  elements.runner.classList.add("hidden");
  elements.result.textContent = "";
  saveState();
  updateLanguageUi();
}

function updateLanguageUi() {
  const isLlvmIr = elements.language.value === "llvm";
  const astTab = document.querySelector('[data-tab="ast"]');
  astTab.disabled = isLlvmIr;
  if (isLlvmIr && activeTab === "ast") switchTab("ir");
}

function serializableState() {
  return {
    source: elements.source.value,
    language: elements.language.value,
    optimization: elements.optimization.value,
    target: elements.target.value,
  };
}

function encodeState(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeState(encoded) {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function applyState(state) {
  for (const key of ["language", "optimization", "target"])
    if (state[key] && elements[key]) elements[key].value = state[key];
  if (typeof state.source === "string") elements.source.value = state.source;
  elements.filename.textContent = languageSettings().label;
}

function saveState() {
  localStorage.setItem("wasmbolt-state-v2", JSON.stringify(serializableState()));
}

async function shareState() {
  const url = new URL(location.href);
  url.hash = `code=${encodeState(serializableState())}`;
  await navigator.clipboard.writeText(url.href);
  const button = $("#share");
  const original = button.textContent;
  button.textContent = "Link copied";
  setTimeout(() => { button.textContent = original; }, 1300);
}

function restoreState() {
  try {
    if (location.hash.startsWith("#code=")) {
      applyState(decodeState(location.hash.slice(6)));
      return;
    }
    const saved = localStorage.getItem("wasmbolt-state-v2");
    if (saved) {
      applyState(JSON.parse(saved));
      return;
    }
  } catch (error) {
    console.warn("Could not restore WasmBolt state", error);
  }
  resetSource();
}

function configureResizers() {
  const workspace = $("#workspace");
  const vertical = $("#vertical-resizer");
  const horizontal = $("#horizontal-resizer");
  const advanced = $("#advanced");
  let expandedHeight = 160;

  const setAdvancedHeight = (height) => {
    expandedHeight = height;
    workspace.style.setProperty("--console-height", `${height}px`);
  };

  advanced.addEventListener("toggle", () => {
    workspace.style.setProperty("--console-height", advanced.open ? `${expandedHeight}px` : "38px");
  });
  workspace.style.setProperty("--console-height", advanced.open ? `${expandedHeight}px` : "38px");

  const begin = (event, orientation) => {
    if (innerWidth <= 900) return;
    event.preventDefault();
    const handle = orientation === "vertical" ? vertical : horizontal;
    if (orientation === "horizontal" && !advanced.open) advanced.open = true;
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add("dragging");
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const move = (moveEvent) => {
      const bounds = workspace.getBoundingClientRect();
      if (orientation === "vertical") {
        const percent = Math.max(24, Math.min(76, ((moveEvent.clientX - bounds.left) / bounds.width) * 100));
        document.documentElement.style.setProperty("--source-width", `${percent}%`);
      } else {
        const height = Math.max(110, Math.min(bounds.height - 260, bounds.bottom - moveEvent.clientY));
        setAdvancedHeight(height);
      }
    };
    const end = () => {
      handle.classList.remove("dragging");
      handle.releasePointerCapture?.(event.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  vertical.addEventListener("pointerdown", (event) => begin(event, "vertical"));
  horizontal.addEventListener("pointerdown", (event) => begin(event, "horizontal"));
}

function wireUi() {
  document.querySelectorAll("#tabs button").forEach((button) =>
    button.addEventListener("click", () => switchTab(button.dataset.tab)));
  elements.compile.addEventListener("click", compileSelectedOutput);
  elements.compileRun.addEventListener("click", compileAndRun);
  elements.loadWasm.addEventListener("click", loadExistingWasm);
  elements.execute.addEventListener("click", executeSymbol);
  elements.openFile.addEventListener("click", () => openWorkspaceFile());
  elements.downloadFile.addEventListener("click", downloadWorkspaceFile);
  elements.fileSelect.addEventListener("change", () => openWorkspaceFile());
  elements.symbol.addEventListener("change", configureSelectedSymbol);
  elements.signature.addEventListener("change", updateSignatureInputs);
  elements.language.addEventListener("change", resetSource);
  elements.source.addEventListener("input", () => {
    currentModulePath = "";
    wasmExportSignatures = new Map();
    elements.runner.classList.add("hidden");
    elements.result.textContent = "";
    saveState();
  });
  $("#clear-source").addEventListener("click", () => { elements.source.value = ""; elements.source.dispatchEvent(new Event("input")); elements.source.focus(); });
  $("#reset-source").addEventListener("click", resetSource);
  for (const select of [elements.optimization, elements.target])
    select.addEventListener("change", saveState);
  $("#clear-log").addEventListener("click", () => { elements.log.textContent = ""; });
  $("#copy-output").addEventListener("click", () => navigator.clipboard.writeText(elements.output.textContent));
  $("#share").addEventListener("click", shareState);
  elements.runCommand.addEventListener("click", () => {
    if (!elements.command.value.trim() || busy) return;
    const command = elements.command.value.trim();
    elements.command.value = "";
    setBusy(true, "Running command…");
    try {
      // Keep the virtual filesystem in sync with the visible editor so a raw
      // command works immediately after a fresh page load.
      writeSource();
      const captured = run(command);
      const outputPath = commandOutputPath(command);
      refreshWorkspaceFiles(outputPath);
      if (outputPath && outputPath !== "-" && workspaceFiles().includes(outputPath))
        openWorkspaceFile(outputPath);
      else if (captured.trim()) {
        outputs.analysis = captured;
        switchTab("analysis");
      }
      setStatus("Compiler ready");
    }
    catch (error) { appendLog(error.message, "err"); }
    finally {
      setBusy(false);
      elements.command.focus();
      const terminal = $("#terminal-scroll");
      terminal.scrollTop = terminal.scrollHeight;
    }
  });
  elements.command.addEventListener("keydown", (event) => {
    if (event.key === "Enter") elements.runCommand.click();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) elements.compileRun.click();
      else elements.compile.click();
    }
  });
  configureResizers();
  updateSignatureInputs();
  updateLanguageUi();
}

async function loadCompiler() {
  try {
    setStatus("Downloading Clang and LLVM…", "loading");
    const { default: createCompiler } = await import("./Compiler.js");
    compiler = await createCompiler({
      locateFile: (path) => new URL(path, import.meta.url).href,
      print: (line) => appendLog(line),
      printErr: (line) => appendLog(line, "err"),
      setStatus: (text) => { if (text) setStatus(text, "loading"); },
    });
    compiler.FS.mkdirTree("/workspace");
    compiler.FS.chdir("/workspace");
    writeSource();

    const version = compiler.ccall("wasmbolt_version", "string", [], []);
    const targets = compiler.ccall("available_targets", "string", [], []).split(",").filter(Boolean);
    const major = version.match(/LLVM (\d+)/)?.[1];
    if (major) resourceDir = `/lib/clang/${major}`;
    elements.version.textContent = version;
    elements.targets.textContent = `Backends: ${targets.join(", ")}`;

    const support = {
      "wasm32-unknown-emscripten": targets.some((name) => name.toLowerCase().includes("wasm")),
      "x86_64-unknown-linux-gnu": targets.some((name) => name.toLowerCase().includes("x86")),
      "aarch64-unknown-linux-gnu": targets.some((name) => name.toLowerCase().includes("aarch64")),
    };
    for (const option of elements.target.options) {
      option.disabled = !support[option.value];
      if (option.disabled) option.textContent += " (backend not packaged)";
    }
    if (elements.target.selectedOptions[0]?.disabled)
      elements.target.value = "wasm32-unknown-emscripten";

    elements.log.textContent = "";
    setBusy(false);
    setStatus("Compiler ready");
    const autorun = new URLSearchParams(location.search).get("autorun");
    if (autorun === "1" || autorun === "driver") {
      const settings = writeSource();
      outputs.ast = settings.llvmIr ? "LLVM IR input starts after the Clang AST stage." : run(commandText(settings, "ast"));
      emitIr(settings, elements.target.value);
      optimizeIr();
      renderCfg();
      emitAssembly();
      await compileAndRun();
      if (autorun === "driver") await loadExistingWasm();
      executeSymbol();
      const llvmIrInput = elements.language.value === "llvm";
      const frontendReady = llvmIrInput
        ? outputs.ir.includes("define i32 @absolute_difference")
        : outputs.ast.includes("FunctionDecl");
      const selectionDag = llvmIrInput
        ? run("llc -mtriple=wasm32-unknown-unknown -mattr=+simd128 -O2 -stop-after=finalize-isel -o - /workspace/input.ll")
        : "";
      let driverReady = true;
      if (autorun === "driver" && llvmIrInput) {
        run("llc -mtriple=wasm32-unknown-unknown -mattr=+simd128 -O2 -stop-before=finalize-isel -o /workspace/before-isel.mir /workspace/input.ll");
        run("llc -mtriple=wasm32-unknown-emscripten -O1 -filetype=asm -o /workspace/output-emscripten.s /workspace/input.ll");
        run("llc -mtriple=wasm32-unknown-unknown -O3 -filetype=asm -o /workspace/output-wasm.s /workspace/input.ll");
        driverReady = readText("/workspace/before-isel.mir").includes("name:            absolute_difference") &&
          readText("/workspace/output-emscripten.s").includes("absolute_difference") &&
          readText("/workspace/output-wasm.s").includes("absolute_difference");
        document.body.dataset.llcDriverTest = driverReady ? "passed" : "failed";
      }
      if (frontendReady && driverReady &&
          outputs.ir.includes("define") &&
          outputs.optimized.includes("define") &&
          elements.cfgImage.dataset.ready === "true" &&
          outputs.assembly.length > 0 &&
          (!llvmIrInput || selectionDag.includes("name:            absolute_difference")) &&
          elements.result.textContent === (llvmIrInput ? "Result: 1" : "Result: 60"))
        document.body.dataset.smokeTest = "passed";
    }
  } catch (error) {
    appendLog(error.stack || error.message, "err");
    setStatus("Compiler failed to load", "error");
  }
}

restoreState();
const requestedLanguage = new URLSearchParams(location.search).get("language");
if (["c", "cpp", "llvm"].includes(requestedLanguage)) {
  elements.language.value = requestedLanguage;
  resetSource();
}
wireUi();
switchTab("ir");
loadCompiler();
