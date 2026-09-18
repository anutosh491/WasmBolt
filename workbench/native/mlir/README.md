# WasmBolt MLIR command runtimes

This directory builds the genuine LLVM 23.1.0 `mlir-opt` and `mlir-translate`
command-line programs as separate Emscripten modules.

## Reproducible inputs

- LLVM/MLIR: `llvmorg-23.1.0`, commit `ea7d852a70e8bdfaf601d6626a760f9771b2c4b4`
- Emscripten: `4.0.9`
- emscripten-forge package: `mlir-python-bindings` 23.1.0, build
  `py313h1276dae_1`
- Package SHA-256:
  `885b2ca2c2ee761302d2c71650e4abdd8b3d0a0c4d0ed5e3be4d4889e55adcba`

The package already contains the generated MLIR headers, CMake exports, and 394
WebAssembly static libraries. `MLIRMlirOptMain` supplies upstream `mlir-opt`'s
complete `main`. `mlir-translate.cpp` is the unmodified driver body from the
pinned LLVM commit. No LLVM or MLIR library rebuild is needed.

## Build and stage

Build the core compiler environment first, then run:

```sh
pixi run --as-is native/mlir/build.sh
pixi run --as-is jlpm build:worker
pixi run --as-is jlpm check:compiler
```

The script installs the one explicitly locked Emscripten package, links one
driver at a time, runs an actual Func/Arith MLIR to LLVM IR smoke test, and
stages the four assets under `compiler/mlir/`. It adds byte sizes, SHA-256
digests, source provenance, LLVM revision, and Emscripten version to the shared
manifest.

Set `BUILD_PREFIX` and `HOST_PREFIX` to reuse equivalent locked compiler
environments elsewhere. `JOBS` may be 1 or 2 and affects Binaryen only; the two
large driver links are always serialized.

Each browser invocation runs in a fresh disposable Worker. The Worker restores
the complete workspace, passes `argv` directly to Emscripten `callMain`, and
returns the resulting workspace. WasmBolt does not parse MLIR driver options.
