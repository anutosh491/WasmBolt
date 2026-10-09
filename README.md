# WasmBolt

**WasmBolt is a browser-native laboratory for MLIR, C, C++ and LLVM.** It embeds
Clang's frontend and the WebAssembly LLD linker in an Emscripten runtime, and
uses published LLVM, MLIR and Graphviz tool modules in Web Workers. The complete
pipeline runs locally in the browser. Try here : https://anutosh21.github.io/WasmBolt/

Start with the [tutorials](tutorials.md) for MLIR, WebAssembly, LLVM utilities,
x86-64 and AArch64.
They walk through commands and inspecting generated files in the browser.

```text
C / C++ source
  -> Clang AST
  -> LLVM IR
  -> opt in a Worker
  -> LLVM CFG as DOT -> Graphviz in a Worker -> SVG
  -> llc in a Worker
  -> position-independent WebAssembly object
  -> in-process lldWasm
  -> dynamically loaded WebAssembly side module
  -> dlsym + execution
```

## What works

- C23 and C++23 source;
- tensor-based MLIR input, the complete `mlir-opt` dialect/pass registry, and
  `mlir-translate` for translation to LLVM IR;
- Clang diagnostics and textual AST dumps;
- unoptimized and optimized LLVM IR;
- configurable new-pass-manager pipelines such as `default<O2>`;
- LLVM `dot-cfg` output rendered to SVG by the Graphviz tool;
- `llc` assembly and object emission;
- in-process `wasm-ld` linking;
- LLVM object and archive utilities through published executable modules in
  short-lived Web Workers, including `llvm-readobj`, `llvm-nm`, `llvm-size`,
  `llvm-cxxfilt`, `llvm-ar`, `llvm-objdump`, `llvm-objcopy` and their aliases;
- C++ dependencies supplied by the deployment's Emscripten prefix, with
  explicit include and link flags controlled by the user;
- automatic discovery of public functions and their scalar signatures from the
  linked module's WebAssembly type section;
- typed execution of simple C ABI functions through `dlopen` and `dlsym`;
- a browser-filesystem viewer for generated IR, assembly, DOT, SVG, objects and
  Wasm modules;
- draggable panes, exact command logs, local persistence and shareable URLs.

## Examples 

1) C++, LLVM IR & SymEngine in WasmBolt : https://youtu.be/PedVGFpgax4?si=B2ncZC9Wg6E1Bwmf
2) MLIR in WasmBolt : https://youtu.be/yga2lWelne4?si=4SfSIoUZwEU2YybP
3) GodBolt initial example 

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/ecfb1946-d77f-4cf8-9a1f-108f6bebfba2" />

## Notes

The initial snippet deliberately has no `main()`, just like a Compiler Explorer
example. A translation unit does not need an entry point for AST, IR,
optimization or assembly inspection. WasmBolt only needs a callable function
when the generated WebAssembly side module is executed.

Execution uses wasm32 by default; the wasm64 build is experimental. The packaged
LLVM backends also let the browser runtime emit and inspect x86-64 and AArch64
assembly. Those outputs are for study; a browser cannot directly execute native x86 or AArch64
machine code.

After a module is built, WasmBolt reads its export and type sections and
automatically selects supported scalar signatures such as `i32(i32)` or
`f64(f64, f64)`. Ordinary global C++ functions retain their natural
Itanium-mangled symbols, which WasmBolt identifies and labels with their
source-level names. More complex pointer and aggregate interfaces remain an
advanced/manual concern. `extern "C"` is optional unless a stable, unmangled
interoperability boundary is specifically desired.

The primary interface has only **Compile** and **Compile & Run**. Select an
output tab before choosing **Compile** to produce that representation.
**Compile & Run** emits a Wasm object, links and loads the side module, detects
the exported function signature, and executes it. Open **Advanced terminal**
for complete manual control: raw `clang`, `mlir-opt`, `mlir-translate`, `opt`,
`llc`, `dot`, `wasm-ld` and LLVM utilities, generated files, loading an
existing `.wasm`, manual export calls, and analysis output. The terminal adds
no implicit optimization or link flags.

The linker does not infer binary libraries from included headers. A deployment
can add any compatible Emscripten package and users can provide its normal link
flags in their `wasm-ld` command, just as they would to a native linker.

The compiler runtime loads first. Tool modules load on demand in disposable
Workers and return their generated files to the shared browser workspace.
Each command gets a fresh Worker to isolate tool shutdown and command-line state.

