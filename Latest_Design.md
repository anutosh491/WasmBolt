# WasmBolt: latest product and runtime design

This document is the design checkpoint for WasmBolt after the compiler,
utility-tool, Clangd, MLIR, LLDB, WAMR, and Jupyter experiments.
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
- Starter files cover C, C++, LLVM IR, MLIR, and WasmBolt's own
  `xtensor.cpp` example. The example is not copied from xtensor.
- The editor uses a standard dark VS Code-like theme. Source-built Clangd
  provides completions beside the cursor as the user types; there is no
  separate results box and no required keyboard shortcut.
- The right group contains only contextual output tabs: AST, LLVM IR,
  Graphviz, assembly, and Wasm module for C/C++; MLIR, LLVM IR, and Graphviz
  for MLIR; and debugger views when the debugger runtime is available. Tabs
  are not a row of large square buttons.
- The Wasm module view renders genuine WAT in a lazy disposable WABT Worker;
  WABT is not part of the main application bundle.
- Compile builds the active output and only the prerequisite stages needed for
  it. It does not eagerly execute every possible pipeline stage.
- Compile and Run builds a runnable Wasm program and executes it. Run function
  reuses the selected, unchanged Wasm module. Editing function arguments never
  recompiles.
- Load Wasm selects an existing or imported module without rebuilding source.
- One bottom terminal records commands and their output. Prompts, commands,
  stdout, stderr, exit status, and the current prompt are visually distinct.
  It behaves like a terminal, including a working `clear` command.
- A bug button opens the debugger UI and breakpoint gutter. The intended live
  controls are Continue, Pause, Step Over, Step In, Step Out, Restart, and Stop,
  together with call stack and variables. They are enabled only when the
  LLDB-DAP runtime is present and validated.
- The core compiler begins warming after page load. The UI reports honest
  progress and remains interactive. Optional language, pipeline, utility,
  runner, and debugger runtimes stay lazy.

The browser path shown to users is `wasmbolt:/workspace`; `/workspace` remains
the runtime working directory. The sandbox does not need to be disguised, but
users should not have to manage implementation-specific mount points.

## Verified implementation checkpoint

The recovered workbench currently has these verified product boundaries:

- the standalone and Jupyter hosts eagerly initialize one persistent core
  compiler Worker;
- every compile request identifies the exact active source and sends the full
  canonical workspace snapshot;
- a new workspace contains `snippet.c`, `snippet.cpp`, `input.ll`,
  `input.mlir`, and WasmBolt's custom `xtensor.cpp` example;
- `xtensor` 0.27.1 and `xtl` 0.8.2, both build `h0b0027f_0`, are pinned from
  emscripten-forge, delivered as separate empack archives, restored at `/`,
  and verified by compiling the example in a real browser;
- the default C/C++ Wasm build compiles directly to an object in the persistent
  compiler Worker, then links it with the in-process `wasm-ld`;
- `opt` and `llc` are reserved for requested IR, graph, assembly, object, and
  custom-pipeline exploration in isolated tool Workers;
- LLVM utilities, `mlir-opt`, and `mlir-translate` also use isolated tool
  Workers rather than sharing the persistent compiler runtime;
- the real MLIR command-line modules have completed the browser lowering path
  from MLIR through `mlir-opt` and `mlir-translate` to LLVM IR;
- generated MLIR assets remain ignored build products, while the
  `native/mlir` recipe builds the full upstream argv drivers;
- the Wasm module view renders genuine WAT through a verified, lazy disposable
  WABT Worker;
- the runner infers numeric export signatures from the Wasm type section and
  reuses an unchanged loaded module when only call arguments change; and
- the staged LLDB-DAP/WAMR runtime has completed a real workbench debug flow:
  breakpoint at `simple.cpp:2`, inspect `value = 6` and `squared = 0`, Step
  Over to `squared = 36`, then Continue to exit 37 without errors.

One local Chrome smoke measured a repeated call with changed arguments at
about 62 ms. That is an experimental observation, not a release benchmark.

