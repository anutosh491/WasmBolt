import { installDebugger, prepareDebugger, workspaceExampleNames as debuggerExampleNames, loadWorkspaceExamples } from "../debugger/lldb/ui.js";
import { updateDebuggerTarget } from "./debugger-target.js";
import { installClangd } from "../language-services/clangd/ui.js";
import { examples } from "./examples.js";
import { publicFunctionExports, displayFunctionExport, parseWasmFunctionSignatures } from "../runtime/exports.js";
import { runTool, isToolCommand, workspaceFiles } from "../tools/client.js";
import { tokenize } from "../tools/registry.js";
import { prepareSwift, runSwift } from "../compilers/swift/client.js";
import { startSwiftRepl, evaluateSwiftRepl, stopSwiftRepl } from "../compilers/swift/repl.js";
import { driver as swiftDriver, link as swiftLink } from "../compilers/swift/commands.js";
import { runStandalone } from "../compilers/swift/runner.js";
import { createWorkspace, swiftExampleNames, loadSwiftExamples } from "../compilers/swift/workspace.js";

const $ = (selector) => document.querySelector(selector);
const swiftOnly = $('meta[name="wasmbolt-compiler"]')?.content === 'swift';
const debuggerEnabled = $('meta[name="wasmbolt-debugger"]')?.content === 'lldb';

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
  downloadFile: $("#download-file"),
  runner: $("#runner"),
  symbol: $("#symbol"),
  signature: $("#signature"),
  argA: $("#arg-a"),
  argB: $("#arg-b"),
  argAWrap: $("#arg-a-wrap"),
  argBWrap: $("#arg-b-wrap"),
  execute: $("#execute"),
  command: $("#command"),
  commandLine: $(".command-line"),
};

const swiftEnabled = !elements.language.querySelector('option[value="swift"]').disabled;
const workspaceExampleNames = [...(swiftOnly ? [] : debuggerExampleNames), ...(swiftEnabled ? swiftExampleNames : [])];

const outputs = {
  ast: "",
  sil: "",
  mlir: "Select MLIR and compile, or use mlir-opt from the advanced terminal.",
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
let activeStdoutCapture = null;
let activeStderrCapture = null;
let activeTab = "ir";
let sourcePath = "";
const sourceBreakpoints = new Map();
const defaultSources = new Map([
  ...(swiftOnly ? [] : [["/workspace/snippet.cpp", examples.cpp], ["/workspace/input.mlir", examples.mlir]]),
]);
const workspaceSources = new Map(defaultSources);
let debuggerUi = null;
let debugLocation = null;
let resourceDir = "/lib/clang/23";
let runtimeTriple = "wasm32-unknown-emscripten";
let runtimeVersion = "LLVM 23.1.2", targetSupport = {};
let currentModulePath = "";
let buildNumber = 0;
let busy = false;
let cfgObjectUrl = "";
let wasmExportSignatures = new Map();
let selectedSignature = null;
let lastExecutionResult = null;
function appendLog(line, kind = "out") {
  const text = String(line ?? "");
  const rendered = `${kind === "err" ? "[stderr] " : ""}${text}`;
  if (activeCapture) {
    activeCapture.push(text);
    activeLogCapture.push(rendered);
    (kind === "err" ? activeStderrCapture : activeStdoutCapture).push(text);
    return;
  }
  elements.log.append(`${rendered}\n`);
  const terminal = $("#terminal-scroll");
  if (terminal) terminal.scrollTop = terminal.scrollHeight;
}

function capturedStreamText(chunks) {
  let result = "";
  let previous = "";
  for (const chunk of chunks) {
    const current = String(chunk ?? "");
    const addition = previous && current.startsWith(previous)
      ? current.slice(previous.length)
      : current;
    if (addition) result += `${result ? "\n" : ""}${addition}`;
    previous = current;
  }
  return result;
}

function setStatus(text, state = "ready") {
  elements.status.textContent = text;
  elements.statusDot.className = `status-dot ${state === "ready" ? "" : state}`;
}

function setBusy(value, message = "Working…") {
  busy = value;
  for (const button of [elements.compile, elements.compileRun, elements.loadWasm])
    button.disabled = value || !compiler ||
      (button === elements.compileRun && elements.language.value === "mlir");
  elements.command.disabled = !compiler;
  elements.execute.disabled = value || !selectedSignature || !currentModulePath;
  $("#new-file").disabled = value || !compiler;
  $("#debugger-target").disabled = value || !compiler;
  if (value) setStatus(message, "loading");
  debuggerUi?.update();
}

function languageSettings() {
  if (elements.language.value === "swift") {
    return { driver: "swiftc", filename: sourcePath || "/workspace/fibonacci.swift",
      label: "fibonacci.swift", swift: true };
  }
  if (elements.language.value === "mlir") {
    return {
      driver: "mlir-opt",
      filename: sourcePath || "/workspace/input.mlir",
      label: "input.mlir",
      standard: "",
      x: "",
      mlir: true,
    };
  }
  if (elements.language.value === "llvm") {
    return {
      driver: "",
      filename: sourcePath || "/workspace/debug.ll",
      label: "debug.ll",
      standard: "",
      x: "",
      llvmIr: true,
    };
  }
  const cpp = elements.language.value === "cpp";
  return {
    driver: cpp ? "clang++" : "clang",
    filename: sourcePath || (cpp ? "/workspace/snippet.cpp" : "/workspace/simple.c"),
    label: cpp ? "snippet.cpp" : "simple.c",
    standard: cpp ? "-std=c++23" : "-std=c23",
    x: cpp ? "c++" : "c",
  };
}

function writeSource() {
  const settings = languageSettings();
  elements.filename.textContent = settings.filename.replace("/workspace/", "");
  workspaceSources.set(settings.filename, elements.source.value);
  if (compiler) {
    compiler.FS.mkdirTree(settings.filename.slice(0, settings.filename.lastIndexOf("/")));
    compiler.FS.writeFile(settings.filename, elements.source.value);
  }
  refreshWorkspaceFiles(settings.filename);
  return settings;
}

function readText(path) {
  return compiler ? compiler.FS.readFile(path, { encoding: "utf8" }) : workspaceSources.get(path);
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

async function renderCfg() {
  for (const path of workspaceFiles(compiler.FS)) {
    if (path.endsWith(".dot") || path === "/workspace/cfg.svg")
      removeIfPresent(path);
  }
  await run("opt -passes=dot-cfg -disable-output /workspace/optimized.ll");
  const dotPath = workspaceFiles(compiler.FS).find((path) => path.endsWith(".dot"));
  if (!dotPath) throw new Error("opt did not emit a CFG DOT file");
  await renderDot(dotPath, "/workspace/cfg.svg", `LLVM CFG from ${dotPath}`);
}

async function renderMlirCfg() {
  const dotPath = "/workspace/mlir-cfg.dot";
  removeIfPresent(dotPath);
  await run("mlir-opt --view-op-graph='print-data-flow-edges=false print-control-flow-edges=true' /workspace/optimized.mlir -o /dev/null",
    { stderr: dotPath });
  await renderDot(dotPath, "/workspace/mlir-cfg.svg", "MLIR operation graph with control-flow edges");
}

async function renderDot(dotPath, svgPath, description) {
  removeIfPresent(svgPath);
  await run(`dot -Tsvg ${dotPath} -o ${svgPath}`);
  const svg = readText(svgPath);
  if (!svg) throw new Error("Graphviz did not render the CFG");
  if (cfgObjectUrl) URL.revokeObjectURL(cfgObjectUrl);
  cfgObjectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  elements.cfgImage.src = cfgObjectUrl;
  elements.cfgImage.dataset.ready = "true";
  elements.cfgImage.alt = description;
  outputs.cfg = `${description}, rendered by Graphviz in a Worker`;
  refreshWorkspaceFiles(svgPath);
}

function refreshWorkspaceFiles(preferred = "") {
  const files = compiler ? workspaceFiles(compiler.FS)
    : [...new Set([...(workspaceExampleNames).map(name => `/workspace/${name}`), ...workspaceSources.keys()])].sort();
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
        const size = compiler ? compiler.FS.stat(path).size
          : new TextEncoder().encode(workspaceSources.get(path) || "").length;
        return `${path.replace("/workspace/", "").padEnd(28)} ${String(size).padStart(9)} bytes`;
      }).join("\n")
    : "The browser filesystem is empty.";
  if (activeTab === "files") elements.output.textContent = outputs.files;
  renderExplorer(files);
  if (debuggerUi) debuggerUi.update();
  else updateDebuggerTarget(files, languageSettings().filename);
}

