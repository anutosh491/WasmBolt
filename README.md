# WasmBolt

**WasmBolt is a browser-native laboratory for C, C++ and LLVM.** It embeds
Clang's frontend, LLVM's optimization and code-generation libraries, and the
WebAssembly LLD linker into one Emscripten application. There is no compiler
server and no compiler subprocess: the complete pipeline runs locally in the
browser.

```text
C / C++ source
  -> Clang AST
  -> LLVM IR
  -> in-process LLVM pass pipeline
  -> LLVM CFG as DOT -> in-process Graphviz -> SVG
  -> in-process target code generation
  -> position-independent WebAssembly object
  -> in-process lldWasm
  -> dynamically loaded WebAssembly side module
  -> dlsym + execution
```

## What works

- C23 and C++23 source;
- Clang diagnostics and textual AST dumps;
- unoptimized and optimized LLVM IR;
- configurable new-pass-manager pipelines such as `default<O2>`;
- LLVM `dot-cfg` output rendered to SVG by Graphviz in-process;
- in-process `llc`-style assembly and object emission;
- in-process `wasm-ld` linking;
- C++ dependencies supplied by the deployment's Emscripten prefix, with
  explicit include and link flags controlled by the user;
- automatic discovery of public functions and their scalar signatures from the
  linked module's WebAssembly type section;
- typed execution of simple C ABI functions through `dlopen` and `dlsym`;
- a browser-filesystem viewer for generated IR, assembly, DOT, SVG, objects and
  Wasm modules;
- draggable panes, exact command logs, local persistence and shareable URLs.

The initial snippet deliberately has no `main()`, just like a Compiler Explorer
example. A translation unit does not need an entry point for AST, IR,
optimization or assembly inspection. WasmBolt only needs a callable function
when the generated WebAssembly side module is executed.

Execution currently targets `wasm32-unknown-emscripten`. The accompanying
emscripten-forge change adds the X86 and AArch64 LLVM backends as well, allowing
the same browser runtime to emit and inspect x86-64 and AArch64 assembly. Those
outputs are for study; a browser cannot directly execute native x86 or AArch64
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
for complete manual control: raw `clang`, `opt`, `llc`, `dot`, and `wasm-ld`
commands, generated files, loading an existing `.wasm`, manual export calls,
and analysis output. The terminal adds no implicit optimization or link flags.

The linker does not infer binary libraries from included headers. A deployment
can add any compatible Emscripten package and users can provide its normal link
flags in their `wasm-ld` command, just as they would to a native linker.

## Why this is different

[wasm-clang](https://github.com/binji/wasm-clang) pioneered running separate
Clang and LLD command-line programs compiled to WASI, backed by a custom
in-memory filesystem. [playcode](https://github.com/InfiniteXyy/playcode) built
a browser playground on that foundation. [Derle](https://github.com/senolgulgonul/derle)
provides a compact, C-only Clang 18/WASI compile-and-run environment with a
small WASI runtime and stdin support.

WasmBolt takes a complementary route: Clang, LLVM passes, target backends and
LLD are linked into one Emscripten process and invoked in-process. This makes
the intermediate compiler stages—not only the final program—part of the
interactive experience. The work is inspired by the
teaching philosophy of [llvm-tutor](https://github.com/banach-space/llvm-tutor)
and [clang-tutor](https://github.com/banach-space/clang-tutor).

Unlike [Compiler Explorer](https://godbolt.org/), which offers enormous breadth
through server-hosted compilers, WasmBolt is deliberately focused and fully
client-side. Source code, compiler state and generated modules remain in the
browser tab.

## Build locally

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

Activate `wasmbolt-wasm-build`, then point the build script at both prefixes:

```bash
export LLVM_WASM_PREFIX="$MAMBA_ROOT_PREFIX/envs/wasmbolt-wasm-host"
export EMSCRIPTEN_SYSROOT="$CONDA_PREFIX/opt/emsdk/upstream/emscripten/cache/sysroot"
bash scripts/build.sh
python -m http.server 8000 --directory site
```

Open <http://127.0.0.1:8000/>. Add `?autorun=1` to run the end-to-end browser
smoke test.

## Create your own deployment

This repository is designed to be used as a GitHub template:

1. Select **Use this template → Create a new repository**.
2. Choose the owner and repository name.
3. Open **Settings → Pages** and select **GitHub Actions** as the source.
4. Run the **Build and deploy WasmBolt** workflow, or push to `main`.

The resulting deployment is available at
`https://<owner>.github.io/<repository>/`. Add compatible Emscripten packages
to `environment-wasm-host.yml` to specialize a deployment; they are then
staged under their ordinary `/include` and `/lib` prefix paths.

## GitHub Pages

The Pages workflow builds from emscripten-forge packages, runs the browser smoke
test, and deploys the `site` directory. In the repository settings, select
**Settings → Pages → Source: GitHub Actions**. Every repository created from
the template builds and deploys its own independent site.

WasmBolt's application code is MIT-licensed. LLVM, Clang, LLD and their
packaged artifacts retain the Apache-2.0 WITH LLVM-exception license.

## Deliberate limits and next steps

- Runtime calls currently cover small scalar C ABI signatures. Pointer/array
  marshaling is a natural next step.
- Standard-library execution is limited by which Emscripten libraries are made
  available to the dynamic side module.
- SelectionDAG and CFG views need a browser-native graph-export path; LLVM's
  traditional graph viewers launch external programs and cannot be reused as-is.
- Untrusted infinite loops should eventually run in a dedicated Web Worker that
  the UI can terminate. The current page is a compiler laboratory, not yet a
  hardened multi-tenant online judge.