The staged Clangd is a source build of LLVM 23.1.0 at revision
`ea7d852a70e8bdfaf601d6626a760f9771b2c4b4`, compiled with Emscripten 4.0.9.
Two real browser smoke passes each returned 43 `std::vector` member
completions, published zero-error diagnostics for a constexpr-heavy document,
and completed another request after an idle period and document edit. The
cold pass reported 7.894 s in-page and 7.962 s wall time. A reload that created
a fresh Worker reported 4.684 s in-page and 4.750 s wall time. Both ran with
`crossOriginIsolated === true`.

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
|   `-- Clang frontend and explicit in-process wasm-ld command
|
+-- disposable LLVM pipeline Workers
|   |-- opt
|   `-- llc
|
+-- lazy disposable LLVM utility Worker
|   `-- LLVM multicall driver: readobj, nm, size, cxxfilt, ar,
|       objdump, and objcopy
|
+-- lazy disposable MLIR Worker
|   `-- real mlir-opt and mlir-translate programs
|
+-- persistent-on-demand Clangd Worker
|   `-- source-built clangd 23.1.0; LSP over typed Worker messages
|
+-- lazy debugger Worker
|   `-- lldb-dap -> liblldb/ProcessWasm -> transport -> WAMR
|
`-- lazy isolated runner Worker
    `-- selected and cached program.wasm
```

Workers are an isolation boundary, not merely a responsiveness optimization.
If a native tool reports that it cannot run again, reaches a fatal path, times
out, or corrupts its runtime state, WasmBolt discards that Worker and restores
the canonical workspace into a fresh one.

### Compiler Worker and ToolSession

The compiler Worker is long lived and serialized. It is the strong same-process
boundary used by the current fast Wasm build:

```text
clang++ -O2 -fPIC -fvisibility=default -c source.cpp -o output.o
wasm-ld -shared --unresolved-symbols=import-dynamic output.o \
  -o program.wasm
dlopen(program.wasm) -> dlsym(export) -> call
```

Clang performs its ordinary frontend, optimization, and code-generation path.
The build does not start `opt` or `llc` Workers. `-shared` produces the dynamic
Wasm module expected by the current `dlopen` runner.
`--unresolved-symbols=import-dynamic` retains unresolved symbols as dynamic
imports for that model. `--export-dynamic` was redundant with `-shared` and has
been removed.

A local browser benchmark compared that path with the former exploratory
`clang -> opt -> llc -> wasm-ld` chain. The legacy chain took 2,064 ms cold and
had a 2,410 ms warm median. The direct path took 704 ms cold and had a 25.5 ms
warm median. Both exposed the same signature and returned 24 for the same call.
These are local experimental measurements, not release guarantees.

The intended upstream-dependent form collapses the two build commands into the
natural driver invocation:

```text
clang++ add.cpp main.cpp -o program.wasm
  -> cc1(add.cpp)
  -> cc1(main.cpp)
  -> wasm-ld(add.o, main.o)
