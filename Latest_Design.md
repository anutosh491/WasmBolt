# WasmBolt: latest product and runtime design

This document is the design checkpoint for WasmBolt after the compiler,
utility-tool, Clangd, MLIR, LLDB, WAMR, Jupyter, and Fortitudo experiments.
It records both the intended product and the boundaries that the experiments
showed we must preserve.

## Product

WasmBolt is one browser IDE for exploring and running compiler toolchains. It
is not a choice between separate standalone, Jupyter, and JupyterLite products.
The standalone IDE is the product. A Jupyter adapter may provide hosting and
persistence, but it must expose the same workbench and runtime architecture.

The product is not restricted to C and C++. LLVM IR, MLIR, LFortran, Swift,
and packaged C/C++ libraries are part of the design. Features are discovered
from a deployment manifest; the UI must not advertise tools or targets that
the deployed assets do not actually contain.

The repository should also become a template. A deployment selects compiler
tools and libraries through its environment and asset manifest rather than by
forking product logic.

## Workbench and user experience

The default layout follows a minimal VS Code-style workbench:

```text
+---------------- Explorer ----------------+ Editor +------- Result --------+
| workspace files                         |        | active output          |
| + new file   import                     |        |                        |
+-----------------------------------------+--------+------------------------+
| Terminal                                                               |
+------------------------------------------------------------------------+
```

- The Explorer owns a real, canonical workspace. Selecting a file opens it;
  users can create and import text or binary files.
- Starter files cover C, C++, LLVM IR, MLIR, and a real `xtensor` example.
- The editor uses a standard dark VS Code-like theme. Clangd completions appear
  beside the cursor as the user types; there is no separate results box and no
  required keyboard shortcut.
- The right group contains only relevant output tabs, such as AST, MLIR,
  LLVM IR, optimized IR, analysis, CFG, assembly, object, Wasm module, and
  debugger views. Tabs are not a row of large square buttons.
- Compile builds the active output and only the prerequisite stages needed for
  it. It does not eagerly execute every possible pipeline stage.
- Compile and Run builds a runnable Wasm program and executes it. Run reuses the
  selected, unchanged Wasm module. Editing function arguments never recompiles.
- Load Wasm selects an existing or imported module without rebuilding source.
- One bottom terminal records commands and their output. Prompts, commands,
  stdout, stderr, exit status, and the current prompt are visually distinct.
  It behaves like a terminal, including a working `clear` command.
- A bug button opens the debugger UI and breakpoint gutter. Live debugging has
  Continue, Pause, Step Over, Step In, Step Out, Restart, and Stop, together
  with call stack and variables. Static LLDB inspection is not presented as
  live debugging.
- Heavy assets begin warming after page load. The UI reports honest progress
  and remains interactive. Optional language and debugger runtimes stay lazy.

The browser path shown to users is `wasmbolt:/workspace`; `/workspace` remains
the runtime working directory. The sandbox does not need to be disguised, but
users should not have to manage implementation-specific mount points.

## Canonical workspace

The UI owns the canonical workspace as an immutable map of normalized paths to
text or binary contents. Workers receive versioned snapshots or deltas and
materialize them in their own MEMFS instances.

This is deliberate: browser Workers do not transparently share an Emscripten
filesystem. Making the UI model authoritative gives compiler, Clangd, runner,
utility, MLIR, and debugger Workers a predictable view without pretending that
they are native subprocesses.

The standalone host persists the source workspace in browser storage. A thin
Jupyter adapter may map the same model to the Jupyter Contents API so files
appear in Jupyter's file browser. Jupyter must not own compiler semantics or
force the application into a notebook-style UI.

## Worker architecture

```text
WasmBolt workbench and canonical workspace
|
+-- persistent compiler Worker
|   `-- ToolSession
|       `-- Clang driver -> integrated cc1 -> registered wasm-ld
|
+-- disposable LLVM pipeline Workers
|   |-- opt
|   `-- llc
|
+-- lazy disposable LLVM utility Worker
|   `-- LLVM multicall driver: readobj, nm, size, cxxfilt, ar,
|       objdump, objcopy, strip, ...
|
+-- lazy disposable MLIR Worker
|   `-- real mlir-opt and mlir-translate driver entry points
|
+-- persistent-on-demand Clangd Worker
|   `-- LSP over typed Worker messages
|
+-- lazy debugger Worker
|   `-- lldb-dap -> liblldb/ProcessWasm -> in-memory transport -> WAMR
|
`-- disposable runner Worker
    `-- selected program.wasm
```

Workers are an isolation boundary, not merely a responsiveness optimization.
If a native tool reports that it cannot run again, reaches a fatal path, times
out, or corrupts its runtime state, WasmBolt discards that Worker and restores
the canonical workspace into a fresh one.

### Compiler Worker and ToolSession

The compiler Worker is long lived and serialized. It is the strong same-process
use case:

```text
clang++ add.cpp main.cpp -o program.wasm
  -> cc1(add.cpp)
  -> cc1(main.cpp)
  -> wasm-ld(add.o, main.o)
