# Language and debugger services

The browser-facing services in this tree define honest process boundaries:

- `clangd` is a lazy, persistent Worker speaking framed LSP JSON. Suspending it
  releases the Worker while retaining document snapshots for a later restart.
- `mlir-opt` and `mlir-translate` each run in a fresh disposable Worker. The
  browser passes a complete `argv`; LLVM's real driver parses every option.
- a live debug session gets one replaceable LLDB-DAP Worker. DAP controls LLDB,
  while the native adapter drives WAMR through its in-memory transport.

Workers receive complete `/workspace` snapshots. No service assumes that MEMFS
is shared across Wasm instances. The returned snapshot is the only file system
hand-off between process-equivalent Workers.

## Optional source-built assets

This repository intentionally does not contain placeholder clangd, LLDB, WAMR,
or LLDB-DAP binaries. A deployment may stage genuine source builds beside the
core compiler and record them in `compiler/manifest.json`:

- clangd requires `clangd/clangd.js`, `clangd/clangd.wasm.gz`, and
  `clangdOrigin: "source"`.
- MLIR requires `mlir/mlir-{opt,translate}.{js,wasm}`, `mlirOrigin: "source"`,
  and matching `llvmServices` metadata.
- LLDB-DAP and WAMR require `lldb-dap/lldb-dap.{js,wasm}`,
  `lldb-dap/lldb-dap.worker.js`, and `debuggerOrigin: "source"`.

Every Wasm file must have its byte length and SHA-256 digest in the manifest.
The service refuses missing, corrupt, unmarked, or mismatched assets. The MLIR
drivers share one `llvmServices.revision` entry so `mlir-opt` and
`mlir-translate` cannot silently come from unrelated LLVM revisions.

The live debugger module exports the `wasmbolt_lldb_*` and `wasmbolt_dap_*` ABI
used by `src/lldb/debug-worker.ts`. The staged LLDB-DAP/WAMR build has passed
the real breakpoint, variables, evaluation, stepping, and continue flow through
both its direct browser smoke and the workbench UI. Its reproducible source
recipe lives in `native/debugger`; generated `.work` outputs remain ignored.

Source debugging uses a separate `debug.wasm`. The compiler Worker lazily mounts
the Emscripten 4.0.9 startup object and system archives, compiles the active C
or C++ source with `-O0 -g3`, and links a standalone program for WAMR.
Function-only examples receive a temporary `main` generated from the selected
export's decoded Wasm signature and current Execute arguments. An existing
source `main` is used directly. The normal shared execution module remains
unchanged.

The staged Clangd is built from LLVM 23.1.0 revision
`ea7d852a70e8bdfaf601d6626a760f9771b2c4b4` with Emscripten 4.0.9. Its
reproducible recipe and patches live in `native/clangd`; generated assets remain
ignored. Two cross-origin-isolated browser smokes each returned 43 `std::vector`
member completions, zero error diagnostics, and another completion after idle
and an edit. The cold smoke measured 7.894 s in-page and 7.962 s wall time. A
reload with a fresh Worker measured 4.684 s in-page and 4.750 s wall time.

## Live launch contract

`DebugStartRequest.module` names the selected or generated `.wasm` artifact in
`files`. `entry` is empty for a generated standalone program, allowing WAMR to
enter `_start`. Imported modules may supply an explicit export and program
arguments. Breakpoints are source paths and 1-based lines. A `stopped` event
received while DAP configuration is still in flight is buffered and refreshed
after `configurationDone`, so the initial breakpoint cannot be overwritten by a
synthetic running state.