```

LLVM's `ToolSession` owns process initialization and provides explicit nested
tool dispatch. It does not make every LLVM tool reentrant, isolate global
options, or turn a command into a daemon by itself.

The current packaged `CompilerModule.cpp` invokes Clang and `wasm-ld` as two
commands in the same persistent Worker. The one-command
`clang++ add.cpp main.cpp -o program.wasm` form remains gated on the pending
Clang `ToolSession` dispatch patch and a compiler package containing it.

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

`opt` and `llc` serve explicit compiler exploration: custom LLVM passes,
Graphviz, assembly, object inspection, and direct terminal commands. They are
not prerequisites of the default C/C++ Compile and Run path.

Their runtime boundary remains independent while process-global command-line
registrations make repeated co-hosting unsafe. Each invocation uses the genuine
upstream driver entry point with the full argv and a disposable Worker/runtime.
If LLVM later provides explicit option state, these tools can move behind the
same session without changing the UI.

### LLVM utility tools

Stateless inspection tools do not need reusable per-tool libraries merely to
run in a browser. A lazy Worker loads LLVM's existing multicall `llvm` program
and invokes the requested tool once. This preserves the normal executable
boundary and avoids claiming a repeated-invocation contract that the tool does
not provide.

The initial mapped tools are `llvm-readobj`, `llvm-nm`, `llvm-size`,
`llvm-cxxfilt`, `llvm-ar`, `llvm-objdump`, and `llvm-objcopy`. The Worker
requires a JavaScript loader and Wasm module; a static archive alone cannot be
instantiated by a browser Worker. Other multicall tools are added only after
their command mapping and browser behavior are tested.

### MLIR

MLIR uses the real `mlir-opt` and `mlir-translate` driver entry points with full
argv. WasmBolt must not reimplement their option parsing or special-case
`--mlir-to-llvmir` in `CompilerModule.cpp`.

The MLIR module is lazy/disposable and revision-stamped. Its LLVM revision must
match the compiler assets it exchanges IR with. Lowering to LLVM IR is the first
supported execution path; SPIR-V/WebGPU is a later backend, not a shortcut in
the initial runtime.

This boundary is browser-proven with source-built `mlir-opt` and
`mlir-translate` modules from one LLVM revision. The service forwards their
complete argument vectors to the real command-line programs. There is no
WasmBolt parser for `-o`, `--pass-pipeline`, or `--mlir-to-llvmir`. The
`native/mlir` recipe builds these upstream argv drivers reproducibly. Its
generated JavaScript and Wasm assets remain ignored build products rather than
source-controlled binaries.

### Clangd

Clangd is designed as a genuine `clangd.js`/`clangd.wasm` service, not a
completion demo or hard-coded keyword list. It starts when a C/C++ editor needs
it, stays alive for the editing session, receives workspace changes through
LSP, and can be suspended or restarted under memory pressure. The client
lifecycle, including suspension that terminates the Worker, has unit coverage.
The staged runtime is built from LLVM 23.1.0 revision
`ea7d852a70e8bdfaf601d6626a760f9771b2c4b4` with Emscripten 4.0.9. Its
reproducible recipe and patches live in `native/clangd`; generated runtime
assets remain ignored build products.

Two browser smoke passes verified real LSP diagnostics and completion. Each
returned 43 members for `std::vector`, reported no error diagnostics for the
constexpr stress document, and completed again after an idle period and edit.
The cold pass took 7.894 s in-page and 7.962 s wall time. A reload with a fresh
Worker took 4.684 s in-page and 4.750 s wall time. Both pages were
cross-origin-isolated. These are local observations rather than release
performance guarantees.

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

An already-current module is reused by **Run function**. Changing call
arguments does not change the workspace revision, reload the module, or invoke
the compiler. **Compile and Run** builds a Wasm module first when none is
current.

### LLDB, LLDB-DAP, ProcessWasm, and WAMR

The ordinary `program.wasm` is a shared module optimized for fast interactive
execution. WAMR requires a standalone program, so source debugging builds a
separate `debug.wasm` with `-O0 -g3`. Its startup object and system archives
come from a lazy debug-sysroot asset group matching the compiler package's
Emscripten 4.0.9 ABI.

An existing source `main` is the program entry. For function-only examples,
WasmBolt decodes the selected export's signature from the ordinary module and
generates a temporary `main` that calls the real symbol with the current
Execute arguments. This keeps the adapter generic: application signatures are
never hardcoded. Temporary wrapper and object files are removed from the
visible workspace after linking.

The verified live path is:

```text
breakpoint gutter and debugger controls
  -> DAP JSON
  -> embedded lldb-dap
  -> LLDB SB/API and ProcessWasm
  -> in-memory GDB-remote transport
  -> WAMR interpreter
  -> debug.wasm
```

WAMR is the execution engine: it interprets the guest Wasm instructions and
exposes its debug state. `ProcessWasm` is LLDB's process plugin for speaking the
Wasm debug protocol. Emscripten compiles LLDB, lldb-dap, and WAMR into the
browser; it does not replace the guest execution engine.

The in-memory transport replaces sockets inside one Worker but keeps the
protocol boundary. It must preserve packet framing, errors, cancellation, and
state transitions; it is not an ad-hoc byte callback.

Each live debug session gets a replaceable debugger Worker. The Worker must
buffer early `stopped` events until configuration finishes. The UI should
publish a paused state once the stop event and stack are known, then load
variables separately so a slow variable query cannot hide a valid breakpoint
hit. The staged runtime and real workbench UI have passed this browser flow:

```text
breakpoint simple.cpp:2
  -> value = 6, squared = 0
  -> Step Over
  -> squared = 36
  -> Continue
  -> exit 37
