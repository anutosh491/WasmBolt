# WasmBolt: verified status and execution boundaries

This is the short checkpoint for the recovered product worktree. It separates
what works now from the architecture that still depends on rebuilt assets or
upstream LLVM patches.

## Verified now

- The standalone and Jupyter hosts eagerly initialize one persistent core
  compiler Worker.
- A compile names the exact active source and sends the full canonical
  workspace snapshot. Selecting a file changes the real compile input.
- A new workspace has five WasmBolt-authored examples: `snippet.c`,
  `snippet.cpp`, `input.ll`, `input.mlir`, and `xtensor.cpp`.
- The xtensor example uses emscripten-forge `xtensor` 0.27.1 and `xtl` 0.8.2,
  both pinned to build `h0b0027f_0`, delivered as separate empack archives,
  restored at `/`, and verified in a real browser.
- Default C/C++ Compile and Run uses the persistent core Worker for
  `clang++ -O<level> -fPIC -fvisibility=default -c`, then invokes in-process
  `wasm-ld -shared --unresolved-symbols=import-dynamic` and loads the result.
- `opt` and `llc` run as real upstream programs in fresh isolated Workers only
  for requested IR, graph, assembly, object, custom-pipeline, or terminal work.
  They are not on the default Compile and Run path.
- The LLVM multicall Worker maps `llvm-readobj`, `llvm-nm`, `llvm-size`,
  `llvm-cxxfilt`, `llvm-ar`, `llvm-objdump`, and `llvm-objcopy`. It does not
  advertise `llvm-strip` until that command is mapped and tested.
- `mlir-opt` and `mlir-translate` run in fresh isolated Workers. Their real
  command lines and full argument vectors have completed the browser path from
  MLIR to LLVM IR. WasmBolt does not parse MLIR flags itself. The `native/mlir`
  recipe builds the upstream argv drivers; generated assets remain ignored.
- Genuine WAT rendering is verified through a lazy disposable WABT Worker.
- The runner is lazy and isolated from compilation. It infers scalar numeric
  exports from the Wasm type section rather than using a fixed signature table.
  **Run function** reuses the current module; changing arguments does not
  recompile it.
- The staged LLDB-DAP/WAMR runtime passed a real workbench flow: stop at
  `simple.cpp:2`, inspect `value = 6` and `squared = 0`, Step Over to
  `squared = 36`, then Continue to exit 37 without errors. F9 and the editor
  gutter both toggle breakpoints.
- Starting the debugger from C or C++ source builds a separate standalone
  `debug.wasm` with `-O0 -g3` and the compiler package's matching Emscripten
  4.0.9 startup object and system archives. The normal shared `program.wasm`
  stays the fast execution artifact.
- Source containing `main` enters it through `_start`. Function-only examples
  use a temporary `main` generated from the selected export's decoded Wasm
  signature and Execute arguments; no application signature is hardcoded.
- The product UI stopped at breakpoints in the default function-only example
  and the empack-backed xtensor example. Variables and call stacks were live.
  After Step Over, `lldb frame variable total` in the single bottom Terminal
  observed the same frame value as the Debugger panel.
- Source-built Clangd 23.1.0 at revision
  `ea7d852a70e8bdfaf601d6626a760f9771b2c4b4`, compiled with Emscripten 4.0.9,
  passed two real browser smoke runs. Each returned 43 `std::vector` member
  completions, zero error diagnostics, and a second completion after idle and
  an edit. The cold run measured 7.894 s in-page and 7.962 s wall time; a
  reload with a fresh Worker measured 4.684 s in-page and 4.750 s wall time.
  Both pages reported `crossOriginIsolated === true`.

One local Chrome smoke measured a repeated call with changed arguments at
about 62 ms. This is an experimental observation, not a release benchmark.

A separate local benchmark compared the old exploratory
`clang -> opt -> llc -> wasm-ld` chain with the direct build. The old path took
2,064 ms cold and had a 2,410 ms warm median. The direct path took 704 ms cold
and had a 25.5 ms warm median. Both exposed the same signature and returned 24.
`--export-dynamic` was removed because `-shared` already exports dynamic
symbols; `--unresolved-symbols=import-dynamic` remains for unresolved imports.

## Runtime boundaries

```text
WasmBolt workbench and canonical workspace
|
+-- eager persistent core compiler Worker
|   `-- direct Clang object build and explicit in-process wasm-ld
|
+-- lazy disposable pipeline Workers
|   |-- opt
|   |-- llc
|   |-- mlir-opt
|   `-- mlir-translate
|
+-- lazy disposable LLVM multicall Worker
|   `-- readobj, nm, size, cxxfilt, ar, objdump, and objcopy
|
+-- persistent-on-demand Clangd Worker
|   `-- source-built clangd 23.1.0 over LSP
|
+-- lazy LLDB-DAP/WAMR Worker
|   `-- staged lldb-dap, liblldb/ProcessWasm, transport, and WAMR
|
`-- lazy isolated runner Worker
    `-- selected and cached program.wasm
```

Workers are fault and process-lifetime boundaries. A fresh Worker receives the
canonical workspace, runs one isolated tool when appropriate, returns output,
and can be discarded without corrupting the compiler runtime.

## ToolSession boundary

The intended compiler path is:

```text
clang++ add.cpp main.cpp -o program.wasm
  -> cc1(add.cpp)
  -> cc1(main.cpp)
  -> registered wasm-ld
```

`ToolSession` provides ownership and explicit nested dispatch. It does not
remove global command-line state or make a tool recoverable after every fatal
error. A poisoned result, including `canRunAgain == false`, must retire the
whole compiler Worker.

The current `CompilerModule.cpp` runs the direct Clang object build and
`wasm-ld` as two commands in the same persistent Worker. It has not yet
exercised the natural Clang-to-registered-linker command above. That one-command
path remains gated on the pending Clang `ToolSession` dispatch patch and a
compiler package containing it. Native subprocess behavior stays the default.

## Threaded services

The Clangd client, LSP plumbing, and Worker suspension lifecycle are in source
and have unit coverage. The source-built runtime and browser LSP smoke are now
verified. The smoke covered diagnostics, member completion, completion after
idle and an edit, and a page reload that created a fresh Worker. The
reproducible LLVM 23.1.0/Emscripten 4.0.9 recipe lives in `native/clangd`;
generated assets remain ignored.

The debugger assets are staged from the reproducible `native/debugger` source
recipe. The real UI, LLDB-DAP bridge, ProcessWasm transport, and WAMR runtime
have passed simple, function-only, and xtensor breakpoint flows. Variables,
call stacks, Step Over, Continue, exit, and Terminal DAP evaluation were
observed in the real workbench. Broader repeated-session, restart, full-step,
and recovery testing remain release work.

There is no independent `lldb.js`/`lldb.wasm` runtime. Terminal commands
beginning with `lldb` use DAP `evaluate` against the same live session as the
debugger UI. This prevents two LLDB runtimes from observing different state.

Both Clangd and LLDB-DAP/WAMR use pthreads. Production hosting must provide
cross-origin isolation on the page and every nested runtime asset:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If cross-origin isolation is unavailable, threaded capabilities remain disabled
with an honest explanation. Ordinary compilation, isolated LLVM and MLIR
tools, utilities, WAT rendering, and Wasm execution do not depend on these
threaded services.