```

LLVM's `ToolSession` owns process initialization and provides explicit nested
tool dispatch. It does not make every LLVM tool reentrant, isolate global
options, or turn a command into a daemon by itself.

The compiler host must therefore enforce these rules:

- calls in a session are serialized;
- integrated cc1 destroys its `CompilerInstance` before returning rather than
  relying on `-disable-free` and process exit;
- `wasm-ld` is called in-process only when it is explicitly registered by the
  host;
- an LLD result with `canRunAgain == false`, a recovered fatal error, or an
  equivalent poisoned state retires the complete compiler Worker;
- normal native Clang and LLD subprocess behavior remains unchanged.

`ToolSession` is ownership and dispatch. It is not a tool-specific command-line
registry. Until LLVM's process-global `cl::opt` state is redesigned, tools with
colliding registrations or reset behavior must not simply be accumulated in
one Wasm instance.

### opt and llc

The UI may present opt and llc as one compiler pipeline, but their runtime
boundary remains independent while process-global command-line registrations
make repeated co-hosting unsafe. Each invocation uses the genuine upstream
driver entry point with the full argv and a disposable Worker/runtime.

Startup time, decoded bytes, peak memory, and workspace-transfer cost must be
measured before changing this boundary. If LLVM later provides explicit option
state, these tools can move behind the same session without changing the UI.

### LLVM utility tools

Stateless inspection tools do not need reusable per-tool libraries merely to
run in a browser. A lazy Worker loads LLVM's existing multicall `llvm` program
and invokes the requested tool once. This preserves the normal executable
boundary and avoids claiming a repeated-invocation contract that the tool does
not provide.

Initial tools are `llvm-readobj`, `llvm-nm`, `llvm-size`, `llvm-cxxfilt`,
`llvm-ar`, `llvm-objdump`, `llvm-objcopy`, and `llvm-strip`. The Worker requires
a JavaScript loader and Wasm module; a static archive alone cannot be
instantiated by a browser Worker.

### MLIR

MLIR uses the real `mlir-opt` and `mlir-translate` driver entry points with full
argv. WasmBolt must not reimplement their option parsing or special-case
`--mlir-to-llvmir` in `CompilerModule.cpp`.

The MLIR module is lazy/disposable and revision-stamped. Its LLVM revision must
match the compiler assets it exchanges IR with. Lowering to LLVM IR is the first
supported execution path; SPIR-V/WebGPU is a later backend, not a shortcut in
the initial runtime.

### Clangd

Clangd is a genuine `clangd.js`/`clangd.wasm` service, not a completion demo or
hard-coded keyword list. It starts automatically when a C/C++ editor needs it,
stays alive for the editing session, receives workspace changes through LSP,
and can be suspended or restarted under memory pressure. A power-user setting
may disable language services, but the primary UI does not need an Enable
Clangd button.

The compiler flags sent to Clangd must match the selected target, language,
resource directory, sysroot, and package mounts used by compilation.

### Running Wasm

The runner is separate from compilation. It loads the selected Wasm module
once, discovers exported function signatures from the module, and builds calls
from those signatures. WasmBolt must not use a fixed seven-entry signature-code
table.

The first product surface supports scalar Wasm parameters and results. Pointer,
string, aggregate, and host-object marshalling require explicit adapters rather
than unsafe guesses. Repeated calls reuse module state until Reset, Stop,
timeout, trap, or module replacement retires the runner.

### LLDB, LLDB-DAP, ProcessWasm, and WAMR

The debug target is the final debug-enabled `program.wasm`. Source locations
come from DWARF in that module and paths in the canonical workspace. Users may
choose their own optimization and debug flags; the UI can explain why `-O0 -g`
is useful but must not silently rewrite their program.

The live path is:

```text
breakpoint gutter and debugger controls
  -> DAP JSON
  -> embedded lldb-dap
  -> LLDB SB/API and ProcessWasm
  -> in-memory GDB-remote transport
  -> WAMR interpreter
  -> program.wasm
