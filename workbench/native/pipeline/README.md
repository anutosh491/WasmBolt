# WasmBolt LLVM pipeline runtimes

This directory owns WasmBolt's browser builds of the real `opt` and `llc`
command-line drivers. They run in short-lived Workers and exchange files with
the compiler Worker through workspace snapshots. They are not partial command
reimplementations and are not linked into the persistent Clang/LLD runtime.

## Reproducible inputs

- LLVM: `llvmorg-23.1.0`, commit `ea7d852a70e8bdfaf601d6626a760f9771b2c4b4`
- LLVM libraries: emscripten-forge package `llvm-23.1.0-hd68d874_1`
- Emscripten: `4.0.9`
- Targets: WebAssembly, X86, and AArch64

The build uses the exact environment locks under `runtime/locks/`. It obtains
the upstream `opt.cpp`, `llc.cpp`, and `NewPMDriver` sources directly from the
pinned Git revision, so local working-tree changes cannot enter the binaries.
`opt` links the packaged `LLVMOptDriver`; `llc` links the matching LLVM target
libraries and uses the upstream command parser.

## Build and stage

The default command creates isolated environments and an LLVM partial clone
under the ignored `work/pipeline/` directory, builds both runtimes, and stages
them under `compiler/`:

```bash
native/pipeline/build.sh
```

`micromamba`, Git, and Python 3 must be available. The script supports these
separate steps:

```bash
native/pipeline/build.sh build
native/pipeline/build.sh stage
native/pipeline/build.sh check
```

The expensive final links run sequentially. `BINARYEN_CORES` defaults to `2` and
limits Binaryen's internal worker pool; `JOBS` also defaults to `2` for the
ordinary compile steps. Both may be overridden explicitly.

All paths have repository-relative defaults. Existing exact LLVM sources or
package environments can be supplied with `LLVM_SOURCE_REPOSITORY`,
`BUILD_PREFIX`, and `HOST_PREFIX`. `BUILD_DIR`, `STAGE_DIR`, `WORK_DIR`, and
`MAMBA_EXE` are also configurable.

Staging copies `opt.js`, `opt.wasm`, `llc.js`, and `llc.wasm` atomically and
updates their sizes, hashes, targets, and common LLVM/Emscripten provenance in
`compiler/manifest.json`. It refuses to combine assets with a core compiler or
another LLVM service built from different inputs.

## Browser contract

Each invocation gets a fresh Worker and a copy of `/workspace`. The Worker calls
the original driver's `main` entry point once, returns its exit status and
filesystem snapshot, and is then discarded. WasmBolt currently uses:

- `opt` for LLVM pass pipelines such as `default<O2>`;
- `llc` for WebAssembly objects and WebAssembly, X86, or AArch64 assembly.

The generated assets remain outside Git. Their hashes and provenance are kept in
the generated compiler manifest, while this directory contains everything needed
to reproduce them.