function renderSourceGutter() {
  const path = languageSettings().filename;
  const lines = sourceBreakpoints.get(path) || new Set();
  sourceBreakpoints.set(path, lines);
  const count = elements.source.value.split("\n").length;
  for (const line of lines) if (line > count) lines.delete(line);
  $("#source-gutter").replaceChildren(...Array.from({ length: count }, (_, index) => {
    const line = index + 1;
    const button = document.createElement("button");
    button.textContent = String(line);
    button.dataset.line = line;
    button.classList.toggle("current-line", debugLocation?.path === path && debugLocation.line === line);
    button.setAttribute("aria-label", `Breakpoint at line ${line}`);
    button.setAttribute("aria-pressed", String(lines.has(line)));
    button.addEventListener("click", () => {
      if (lines.has(line)) lines.delete(line); else lines.add(line);
      button.setAttribute("aria-pressed", String(lines.has(line)));
      debuggerUi?.syncBreakpoints(path, [...lines]);
    });
    return button;
  }));
  $("#source-gutter").scrollTop = elements.source.scrollTop;
}

function renderExplorer(files) {
  $("#workspace-files").replaceChildren(...files.map((path) => {
    const button = document.createElement("button");
    button.textContent = path.replace("/workspace/", "");
    button.title = path;
    button.disabled = !compiler && !workspaceSources.has(path);
    const extension = path.split(".").pop().toLowerCase();
    button.dataset.kind = ({ c: "C", cc: "C++", cpp: "C++", cxx: "C++", swift: "S", ll: "IR", mlir: "ML", wasm: "W" })[extension] || "·";
    button.setAttribute("aria-current", String(path === languageSettings().filename));
    button.addEventListener("click", () => editWorkspaceFile(path));
    return button;
  }));
}

function editWorkspaceFile(path) {
  if (busy || (!compiler && !workspaceSources.has(path))) return;
  const language = /\.c$/i.test(path) ? "c" : /\.(cc|cpp|cxx)$/i.test(path) ? "cpp"
    : /\.ll$/i.test(path) ? "llvm" : /\.mlir$/i.test(path) ? "mlir"
    : /\.swift$/i.test(path) ? "swift" : "";
  if (!language || (swiftOnly && language !== 'swift')) {
    toggleDebugger(false); openWorkspaceFile(path); return;
  }
  // Save the editor before switching files, including edits never compiled.
  writeSource();
  sourcePath = path;
  elements.language.value = language;
  elements.source.value = readText(path);
  elements.source.dispatchEvent(new Event("input"));
  elements.filename.textContent = path.replace("/workspace/", "");
  refreshWorkspaceFiles(path);
  updateLanguageUi();
}