```

WAMR is the execution engine: it interprets the guest Wasm instructions and
exposes its debug state. `ProcessWasm` is LLDB's process plugin for speaking the
Wasm debug protocol. Emscripten compiles LLDB, lldb-dap, and WAMR into the
browser; it does not replace the guest execution engine.

The in-memory transport replaces sockets inside one Worker but keeps the
protocol boundary. It must preserve packet framing, errors, cancellation, and
state transitions; it is not an ad-hoc byte callback.

Each live debug session gets a replaceable debugger Worker. The Worker buffers
early `stopped` events until configuration finishes. The UI publishes a paused
state as soon as the stop event and stack are known; variables/scopes are
loaded separately so a slow variable query cannot hide a valid breakpoint hit.
Repeated start/stop/restart sessions and failure recovery are mandatory tests.

The validated simple flow is breakpoint -> variables -> Step Over -> variables
-> Continue, with `value = 6`, `squared = 0`, then `squared = 36`, then exit 37.
The validated xtensor flow uses an ordinary `main`, stops in both `main` and
`xtensor_broadcast_sum`, observes `scale = 2` and `total = 141`, and exits 282
modulo the process-status width. The previous prototype exposed an intermittent
hang during automatic scopes/variables handling; that is an open reliability
issue, not a completed product claim.

Static LLDB inspection and the LLDB command interpreter may be exposed in the
terminal, but the debugger tab must use LLDB-DAP for live state and controls.

## Packages and deployment assets

The environment file is the deployment recipe. Empack-style package archives
are emitted beside the application, cached by the browser, and mounted lazily
into Workers. Headers such as xtensor must not be manually copied into
`Compiler.data`; selecting xtensor in the environment makes its archive and
metadata available to the compiler and Clangd mounts.

Each runtime asset has a manifest entry with:

- URL, byte size, and SHA-256;
- LLVM/Clang/MLIR/LLDB revision where applicable;
- Emscripten version and target ABI;
- enabled backends, tools, and exported native entry points;
- provenance (`source` for locally/upstream-built debugger assets);
- required package archives and filesystem mount paths.

The application refuses mismatched or placeholder assets. Missing optional
assets disable the corresponding capability with an honest message.

The current compiler package uses Emscripten 4.0.9, while the successful LLDB
prototype used 6.0.8. Separate Workers avoid a direct linked ABI between those
modules, but the production goal is one tested Emscripten 6.x toolchain once the
remaining emscripten-forge recipes are ready.

The public build should include WebAssembly plus the native inspection backends
it advertises (AArch64 and x86-64 in the present design). If size forces a
reduced build, unavailable targets are removed from the UI rather than allowed
to fail at llc time.

## Future compilers

LFortran is the first additional compiler because emscripten-forge already has
its compiler package. It should use the compiler runtime, not the
`xeus-lfortran` notebook kernel, and implement the same workspace/result
contract. Swift follows through a separate lazy Worker. Neither compiler should
be linked into the C/C++ core merely to make it selectable.

## Testing and release gates

A public deployment is ready only when it passes:

- TypeScript type checks, unit tests, formatting, and production bundling;
- manifest/hash/provenance validation for every advertised capability;
- browser smoke tests for file creation/import/open and terminal behavior;
- C, C++, LLVM IR, MLIR, and xtensor compile paths;
- WebAssembly compile, load, repeat-run-with-new-arguments, and reset;
- AArch64 and x86-64 assembly/object generation when advertised;
- automatic Clangd completion with the same flags and packages as compilation;
- debugger tests on the simple program first, then xtensor, including repeated
  sessions, restart, stepping, variables, and Worker replacement;
- measurements for cold/warm download, Worker startup, execution time, memory,
  and workspace transfer.

No simulated completion, fake LLDB result, copied command-line parser, or
manually fabricated output may satisfy these gates.

## Upstream work that shapes this design

- [LLVM #221996](https://github.com/llvm/llvm-project/pull/221996), merged:
  `ToolSession` ownership and nested tool invocation.
- [LLVM #222531](https://github.com/llvm/llvm-project/pull/222531): multiple
  integrated cc1 jobs in a session, including removal of `-disable-free` for
  session-owned jobs.
- The follow-up linker-dispatch patch registers a linker explicitly and keeps
  native subprocess behavior as the default.
- [LLVM #223169](https://github.com/llvm/llvm-project/pull/223169), merged:
  `HostInfoEmscripten`.
- [LLVM #223200](https://github.com/llvm/llvm-project/pull/223200), merged:
  `PlatformEmscripten`.
- [LLVM #223206](https://github.com/llvm/llvm-project/pull/223206), merged:
  building `lldbHost` under Emscripten.
- [LLVM #223210](https://github.com/llvm/llvm-project/pull/223210), merged:
  static `liblldb` support for Emscripten.
- LLVM's existing `ProcessWasm` supplies the LLDB-side Wasm process model.
- LLVM's multicall driver is the preferred first boundary for standalone
  binary utilities; separate exported utility-driver libraries are not assumed.

## Current recovery status

The source architecture and UI are being reconstructed in persistent Git
worktrees. The prior `/private/tmp` LLDB-DAP/WAMR binaries were lost in a laptop
restart. Their exact successful link settings and validated behavior are known,
but the native assets must be rebuilt and the intermittent variables-request
hang must be reproduced before the live debugger can be called production
ready.

This document is the source of truth when an experiment and the intended
product disagree.