```

The flow completed without UI or protocol errors. Both F9 and the editor gutter
toggle source breakpoints. The same product path also stopped in the default
function-only example and an empack-backed xtensor example, showing variables
and the generated `main` in the call stack. After stepping, a Terminal
`lldb frame variable` command observed the same frame state as the Debugger
panel. Repeated-session soak, restart, every step variant, and failure recovery
remain release gates. The debugger assets are reproducibly built by the
`native/debugger` source recipe.

The old independent static `lldb.js`/`lldb.wasm` inspection runtime has been
removed from the product architecture. The debugger module embeds `lldb-dap`,
`liblldb`, ProcessWasm, and WAMR. Terminal commands beginning with `lldb` use
DAP `evaluate` against that same session, so the terminal and debugger cannot
silently observe different LLDB states. A separate static runtime should return
only if measurements establish a concrete need for it.

## Packages and deployment assets

The environment file is the deployment recipe. Empack-style package archives
are emitted beside the application, cached by the browser, and mounted lazily
into Workers. Headers such as xtensor must not be manually copied into
`Compiler.data`; selecting xtensor in the environment makes its archive and
metadata available to the compiler and Clangd mounts.

The current package set pins `xtensor` 0.27.1 and `xtl` 0.8.2 with build
`h0b0027f_0`. They are separate empack archives restored at `/`, not files baked
into `Compiler.data`. The starter `xtensor.cpp` is a small WasmBolt-authored
broadcast and reduction example used to verify in a real browser that these
mounted headers participate in an ordinary C++ compile.

Each runtime asset has a manifest entry with:

- URL, byte size, and SHA-256;
- LLVM/Clang/MLIR/LLDB revision where applicable;
- Emscripten version and target ABI;
- enabled backends, tools, and exported native entry points;
- provenance (`source` for locally/upstream-built debugger assets);
- required package archives and filesystem mount paths.

The application refuses mismatched or placeholder assets. Missing optional
assets disable the corresponding capability with an honest message.

The compiler package and debug guest sysroot use Emscripten 4.0.9. The staged
debugger host is a separate Emscripten 6.0.8 pthread runtime produced by the
`native/debugger` source recipe. The modules exchange DAP and GDB-remote bytes,
not linked C++ objects, so their Emscripten versions do not form a shared ABI.
Moving every source recipe to one tested toolchain remains desirable, but is
not a prerequisite for this isolated design.

The public build should include WebAssembly plus the native inspection backends
it advertises (AArch64 and x86-64 in the present design). If size forces a
reduced build, unavailable targets are removed from the UI rather than allowed
to fail at llc time.

Clangd and LLDB-DAP/WAMR are pthread services. Their deployment requires
cross-origin isolation, including these response headers on HTML, JavaScript,
Wasm, package archives, and nested Worker scripts:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If `crossOriginIsolated` is unavailable, ordinary compilation may continue,
but threaded services must remain disabled with an explicit explanation.

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
- the verified simple, function-only, and xtensor LLDB-DAP flows on every
  release build;
- debugger tests for repeated sessions, restart, all step variants, failure
  recovery, and Worker replacement;
- measurements for cold/warm download, Worker startup, execution time, memory,
  and workspace transfer.

No simulated completion, fake LLDB result, copied command-line parser, or
manually fabricated output may satisfy these gates.

## Upstream work that shapes this design

- [LLVM #221996](https://github.com/llvm/llvm-project/pull/221996), merged:
  `ToolSession` ownership and nested tool invocation.
- [LLVM #222531](https://github.com/llvm/llvm-project/pull/222531): proposed
  multiple integrated cc1 jobs in a session, including removal of
  `-disable-free` for session-owned jobs.
- The proposed follow-up linker-dispatch patch registers a linker explicitly
  and keeps native subprocess behavior as the default.
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

## Current implementation status

The source architecture and UI are reconstructed in a persistent Git worktree.
MLIR, empack packages, WAT rendering, and simple, function-only, and xtensor
LLDB-DAP/WAMR debug flows are browser-verified. Source-built Clangd completion
and diagnostics are also browser-verified, including a fresh-Worker restart.
The debugger assets are staged from the reproducible `native/debugger` source
recipe; there is no independent `lldb.js`/`lldb.wasm` runtime.

This document is the source of truth when an experiment and the intended
product disagree.