function toggleDebugger(visible) {
  $("#debugger-panel").classList.toggle("hidden", !visible);
  $(".output-pane").classList.toggle("hidden", visible);
  $("#toggle-debugger").setAttribute("aria-expanded", String(visible));
  if (visible && debuggerEnabled) {
    if (debuggerUi) debuggerUi.preload();
    else prepareDebugger();
  }
}

function isTextFile(path) {
  return /\.(?:c|cc|cpp|cxx|h|hpp|swift|sil|mlir|ll|mir|s|dot|svg|txt|json)$/i.test(path);
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
  const bytes = compiler ? compiler.FS.readFile(path)
    : new TextEncoder().encode(workspaceSources.get(path) || "");
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
  const compileTarget = action === "object" ? runtimeTriple : target;
  const systemIncludes = compileTarget.startsWith("wasm") ? [
      "-isystem /include/wasm32-emscripten/c++/v1",
      "-isystem /include/c++/v1",
      `-isystem ${resourceDir}/include`,
      "-isystem /include/wasm32-emscripten",
      "-Xclang -iwithsysroot/include/compat",
      "-isystem /include",
    ].join(" ") : `-isystem ${resourceDir}/include`;
  const common = settings.llvmIr
    ? "clang -x ir -fno-color-diagnostics"
    : `${settings.driver} -x ${settings.x} ${settings.standard} -fno-color-diagnostics -resource-dir=${resourceDir} ${systemIncludes}`;
  if (action === "ast")
    return `${common} -fsyntax-only -Xclang -ast-dump ${settings.filename}`;
  if (action === "ir")
    return `${common} --target=${compileTarget} -O0 -Xclang -disable-O0-optnone -S -emit-llvm ${settings.filename} -o /workspace/source.ll`;
  if (action === "optimized")
    return `${common} --target=${compileTarget} -O${elements.optimization.value} -Xclang -disable-O0-optnone -S -emit-llvm ${settings.filename} -o /workspace/optimized.ll`;
  if (action === "assembly")
    return `${common} --target=${compileTarget} -O${elements.optimization.value} -S ${settings.filename} -o /workspace/output.s`;
  if (action === "object")
    return `${common} --target=${runtimeTriple} -fPIC -fwasm-exceptions -O${elements.optimization.value} -c ${settings.filename} -o /workspace/program.o`;
  throw new Error(`Unknown action ${action}`);
}

async function run(command, redirects = {}) {
  appendLog("");
  const argv = tokenize(command);
  const swiftCommand = ['swift', 'swiftc', 'swift-frontend'].includes(argv[0]) ||
    (argv[0] === 'wasm-ld' && elements.language.value === 'swift');
  if (swiftCommand) appendLog(`$ ${command}`);
  activeCapture = [];
  activeLogCapture = [];
  activeStdoutCapture = [];
  activeStderrCapture = [];
  let code;
  let captured;
  let capturedLog;
  let capturedStdout;
  let capturedStderr;
  try {
    if (swiftCommand) {
      const result = await runSwift(argv, compiler.FS);
      for (const line of result.stdout) appendLog(line);
      for (const line of result.stderr) appendLog(line, "err");
      code = result.code;
    } else if (isToolCommand(command)) {
      appendLog(`$ ${command}`);
      const result = await runTool(command, compiler.FS);
      for (const line of result.stdout) appendLog(line);
      for (const line of result.stderr) appendLog(line, "err");
      if (result.error && !result.stderr.length) appendLog(result.error, "err");
      code = result.status;
    } else {
      code = compiler.ccall("run_command", "number", ["string"], [command]);
    }
    captured = activeCapture.join("\n");
  } finally {
    capturedLog = activeLogCapture.join("\n");
    capturedStdout = activeStdoutCapture.join("\n");
    capturedStderr = activeStderrCapture.join("\n");
    activeCapture = null;
    activeLogCapture = null;
    activeStdoutCapture = null;
    activeStderrCapture = null;
    if (redirects.stdout)
      compiler.FS.writeFile(redirects.stdout, `${capturedStdout}\n`);
    if (redirects.stderr)
      compiler.FS.writeFile(redirects.stderr, `${capturedStderr}\n`);
    if (!redirects.stdout && !redirects.stderr && capturedLog)
      appendLog(capturedLog);
    else {
      if (!redirects.stdout && capturedStdout) appendLog(capturedStdout);
      if (!redirects.stderr && capturedStderr) appendLog(capturedStderr, "err");
    }
  }
  if (code !== 0) {
    const detail = capturedLog?.trim();
    throw new Error(detail || `Command failed with exit code ${code}`);
  }
  return captured;
}