Source lives in `ui/`, `compilers/clang/`, `linkers/wasm-ld/`, `runtime/` and
`tools/`. `debugger/` holds the future LLDB placeholder; `scripts/` handles builds.

## Why this is different

[wasm-clang](https://github.com/binji/wasm-clang) pioneered running separate
Clang and LLD command-line programs compiled to WASI, backed by a custom
in-memory filesystem. [playcode](https://github.com/InfiniteXyy/playcode) built
a browser playground on that foundation. [Derle](https://github.com/senolgulgonul/derle)
provides a compact, C-only Clang 18/WASI compile-and-run environment with a
small WASI runtime and stdin support.

WasmBolt takes a complementary route: Clang and LLD are invoked in-process,
while LLVM and MLIR command-line tools run in isolated browser Workers. This makes
the intermediate compiler stages—not only the final program—part of the
interactive experience. The work is inspired by the
teaching philosophy of [llvm-tutor](https://github.com/banach-space/llvm-tutor)
and [clang-tutor](https://github.com/banach-space/clang-tutor).

Unlike [Compiler Explorer](https://godbolt.org/), which offers enormous breadth
through server-hosted compilers, WasmBolt is deliberately focused and fully
client-side. Source code, compiler state and generated modules remain in the
browser tab.

## Build locally

The environment files use the emscripten-forge 6-x channel: Emscripten 6.0.8,
LLVM/Clang/LLD/MLIR 23.1.2 and Graphviz 15.1.0. Clang resource headers come from
`clangdev-static`. The build links the packaged libraries; no LLVM source
checkout or local driver patches are needed.

Create the native Emscripten build environment:

```bash
micromamba create -f environment-wasm-build.yml
```

Create the target prefix containing LLVM and Clang's resource headers:

```bash
micromamba create \
  -n wasmbolt-wasm-host \
  -f environment-wasm-host.yml \
  --platform=emscripten-wasm32
```

Activate `wasmbolt-wasm-build`, then point the build script at the target
prefix:

```bash
export LLVM_WASM_PREFIX="$MAMBA_ROOT_PREFIX/envs/wasmbolt-wasm-host"
export EMSCRIPTEN_SYSROOT="$CONDA_PREFIX/opt/emsdk/upstream/emscripten/cache/sysroot"
bash scripts/build.sh
python -m http.server 8000 --directory site
```

Open <http://127.0.0.1:8000/>. Add `?autorun=1` to run the end-to-end browser
smoke test.

The supported deployment is wasm32. Experimental wasm64 builds use a separate
`emscripten-wasm64` host prefix and `WASMBOLT_ARCH=wasm64`; Clang compilation
currently fails in that configuration. Loaded side modules must match the runtime ABI.

## Create your own deployment

This repository is designed to be used as a GitHub template:

1. Select **Use this template → Create a new repository**.
2. Choose the owner and repository name.
3. Open **Settings → Pages** and select **GitHub Actions** as the source.
4. Run the **Build and deploy WasmBolt** workflow, or push to `main`.

The resulting deployment is available at
`https://<owner>.github.io/<repository>/`. The default environment contains the
LLVM toolchain, MLIR and Graphviz. Libraries are opt-in: add compatible
Emscripten packages to `environment-wasm-host.yml`, where Boost and SymEngine
are commented examples. Their headers are staged under `/include`.
To expose runtime libraries to generated programs,
set `WASMBOLT_RUNTIME_LIBRARIES` to their absolute paths, separated by
semicolons. Static archives or side modules retain their filenames under `/lib`.

## GitHub Pages

The Pages workflow builds from emscripten-forge packages, checks the deployment
artifacts, and deploys the `site` directory. In the repository settings, select
**Settings → Pages → Source: GitHub Actions**. Every repository created from
the template builds and deploys its own independent site.

WasmBolt's application code is MIT-licensed. LLVM, Clang, LLD and their
packaged artifacts retain the Apache-2.0 WITH LLVM-exception license.

## Deliberate limits and next steps

- Runtime calls currently cover small scalar C ABI signatures. Pointer/array
  marshaling is a natural next step.
- Standard-library execution is limited by which Emscripten libraries are made
  available to the dynamic side module.
- SelectionDAG views still need a browser-native graph-export path. LLVM CFG
  and MLIR operation graphs are rendered through DOT/SVG.
- Untrusted infinite loops should eventually run in a dedicated Web Worker that
  the UI can terminate. The current page is a compiler laboratory, not yet a
  hardened multi-tenant online judge.
