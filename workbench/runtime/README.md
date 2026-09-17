# Compiler runtime

Fortitudo vendors WasmBolt's compiler module and build recipe from revision
`6566da129fde331db3f4f24856c7ea56c2c4d71c` of
[WasmBolt](https://github.com/anutosh491/WasmBolt), by Anutosh Bhat. The MIT
notice is in `licenses/WasmBolt.txt`.

The baseline is Emscripten 4.0.9 and LLVM 23.1.0. `build.yml` and `host.yml`
retain upstream environment declarations. Exact package URLs and package hashes
are locked separately for macOS arm64, Linux x64, and the common Emscripten
target. `sources.json` pins the matching llc source files with SHA-256 hashes.
Build with `pixi run --as-is jlpm build:compiler`.

The wrapper preserves upstream exported functions, target initialization, Clang
invocation, LLVM option resets, opt pipeline, llc adaptation, dynamic loading
support, memory settings, and optional MLIR driver. The CMake file checks that
the expected llc main and InitLLVM statements exist before adapting them.
Removing InitLLVM prevents LLVM shutdown between invocations. Fortitudo changes
source paths and removes the upstream demo-page copying.

The final compiler and MLIR links use Emscripten's `-Oz` size optimization. The
build clears the toolchain's implicit `EMCC_CFLAGS` override and declares its
ABI flags in CMake so the environment cannot silently restore `-O2`.
`MAIN_MODULE=1` retains exports needed by dynamically loaded user programs;
changing it to mode 2 would require constraining those programs' imports.

The build assembles a browser filesystem from the Emscripten sysroot and pinned
host prefix. It preserves public headers and libraries, excluding development
headers and archives for the toolchain already linked into the compiler. Library
symlink aliases are recreated during initialization, so each library's contents
are preloaded only once. Clang resource headers appear at `/lib/clang/23`. The
optional MLIR driver is loaded only when requested.

Generated assets live in the ignored `compiler/` directory. Its manifest records
compiler version, resource directory, provenance, file sizes, and SHA-256
hashes, including license files. `check:compiler` requires a complete source
build. The `stage` subcommand can inspect imported upstream assets, but marks
them as imported; they cannot pass production checks.

The Emscripten ES module stays separate from frontend bundles. A dedicated
module worker imports it with an explicit URL and resolves data and Wasm through
`locateFile`. All compiles execute LLVM operations serially in one worker. An
explicit dependency plan shares frontend IR across optimization, analysis,
graphs, assembly, and object generation. AST uses a separate Clang invocation.
Frontend LLVM passes are disabled; one opt pipeline produces optimized IR. Wasm
uses PIC consistently in Clang, opt's target machine, and llc before linking a
dynamic module. Supplied IR target triples and layouts are checked against the
selected target machine. Failed stages skip only their dependents.

Raw stdout and stderr are captured as bytes because LLVM can flush partway
through a diagnostic line. The wrapper flushes LLVM and C streams at operation
boundaries, including the MLIR driver's locally bound LLVM streams. Command
records are kept outside captured output. This prevents AST, analysis, or
redirected MLIR output from inheriting buffered output from an earlier tool. The
optional MLIR driver is loaded and verified on demand, with retry after a
download failure. The command workspace is replaced at Compile and snapshotted
after each build or manual command. Cancellation terminates the worker rather
than interrupting LLVM in place.

Run creates a separate worker using the same packaged Emscripten runtime.
Compilation never loads the generated program. Each runner holds one module and
its workspace dependencies. The numeric bridge retains upstream's seven scalar
signatures; `wasmbolt_call_error` reports errors explicitly so NaN can be a
successful result. Stop, traps, timeout, and replacement modules terminate the
runner. Recreating the worker is required because
[Emscripten 4.0.9's dynamic loader](https://github.com/emscripten-core/emscripten/blob/4.0.9/src/lib/libdylink.js)
does not reclaim all static module allocations on unload.

License notices for LLVM, Emscripten, and packages whose headers or libraries
are included are in `licenses/`. They are copied to every distribution. The
exact resolved package metadata remains in the environment locks.

Each instance's initial Wasm memory is 256 MiB, the stack is 32 MiB, and memory
may grow. Compiler and runner workers own independent instances. Browser test
attachments report actual Wasm linear-memory sizes and compile and
initialization timings. These measurements exclude browser, JavaScript,
filesystem, and compiled-code overhead; they are not total process memory.