function parseCommandRedirections(command) {
  const redirects = {};
  let executable = command;
  const stderr = executable.match(/(?:^|\s)2>\s*(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (stderr) {
    redirects.stderr = stderr[1] || stderr[2] || stderr[3];
    executable = `${executable.slice(0, stderr.index)} ${executable.slice(stderr.index + stderr[0].length)}`;
  }
  return { command: executable.trim(), redirects };
}

async function emitIr(settings, target) {
  if (settings.llvmIr) {
    compiler.FS.writeFile("/workspace/source.ll", elements.source.value);
    outputs.ir = readText("/workspace/source.ll");
  } else {
    await emitClangOutput(settings, "ir", target);
  }
  return outputs.ir;
}

async function emitClangOutput(settings, stage, target = elements.target.value) {
  const path = {
    ir: "/workspace/source.ll",
    optimized: "/workspace/optimized.ll",
    assembly: "/workspace/output.s",
  }[stage];
  removeIfPresent(path);
  await run(commandText(settings, stage, target));
  outputs[stage] = readText(path);
  return outputs[stage];
}

async function compileSelectedOutput() {
  if (busy) return;
  let stage = activeTab === "files" ? "ir" : activeTab;
  if (stage === "wasm" && elements.language.value !== "swift") stage = "ir";
  if (elements.language.value === "mlir" && stage !== "cfg") stage = "mlir";
  setBusy(true, `Compiling ${stage === "cfg" ? "control-flow graph" : stage}…`);
  try {
    const settings = writeSource();
    if (settings.swift) {
      if (stage === "cfg") {
        await emitSwiftOutput(settings, "optimized");
        await renderCfg();
      } else if (stage === "wasm") {
        await buildSwift(settings, "/workspace/simple.wasm");
        await activateWasm("/workspace/simple.wasm");
      } else await emitSwiftOutput(settings, stage);
    } else if (settings.mlir) {
      removeIfPresent("/workspace/optimized.mlir");
      await run("mlir-opt --pass-pipeline=builtin.module(canonicalize,cse) /workspace/input.mlir -o /workspace/optimized.mlir");
      outputs.mlir = readText("/workspace/optimized.mlir");
      if (stage === "cfg") await renderMlirCfg();
    } else if (stage === "ast") {
      if (settings.llvmIr) throw new Error("Clang AST is not applicable to LLVM IR input");
      outputs.ast = await run(commandText(settings, "ast"));
    } else if (stage === "cfg") {
      await emitClangOutput(settings, "optimized");
      await renderCfg();
    } else if (stage === "optimized" || stage === "assembly") {
      await emitClangOutput(settings, stage);
    } else {
      await emitIr(settings, elements.target.value);
    }
    switchTab(stage);
    refreshWorkspaceFiles();
    setStatus("Compiler ready");
  } catch (error) {
    appendLog(error.message, "err");
    if (elements.language.value === "mlir") {
      outputs.mlir = error.stack || error.message;
      switchTab("mlir");
    }
    setStatus("Compilation failed", "error");
  } finally {
    setBusy(false);
  }
}

async function emitSwiftOutput(settings, stage) {
  const stages = { ast: ['-dump-ast', '/workspace/ast.txt'],
    sil: ['-emit-sil', '/workspace/output.sil'],
    ir: ['-emit-ir', '/workspace/source.ll'],
    optimized: ['-emit-ir', '/workspace/optimized.ll'],
    assembly: ['-S', '/workspace/output.s'] };
  const [action, path] = stages[stage] || stages.ir;
  const args = [...swiftDriver(stage === 'ir' ? '0' : elements.optimization.value),
    action, settings.filename];
  if (stage !== 'ast') { removeIfPresent(path); args.push('-o', path); }
  const captured = await run(args.join(' '), stage === 'ast' ? { stdout: path } : {});
  outputs[stage] = stage === 'ast' ? captured : readText(path);
}

async function buildSwift(settings, output, debug = false) {
  const object = debug ? '/workspace/debug.o' : '/workspace/program.o';
  removeIfPresent(object); removeIfPresent(output);
  await run([...swiftDriver(elements.optimization.value, debug),
    '-c', settings.filename, '-o', object].join(' '));
  await run(swiftLink(object, output).join(' '));
}

async function inspectWasm(path) {
  const bytes = compiler.FS.readFile(path);
  const module = await WebAssembly.compile(bytes);
  const allExports = WebAssembly.Module.exports(module);
  const functions = publicFunctionExports(allExports)
    .filter(name => elements.language.value !== 'swift' || !/^(swift_|\$s)/.test(name));
  if (allExports.some(entry => entry.name === '__main_argc_argv'))
    functions.unshift('__main_argc_argv');
  wasmExportSignatures = parseWasmFunctionSignatures(bytes);

  elements.symbol.replaceChildren();
  for (const name of functions) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = displayFunctionExport(name);
    elements.symbol.append(option);
  }
  const preferred = functions.find((name) => name === "main") ||
    functions.find((name) => name === "__main_argc_argv") ||
    functions.find((name) => name === "square_plus_one") || functions[0];
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
  const wasmFiles = workspaceFiles(compiler.FS).filter((path) => path.endsWith(".wasm"));
  const path = selected.endsWith(".wasm") ? selected : wasmFiles.at(-1);
  if (!path) {
    setStatus("No .wasm file exists in /workspace", "error");
    switchTab("files");
    return;
  }
  setBusy(true, `Loading ${path.split("/").pop()}…`);
  lastExecutionResult = null;
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
  if (elements.language.value === "mlir") {
    setStatus("Use Compile or the advanced mlir-opt pipeline for MLIR input", "error");
    return;
  }
  setBusy(true, "Building a dynamically loadable Wasm module…");
  lastExecutionResult = null;
  try {
    const settings = writeSource();
    if (settings.swift) {
      currentModulePath = `/workspace/program-${++buildNumber}.wasm`;
      await buildSwift(settings, currentModulePath);
      await activateWasm(currentModulePath);
      await executeSymbol();
      return;
    }
    removeIfPresent("/workspace/program.o");
    await run(commandText(settings, "object"));

    currentModulePath = `/workspace/program-${++buildNumber}.wasm`;
    const link = [
      "wasm-ld", "-shared", "--export-all",
      "--unresolved-symbols=import-dynamic", "/workspace/program.o",
      "-o", currentModulePath,
    ].filter(Boolean).join(" ");
    await run(link);
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

function updateSignatureInputs(argumentsCount = 0) {
  elements.argAWrap.classList.toggle("hidden", argumentsCount < 1);
  elements.argBWrap.classList.toggle("hidden", argumentsCount < 2);
}

async function executeSymbol() {
  if (!currentModulePath || !elements.symbol.value || !selectedSignature) return;
  const { code: signature, argumentsCount, entryPoint } = selectedSignature;
  const a = Number(elements.argA.value || 0);
  const b = Number(elements.argB.value || 0);
  const arguments_ = entryPoint ? [] : [a, b].slice(0, argumentsCount);
  const displayName = displayFunctionExport(elements.symbol.value).replace(/ \(C\+\+:.*\)$/, "");
  appendLog(`wasmbolt % ${displayName}(${arguments_.join(", ")})`);
  if (wasmExportSignatures.has('_start')) {
    const result = await runStandalone(compiler.FS.readFile(currentModulePath),
      currentModulePath, elements.symbol.value,
      { results: signature < 6 ? ['i32'] : [] }, [a, b].slice(0, argumentsCount));
    if (result.stdout) appendLog(result.stdout.trimEnd());
    if (result.stderr) appendLog(result.stderr.trimEnd(), 'err');
    if (result.value.status !== 'success') throw new Error(result.value.message);
    lastExecutionResult = result.value.value;
    if (!entryPoint) appendLog(String(lastExecutionResult));
    return;
  }
  const result = callSelectedSymbol(signature, entryPoint ? 0 : a, entryPoint ? 0 : b);
  lastExecutionResult = result;
  if (!entryPoint)
    appendLog(Number.isNaN(result) ? "Execution failed" : String(result), Number.isNaN(result) ? "err" : "out");
}

function callSelectedSymbol(signature, a, b) {
  activeCapture = [];
  activeLogCapture = [];
  activeStdoutCapture = [];
  activeStderrCapture = [];
  let capturedStdout;
  let capturedStderr;
  try {
    return compiler.ccall(
      "load_and_call_numeric",
      "number",
      ["string", "string", "number", "number", "number"],
      [currentModulePath, elements.symbol.value, signature, a, b],
    );
  } finally {
    capturedStdout = capturedStreamText(activeStdoutCapture);
    capturedStderr = capturedStreamText(activeStderrCapture);
    activeCapture = null;
    activeLogCapture = null;
    activeStdoutCapture = null;
    activeStderrCapture = null;
    if (capturedStdout) appendLog(capturedStdout);
    if (capturedStderr) appendLog(capturedStderr, "err");
  }
}

function configureSelectedSymbol() {
  const name = elements.symbol.value;
  const callableSignatures = new Map([
    ["i32()", { code: 0, argumentsCount: 0 }],
    ["i32(i32)", { code: 1, argumentsCount: 1 }],
    ["i32(i32, i32)", { code: 2, argumentsCount: 2 }],
    ["f64()", { code: 3, argumentsCount: 0 }],
    ["f64(f64)", { code: 4, argumentsCount: 1 }],
    ["f64(f64, f64)", { code: 5, argumentsCount: 2 }],
    ["void()", { code: 6, argumentsCount: 0 }],
  ]);
  const detected = wasmExportSignatures.get(name);
  const entryPoint = ['main', '__main_argc_argv'].includes(name) && /^i32\(i32, i(?:32|64)\)$/.test(detected);
  const callable = entryPoint ? { code: 7, argumentsCount: 0 } : callableSignatures.get(detected);
  selectedSignature = callable
    ? { ...callable, argumentsCount: entryPoint ? 0 : callable.argumentsCount, entryPoint }
    : null;
  elements.signature.textContent = detected || "unavailable";
  elements.signature.title = entryPoint
    ? "Emscripten lowers main to the argc/argv WebAssembly entry-point ABI"
    : detected ? "Read from the Wasm type section" : "No Wasm function type was found";
  elements.execute.disabled = busy || !selectedSignature;
  elements.execute.title = detected && !selectedSignature
    ? `Execution is not yet supported for ${detected}`
    : "";
  updateSignatureInputs(selectedSignature?.argumentsCount || 0);
}

function resetSource() {
  sourcePath = "";
  const language = elements.language.value;
  elements.source.value = defaultSources.get(languageSettings().filename) ?? examples[language] ?? "";
  elements.filename.textContent = languageSettings().label;
  currentModulePath = "";
  wasmExportSignatures = new Map();
  selectedSignature = null;
  lastExecutionResult = null;
  elements.runner.classList.add("hidden");
  saveState();
  updateLanguageUi();
  writeSource();
  renderSourceGutter();
}

function updateLanguageUi() {
  if (!debuggerUi) updateDebuggerTarget(compiler ? workspaceFiles(compiler.FS) : [], languageSettings().filename);
  const isSwift = elements.language.value === "swift";
  const isLlvmIr = elements.language.value === "llvm";
  const isMlir = elements.language.value === "mlir";
  const astTab = document.querySelector('[data-tab="ast"]');
  const mlirTab = document.querySelector('[data-tab="mlir"]');
  astTab.disabled = isLlvmIr || isMlir;
  mlirTab.disabled = !isMlir;
  document.querySelector('[data-tab="sil"]').classList.toggle('hidden', !isSwift);
  if (!isSwift && activeTab === 'sil') switchTab('ir');
  if (isSwift && !elements.target.querySelector('option[value="wasm32-unknown-emscripten"]'))
    elements.target.add(new Option('WebAssembly 32', 'wasm32-unknown-emscripten'));
  for (const option of elements.target.options)
    option.disabled = isSwift ? option.value !== 'wasm32-unknown-emscripten'
      : compiler && !targetSupport[option.value];
  if (isSwift) elements.target.value = 'wasm32-unknown-emscripten';
  else if (elements.target.selectedOptions[0]?.disabled) elements.target.value = runtimeTriple;
  for (const option of elements.optimization.options)
    { option.textContent = isSwift ? ({0: 'Onone', 1: 'O', 2: 'O', 3: 'Osize'})[option.value] : `O${option.value}`;
      option.hidden = isSwift && option.value === '1'; }
  if (isSwift && elements.optimization.value === '1') elements.optimization.value = '2';
  if (isSwift && compiler) prepareSwift().catch(error => setStatus(error.message, 'error'));
  elements.version.textContent = isSwift ? 'Swift 6.5-dev · wasm32'
    : `${runtimeVersion} · ${document.body.dataset.runtimeArch || 'wasm32'}`;
  elements.compileRun.disabled = !compiler || busy || isMlir;
  elements.compileRun.title = isMlir
    ? "MLIR execution requires an explicit lowering and execution pipeline"
    : "Compile, link, load and execute WebAssembly";
  if (isMlir && activeTab !== "mlir") switchTab("mlir");
  if (!isMlir && activeTab === "mlir") switchTab("ir");
  if (isLlvmIr && activeTab === "ast") switchTab("ir");
  debuggerUi?.update();
}

function serializableState() {
  return {
    source: elements.source.value,
    sourcePath,
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
  if (state.language && ![...elements.language.options].some(option => option.value === state.language && !option.disabled)) {
    resetSource(); return;
  }
  for (const key of ["language", "optimization", "target"])
    if (state[key] && elements[key]) elements[key].value = state[key];
  if (/^\/workspace\/[\w./-]+$/.test(state.sourcePath || "") && !state.sourcePath.split("/").includes("..")) sourcePath = state.sourcePath;
  if (typeof state.source === "string") elements.source.value = state.source;
  elements.filename.textContent = languageSettings().filename.replace("/workspace/", "");
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
  let expandedHeight = 260;

  const setAdvancedHeight = (height) => {
    expandedHeight = height;
    workspace.style.setProperty("--console-height", `${height}px`);
  };

  advanced.addEventListener("toggle", () => {
    workspace.style.setProperty("--console-height", advanced.open ? `${expandedHeight}px` : "38px");
    if (advanced.open) requestAnimationFrame(() => {
      const terminal = $("#terminal-scroll");
      terminal.scrollTop = terminal.scrollHeight;
    });
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
        const percent = Math.max(24, Math.min(76, ((moveEvent.clientX - $(".source-pane").getBoundingClientRect().left) / (bounds.width - $(".explorer").getBoundingClientRect().width)) * 100));
        document.documentElement.style.setProperty("--source-ratio", String(percent / 100));
      } else {
        const height = Math.max(220, Math.min(bounds.height - 260, bounds.bottom - moveEvent.clientY));
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
  renderSourceGutter();
  elements.source.addEventListener("scroll", () => { $("#source-gutter").scrollTop = elements.source.scrollTop; });
  $("#toggle-debugger").addEventListener("click", () => toggleDebugger($("#toggle-debugger").getAttribute("aria-expanded") !== "true"));
  $("#debugger-target").addEventListener("change", () => refreshWorkspaceFiles());
  $("#close-debugger").addEventListener("click", () => toggleDebugger(false));
  $("#new-file").addEventListener("click", () => {
    if (!compiler || busy) return;
    const name = prompt("Source filename (.c, .cpp, .ll, .mlir or .swift)", swiftOnly ? "example.swift" : "example.cpp");
    if (name === null) return;
    if (!/^[\w-]+\.(c|cc|cpp|cxx|ll|mlir|swift)$/i.test(name)) { alert("Use a source filename with letters, digits, hyphens or underscores."); return; }
    const path = `/workspace/${name}`;
    if (workspaceFiles(compiler.FS).includes(path)) { editWorkspaceFile(path); return; }
    compiler.FS.writeFile(path, "");
    editWorkspaceFile(path);
  });
  document.querySelectorAll("#tabs button").forEach((button) =>
    button.addEventListener("click", () => switchTab(button.dataset.tab)));
  elements.compile.addEventListener("click", compileSelectedOutput);
  elements.compileRun.addEventListener("click", compileAndRun);
  elements.loadWasm.addEventListener("click", loadExistingWasm);
  elements.execute.addEventListener("click", async () => {
    setBusy(true, 'Running WebAssembly…');
    try { await executeSymbol(); setStatus('Compiler ready'); }
    catch (error) { appendLog(error.message, 'err'); setStatus('Execution failed', 'error'); }
    finally { setBusy(false); }
  });
  elements.downloadFile.addEventListener("click", downloadWorkspaceFile);
  elements.fileSelect.addEventListener("change", () => openWorkspaceFile());
  elements.symbol.addEventListener("change", configureSelectedSymbol);
  elements.language.addEventListener("change", resetSource);
  elements.source.addEventListener("input", () => {
    currentModulePath = "";
    wasmExportSignatures = new Map();
    lastExecutionResult = null;
    elements.runner.classList.add("hidden");
    saveState();
    renderSourceGutter();
  });
  $("#clear-source").addEventListener("click", () => { elements.source.value = ""; elements.source.dispatchEvent(new Event("input")); elements.source.focus(); });
  $("#reset-source").addEventListener("click", resetSource);
  for (const select of [elements.optimization, elements.target])
    select.addEventListener("change", saveState);
  $("#clear-log").addEventListener("click", () => { elements.log.textContent = ""; });
  $("#copy-output").addEventListener("click", () => navigator.clipboard.writeText(elements.output.textContent));
  $("#share").addEventListener("click", shareState);
  elements.commandLine.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!elements.command.value.trim() || busy || !compiler) return;
    const command = elements.command.value.trim();
    elements.command.value = "";
    setBusy(true, "Running command…");
    try {
      if (swiftReplActive || /^swift(?:\s+(?:-repl|repl))?$/.test(command)) {
        await runReplInput(command);
        return;
      }
      // Keep the virtual filesystem in sync with the visible editor so a raw
      // command works immediately after a fresh page load.
      writeSource();
      const parsed = parseCommandRedirections(command);
      const captured = await run(parsed.command, parsed.redirects);
      const outputPath = parsed.redirects.stderr ||
        commandOutputPath(parsed.command);
      refreshWorkspaceFiles(outputPath);
      if (outputPath && outputPath !== "-" && workspaceFiles(compiler.FS).includes(outputPath))
        openWorkspaceFile(outputPath);
      else if (captured.trim()) {
        outputs.analysis = captured;
        switchTab("analysis");
      }
      setStatus("Compiler ready");
    }
    catch (error) { appendLog(error.message, "err"); setStatus("Command failed", "error"); }
    finally {
      setBusy(false);
      elements.command.focus();
      const terminal = $("#terminal-scroll");
      terminal.scrollTop = terminal.scrollHeight;
    }
  });
  elements.command.addEventListener("keydown", (event) => {
    if (swiftReplActive && event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      swiftReplActive = false;
      stopSwiftRepl();
      appendLog('Swift REPL interrupted. Enter swift to start again.');
      $(".command-line > span").textContent = 'wasmbolt %';
      setStatus('Compiler ready');
    }
  });
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) elements.compileRun.click();
      else elements.compile.click();
    }
  });
  configureResizers();
  updateSignatureInputs(0);
  updateLanguageUi();
}

