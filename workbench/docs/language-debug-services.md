# Language and debugger services

The browser-facing services in this tree define honest process boundaries:

- `clangd` is a lazy, persistent Worker speaking framed LSP JSON. Suspending it
  releases the Worker while retaining document snapshots for a later restart.
- `mlir-opt` and `mlir-translate` each run in a fresh disposable Worker. The
  browser passes a complete `argv`; LLVM's real driver parses every option.
- static LLDB inspection gets a disposable threaded LLDB Worker.
- a live debug session gets one replaceable LLDB-DAP Worker. DAP controls LLDB,
  while the native adapter drives WAMR through its in-memory transport.

Workers receive complete `/workspace` snapshots. No service assumes that MEMFS
is shared across Wasm instances. The returned snapshot is the only file system
hand-off between process-equivalent Workers.

## Optional source-built assets

This repository intentionally does not contain placeholder clangd, LLDB, WAMR,
or LLDB-DAP binaries. A deployment may stage genuine source builds beside the
core compiler and record them in `compiler/manifest.json`:

| Service                | Required files                                             | Required manifest marker                  |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| clangd                 | `clangd/clangd.js`, `clangd/clangd.wasm.gz`                | `clangdOrigin: "source"`                  |
| MLIR                   | `mlir/mlir-opt.{js,wasm}`, `mlir/mlir-translate.{js,wasm}` | `mlirOrigin: "source"` and `llvmServices` |
| LLDB static inspection | `lldb/lldb.{js,wasm}`                                      | `lldbOrigin: "source"`                    |
| LLDB-DAP + WAMR        | `lldb-dap/lldb-dap.{js,wasm}`                              | `debuggerOrigin: "source"`                |

Every Wasm file must have its byte length and SHA-256 digest in the manifest.
The service refuses missing, corrupt, unmarked, or mismatched assets. The MLIR
drivers share one `llvmServices.revision` entry so `mlir-opt` and
`mlir-translate` cannot silently come from unrelated LLVM revisions.

The live debugger module must export the `wasmbolt_lldb_*` and `wasmbolt_dap_*`
ABI used by `src/lldb/debug-worker.ts`. Until that source build is rebuilt and
staged, the typed UI and protocol are testable, but a live debug session is
deliberately unavailable.

## Live launch contract

`DebugStartRequest.module` names the selected `.wasm` artifact in `files`.
`argv` contains program arguments only; it is not an exported symbol or a
function-call signature. Breakpoints are source paths and 1-based lines. A
`stopped` event received while DAP configuration is still in flight is buffered
and refreshed after `configurationDone`, so the initial breakpoint cannot be
overwritten by a synthetic running state.
