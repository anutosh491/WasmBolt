# Compiler runtime

This directory builds and stages the WebAssembly tool runtimes used by WasmBolt.
The reproducible baseline is LLVM 23.1.0 with Emscripten 4.0.9. Exact
native-build, Emscripten-host, and browser-package environments are recorded
under `locks/`.

Build with:

```sh
pixi run --as-is jlpm build:compiler
```

## Process boundaries

The persistent compiler worker owns one `Compiler.wasm` instance. It currently
contains the Clang frontend adapter, the WebAssembly LLD library, and Graphviz.
JavaScript passes a packed `argv` vector to C++; C++ does not stringify or
reparse commands. LLD's `canRunAgain` result is checked after every link. A
false result poisons the instance and causes the owning worker to be replaced.

`opt`, `llc`, `mlir-opt`, and `mlir-translate` run as genuine upstream command
line programs in fresh, disposable workers. Each invocation receives a snapshot
of `/workspace`, executes its complete `argv`, returns a replacement snapshot,
and releases the entire Wasm instance. WasmBolt does not duplicate their option
parsing or reset LLVM's process-global command-line registry.

The opt and llc assets are intentionally source-gated. The current 23.1.0
Emscripten package does not ship `opt.js`/`opt.wasm` or `llc.js`/`llc.wasm`.
They become available only when all four genuine executable assets are present
in the build input. MLIR follows the same rule for its two executable pairs. A
partial runtime is rejected rather than silently replaced by a custom
implementation. Each executable loader must be modularized, skip its initial
run, and export Emscripten's `FS` and `callMain` runtime methods.

The [MLIR recipe](../native/mlir/README.md) links both genuine MLIR programs
from an exact, hash-locked `mlir-python-bindings` package. Its smoke test runs
Func/Arith MLIR through `mlir-opt`, then passes the optimized module to
`mlir-translate --mlir-to-llvmir` and verifies the resulting LLVM IR.

LLVM binary utilities use the upstream multicall `llvm.js`/`llvm.wasm` from the
`llvm-driver` package. Every `llvm-nm`, `llvm-readobj`, `llvm-size`,
`llvm-cxxfilt`, `llvm-ar`, `llvm-objdump`, or `llvm-objcopy` command gets a
fresh utility worker and the same workspace-transfer boundary.

The intended persistent compiler endpoint is a thin `ToolSession` containing the
real Clang and LLD driver entry points. That requires those entry objects to be
exported by the Emscripten LLVM/Clang/LLD build. The pinned package does not
provide them yet, so the current core still exposes Clang frontend and `wasm-ld`
as explicit commands. It must not be presented as supporting the natural
multi-file Clang-driver link until the package is rebuilt on the approved
upstream patch stack.

## Packages and filesystem

`Compiler.data` contains the Emscripten sysroot and Clang resource headers. It
does not contain every optional C++ library. Browser packages are produced by
empack as one compressed archive per conda package plus `empack_env_meta.json`.
The first locked environment contains xtensor and xtl. The compiler worker
verifies each archive against `manifest.json` and restores it at its normal
prefix, including `/include/xtensor` and `/include/xtl`.

Package files and `/workspace` are separate. Compile and terminal requests
replace only `/workspace`, so installed headers survive between commands. Adding
another header-only package does not relink `Compiler.wasm` or add it to
`Compiler.data`.

## Running generated modules

A generated program runs in a separate disposable worker. The Wasm inspector
discovers each exported function's parameter and result types from the module
type section. The runner resolves the chosen symbol through Emscripten's dynamic
loader and calls its Wasm table entry; there is no fixed signature code table.

The UI currently accepts scalar `i32`, `f32`, and `f64` parameters, in any
count, with zero or one scalar result. Pointer, aggregate, `i64`, reference,
multi-result, and vector interfaces remain visible but are not marked callable.
Traps, timeout, stop, and module replacement terminate the runner.

## Assets and provenance

Generated assets live in the ignored `compiler/` directory. `compiler.mjs`
stages the core runtime, multicall utilities, empack archives, isolated pipeline
tools, and optional language services. Every staged asset has a byte size and
SHA-256 digest in `manifest.json`.

Optional service directories are `clangd`, `mlir`, and `lldb-dap`. Pipeline
directories are `opt` and `llc`. A directory containing only part of a runtime
is rejected. `check:compiler` accepts only source provenance, validates the LLVM
revision and Emscripten version for optional services, and verifies every
manifest entry.

The Emscripten ES modules remain outside frontend bundles, and all URLs are
relative to the compiler worker. This keeps deployment below a URL prefix
working without hard-coded origins.

## Memory and output

The compiler and runner each start with 256 MiB of linear memory, a 32 MiB
stack, and memory growth enabled. Isolated workers have independent memories.
Raw stdout and stderr are captured as bytes for the persistent compiler because
LLVM can flush in the middle of a diagnostic line. Native streams are flushed at
every exported operation boundary.

License notices for LLVM, Emscripten, WasmBolt, WABT, Graphviz and its linked
dependencies, xtensor, and xtl are in `licenses/` and copied into every
distribution.