let swiftReplActive = false;
async function runReplInput(source) {
  appendLog(`${swiftReplActive ? 'swift>' : '$'} ${source}`);
  if (!swiftReplActive && !$('meta[name="wasmbolt-swift-repl"]'))
    throw new Error('Swift REPL is not installed in this build.');
  let result;
  try {
    if (swiftReplActive && /^:(?:quit|exit|q)$/.test(source)) {
      stopSwiftRepl(); swiftReplActive = false;
    } else if (!swiftReplActive || source === ':reset') {
      if (source === ':reset') stopSwiftRepl();
      result = await startSwiftRepl();
      swiftReplActive = true;
    } else {
      result = await evaluateSwiftRepl(source);
    }
    for (const line of result?.stdout || []) appendLog(line);
    for (const line of result?.stderr || []) appendLog(line, 'err');
    if (result?.code === 2) {
      stopSwiftRepl(); swiftReplActive = false;
      appendLog('Swift REPL stopped after an execution failure.', 'err');
    }
  } catch (error) {
    stopSwiftRepl(); swiftReplActive = false;
    if (error.message === 'Swift REPL stopped') return;
    throw error;
  } finally {
    $(".command-line > span").textContent = swiftReplActive ? (result?.incomplete ? '…>' : 'swift>') : 'wasmbolt %';
  }
  setStatus(swiftReplActive ? 'Swift REPL ready' : 'Compiler ready');
}

