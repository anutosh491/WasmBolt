# WasmBolt clangd runtime

This directory owns WasmBolt's clangd WebAssembly build. It does not import a
third-party clangd binary.

## Reproducible inputs

- LLVM/clangd: `llvmorg-23.1.0`, commit
  `ea7d852a70e8bdfaf601d6626a760f9771b2c4b4`
- Emscripten: `4.0.9`
- xtensor: `0.27.1`, emscripten-forge build `h0b0027f_0`
- xtl: `0.8.2`, emscripten-forge build `h0b0027f_0`

The two source patches are Emscripten-only. The first yields the Wasm stack
until JavaScript queues asynchronous browser LSP input. The second selects
Clang's existing loop-based constexpr interpreter because Binaryen's Asyncify
pass cannot transform WebAssembly tail-call instructions. The build recipe
selects that fallback explicitly with `CLANG_INTERP_DISABLE_TAILCALLS`. Native
clangd remains unchanged.

## Build

```bash
./workbench/native/clangd/build.sh
```

By default, the exact LLVM checkout and build trees live under
`workbench/work/clangd/`. The source checkout must be at the revision above.
Build tools are discovered from `PATH`; `EMSCRIPTEN_ENV` may name an Emscripten
environment whose `bin` directory should be prepended. Every tool also has an
explicit override, including `NINJA_BIN`, `CMAKE_BIN`, and `EMCC_BIN`. `JOBS` is
restricted to `1` or `2`.

The script verifies exact LLVM revision, builds matching native TableGen tools,
builds clangd from source with Emscripten pthreads, embeds matching
Emscripten/Clang system headers, and stages assets under
`workbench/compiler/clangd/` with hashes in `workbench/compiler/manifest.json`.
Only the gzip-compressed Wasm is staged; the browser decompresses it before
instantiation.

xtensor and xtl are not copied into clangd's private data file. clangd restores
the same empack archives as compiler Worker into its own MEMFS, letting browser
cache serve one package artifact to both runtimes.

clangd runs in its own persistent Worker. It is not linked into compiler Worker:
it has a different lifetime, needs pthreads, and retains document/index state
across LSP requests.

`smoke/` validates initialization and a real C++ member-completion request in a
cross-origin-isolated browser. WasmBolt's integrated smoke additionally opens
`xtensor.cpp`; that path verifies empack restoration as well as clangd itself.