async function loadCompiler(workspaceReady) {
  try {
    setStatus(swiftOnly ? "Loading Swift compiler and SDK…" : "Downloading Clang and LLVM…", "loading");
    let loadedCompiler;
    if (swiftOnly) {
      loadedCompiler = { FS: createWorkspace() };
      await prepareSwift();
    } else {
      const { default: createCompiler } = await import("../runtime/Compiler.js");
      loadedCompiler = await createCompiler({
      locateFile: (path) => new URL(`../runtime/${path}`, import.meta.url).href,
      print: (line) => appendLog(line),
      printErr: (line) => appendLog(line, "err"),
      setStatus: (text) => { if (text) setStatus(text, "loading"); },
    });
    }
    await workspaceReady;
    compiler = loadedCompiler;
    compiler.FS.mkdirTree("/workspace");
    compiler.FS.chdir("/workspace");
    for (const [path, source] of workspaceSources) {
      compiler.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      compiler.FS.writeFile(path, source);
    }
    writeSource();

    const version = swiftOnly ? "Swift 6.5-dev" : compiler.ccall("wasmbolt_version", "string", [], []);
    runtimeVersion = version;
    const targets = swiftOnly ? ['wasm32'] : compiler.ccall("available_targets", "string", [], []).split(",").filter(Boolean);
    const major = version.match(/LLVM (\d+)/)?.[1];
    if (major) resourceDir = `/lib/clang/${major}`;
    const bits = swiftOnly ? 32 : compiler.ccall("wasmbolt_pointer_bits", "number", [], []);
    runtimeTriple = `wasm${bits}-unknown-emscripten`;
    document.body.dataset.runtimeArch = `wasm${bits}`;
    const wasmOption = elements.target.querySelector('option[value^="wasm"]');
    const wasSelected = wasmOption.selected;
    wasmOption.value = runtimeTriple;
    wasmOption.textContent = `WebAssembly ${bits}`;
    if (wasSelected) elements.target.value = runtimeTriple;
    elements.version.textContent = `${version} · wasm${bits}`;
    elements.targets.textContent = `Backends: ${targets.join(", ")}`;

    targetSupport = {
      [runtimeTriple]: targets.some((name) => name.toLowerCase().includes("wasm")),
      "x86_64-unknown-linux-gnu": targets.some((name) => name.toLowerCase().includes("x86")),
      "aarch64-unknown-linux-gnu": targets.some((name) => name.toLowerCase().includes("aarch64")),
    };
    for (const option of elements.target.options) {
      option.disabled = !targetSupport[option.value];
      if (option.disabled) option.textContent += " (backend not packaged)";
    }
    if (elements.target.selectedOptions[0]?.disabled)
      elements.target.value = runtimeTriple;

    elements.log.textContent = "";
    setBusy(false);
    setStatus("Compiler ready");
    if (!swiftOnly) installClangd({
      FS: compiler.FS,
      get resourceDir() { return resourceDir; },
      source: () => ({ path: languageSettings().filename, text: elements.source.value,
        language: elements.language.value, target: elements.target.value }),
      files: () => workspaceFiles(compiler.FS),
      open: editWorkspaceFile,
    });
    if (debuggerEnabled) debuggerUi = await installDebugger({
      FS: compiler.FS, source: writeSource, open: editWorkspaceFile, run,
      files: () => workspaceFiles(compiler.FS),
      sourceName: () => languageSettings().filename,
      refresh: () => refreshWorkspaceFiles(),
      breakpoints: () => sourceBreakpoints,
      language: () => elements.language.value,
      arch: () => elements.language.value === 'swift' ? 'wasm32' : document.body.dataset.runtimeArch,
      target: () => elements.target.value,
      resourceDir: () => resourceDir, busy: () => busy,
      async buildSwift(output) {
        setBusy(true, 'Building Swift debug program…');
        try { await buildSwift(writeSource(), output, true); setStatus('Compiler ready'); }
        catch (error) { setStatus('Compilation failed', 'error'); throw error; }
        finally { setBusy(false); }
      },
      location: location => {
        debugLocation = location;
        if (location?.path.startsWith("/workspace/") && sourcePath !== location.path) {
          try { compiler.FS.stat(location.path); editWorkspaceFile(location.path); } catch (_) {}
        }
        renderSourceGutter();
        if (location && languageSettings().filename === location.path) {
          elements.source.scrollTop = Math.max(0, (location.line - 5) * parseFloat(getComputedStyle(elements.source).lineHeight));
          $("#source-gutter").scrollTop = elements.source.scrollTop;
        }
      },
    });
    elements.target.addEventListener("change", () => debuggerUi?.update());
    if ($("#toggle-debugger").getAttribute("aria-expanded") === "true") debuggerUi?.preload();
    updateLanguageUi();
    const autorun = new URLSearchParams(location.search).get("autorun");
    if (autorun === "1" || autorun === "driver") {
      const settings = writeSource();
      outputs.ast = settings.llvmIr ? "LLVM IR input starts after the Clang AST stage." : await run(commandText(settings, "ast"));
      await emitIr(settings, elements.target.value);
      await emitClangOutput(settings, "optimized");
      await renderCfg();
      await emitClangOutput(settings, "assembly");
      await compileAndRun();
      if (autorun === "driver") await loadExistingWasm();
      executeSymbol();
      const llvmIrInput = elements.language.value === "llvm";
      const frontendReady = llvmIrInput
        ? outputs.ir.includes("define i32 @absolute_difference")
        : outputs.ast.includes("FunctionDecl");
      const selectionDag = llvmIrInput
        ? await run("llc -mtriple=wasm32-unknown-unknown -mattr=+simd128 -O2 -stop-after=finalize-isel -o - /workspace/input.ll")
        : "";
      let driverReady = true;
      if (autorun === "driver" && llvmIrInput) {
        await run("llc -mtriple=wasm32-unknown-unknown -mattr=+simd128 -O2 -stop-before=finalize-isel -o /workspace/before-isel.mir /workspace/input.ll");
        await run("llc -mtriple=wasm32-unknown-emscripten -O1 -filetype=asm -o /workspace/output-emscripten.s /workspace/input.ll");
        await run("llc -mtriple=wasm32-unknown-unknown -O3 -filetype=asm -o /workspace/output-wasm.s /workspace/input.ll");
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
          lastExecutionResult === (llvmIrInput ? 1 : 60))
        document.body.dataset.smokeTest = "passed";
    }

  } catch (error) {
    appendLog(error.stack || error.message, "err");
    setStatus("Compiler failed to load", "error");
  }
}

const startupParameters = new URLSearchParams(location.search);
const requestedLanguage = startupParameters.get("language");
if (startupParameters.get("autorun"))
  resetSource();
else
  restoreState();
if ([...elements.language.options].some(option => option.value === requestedLanguage && !option.disabled)) {
  elements.language.value = requestedLanguage;
  resetSource();
}
if (swiftOnly) { elements.language.value = 'swift'; resetSource(); }
wireUi();
switchTab("ir");
writeSource();
const workspaceReady = (async () => {
  const loadedExamples = { ...(debuggerEnabled ? await loadWorkspaceExamples() : {}), ...(swiftEnabled ? await loadSwiftExamples() : {}) };
  for (const [name, source] of Object.entries(loadedExamples)) {
    const path = `/workspace/${name}`;
    defaultSources.set(path, source);
    if (!workspaceSources.has(path)) workspaceSources.set(path, source);
  }
  // Keep custom restored/typed code, but use the complete example for untouched defaults.
  if (elements.source.value === (examples[elements.language.value] || ""))
    elements.source.value = defaultSources.get(languageSettings().filename) ?? elements.source.value;
  writeSource();
  const example = startupParameters.get("example");
  if (workspaceExampleNames.includes(example)) editWorkspaceFile(`/workspace/${example}`);
  renderSourceGutter();
})();
// Attach a rejection handler while the large compiler download is in flight.
workspaceReady.catch(error => appendLog(error.message, "err"));
if (startupParameters.get("debugger") === "1") toggleDebugger(true);
// Keep the document's load event pending until the asynchronous compiler
// initialization (and an optional CI autorun) has completed. This gives
// headless browsers a deterministic readiness boundary.
await loadCompiler(workspaceReady);
