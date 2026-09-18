# WasmBolt

WasmBolt is a browser-only compiler explorer for C, C++, LLVM IR, and MLIR in
JupyterLab, JupyterLite, and a standalone app. No kernel or remote compiler is
needed.

The [web app](https://anutosh491.github.io/WasmBolt/) opens the standalone
explorer. Select **Try in Jupyter** to use the explorer alongside C23 and C++23
notebooks.

Select **Guide** in the explorer to read the guide below. The same guide is
available as **WasmBolt guide.md** in JupyterLite.

<!-- guide:start -->

## Install WasmBolt

Install and run locally:

```sh
pip install wasmbolt
wasmbolt
```

The command opens the explorer in your browser. **Try in Jupyter** opens the
bundled JupyterLite environment with C23 and C++23 notebooks in the same tab.
Everything is served from your computer; compilation and notebook execution stay
in the browser. No JupyterLab installation, Node, or compiler build is required.

Keep the terminal open while using WasmBolt; press **Ctrl+C** to stop serving
it. Use `wasmbolt --no-browser` to print the address, or `wasmbolt --port 8001`
to choose another port. Your browser saves sessions separately for each address.

If you have JupyterLab 4.6 or later, the same package also provides its
extension. Restart JupyterLab and select **Open WasmBolt** in the launcher or
command palette. The npm package includes the compiler and shared workbench for
applications that supply their own Lumino host.

## Compile and inspect

Edit a function, choose a language, target, and optimization level, then select
**Compile** or press **Ctrl/Cmd+Enter**. Compilation generates the selected
output and any prerequisites it needs. Switching to an output that has already
been generated does not recompile. You can keep editing during compilation.
**Cancel** stops the compiler; the next compile reloads it.

- C/C++: AST, LLVM IR, Graphviz, and assembly.
- LLVM IR: validated IR, Graphviz, and assembly.
- MLIR: transformed MLIR, LLVM IR, and Graphviz.
- WebAssembly target with C/C++ or LLVM IR: also a linked Wasm module rendered
  as genuine WebAssembly text (WAT).

The workbench starts with source beside output and one Terminal below. Only
outputs for the selected language and target are shown. Diagnostics and
Pipelines open from **More actions**; compilation errors open Diagnostics
automatically. **Reset layout** restores this arrangement without changing your
source.

Every compilation includes diagnostics, recorded commands, raw streams, timings,
and generated files. A failed stage preserves successful independent outputs.
Expand **Build details** in Diagnostics for stage status and timings. Select a
diagnostic to jump to its source location. **Compare outputs** under **More
actions** opens or closes a second output group, initially comparing LLVM IR
with Graphviz. Both groups have independent selections and resizable widths.
Text views provide line numbers, search, copy, and download. **Find** or
**Ctrl/Cmd+F** searches the focused source or text output; **Ctrl/Cmd+Enter**
compiles from either editor. In the source editor, **Escape**, then **Tab**
moves focus out without inserting indentation. Graphviz has function selection,
zoom, fit, and DOT/SVG downloads. The Wasm inspector lists size, imports,
exports, and function signatures without executing the module.

Comparison and layout resets preserve the source editor's undo history. Assembly
hides compiler metadata by default, retaining code, data, and their directives.
Uncheck **Hide metadata** to see it all. **Copy** uses the displayed text;
**Download** always saves the original file.

The status strip shows download progress in MB, then preparation and compilation
activity. Diagnostics lists the individual compiler downloads and any loading
failure. Progress counts decoded asset bytes against their packaged sizes;
compressed network transfers may be smaller. Asset verification requires HTTPS
or a local server on localhost.

The defaults are C++23, WebAssembly, and O2. C23 and O0–O3 are available. The
packaged LLVM runtime reports WebAssembly, x86-64, and AArch64 backends. Native
targets produce inspection artifacts with Clang built-in headers only; the C/C++
system headers are for WebAssembly.

## Code completion

For WebAssembly C and C++, source-built Clangd provides automatic diagnostics
and completions beside the cursor. It starts lazily on first use, stays alive
for the editing session, and receives the same workspace and mounted package
headers as the compiler. There is no separate completion panel or required
keyboard shortcut. Suspending the language service releases its Worker; the next
request starts a fresh one.

Clangd uses WebAssembly threads, so its host must be cross-origin-isolated. When
the required headers are unavailable, WasmBolt keeps ordinary compilation
working and disables Clangd with an explicit explanation.

## Pipelines

Open **Pipelines** from **More actions** to set LLVM optimization, analysis, and
MLIR passes. An empty LLVM pipeline follows the optimization level, for example
`default<O2>`. Frontend semantics and backend code generation also use that
level. The first IR view has LLVM optimization passes disabled. Analysis
defaults to dominator trees and loops. MLIR defaults to canonicalization and CSE
followed by Arith and Func lowering to the LLVM dialect, so the transformed
module can also be translated to LLVM IR. LLVM inputs with incompatible target
triples or layouts report an error instead of being silently retargeted.
Changing language switches an untouched example to that language; edited source
is preserved. **Reset example**, beside the source filename, replaces it with
that language's example and can be undone. Pipelines shows only the fields
relevant to the selected language.

## Execution

**Compile and Run** builds a current Wasm module when needed and opens the
Execute pane. **Run function** reuses that module when only the selected export
or arguments change. Compilation and inspection never execute generated code.
With the default LLVM pipeline, C and C++ use Clang's normal `-O` compilation
directly to an object in the persistent compiler Worker, then in-process LLD
links it as a shared Wasm module. This path does not start the disposable `opt`
or `llc` Workers. Those tools remain available for explicit IR, graph, assembly,
object, custom-pipeline, and terminal requests. The current build is equivalent
to:

```sh
clang++ -O2 -fPIC -fvisibility=default -c source.cpp -o output.o
wasm-ld -shared --unresolved-symbols=import-dynamic output.o \
  -o program.wasm
```

The runner loads `program.wasm`, discovers its scalar exports from the Wasm type
section, and calls the selected export. `--export-dynamic` is unnecessary with
`-shared`. A future compiler package can use the natural one-command Clang link
once the pending `ToolSession` Clang dispatch patch is available. The separate
runner worker initializes on first execution. Choose an exported function and
enter its scalar arguments in the Execute pane. Callable signatures may use any
number of `i32`, `f32`, and `f64` parameters and zero or one scalar result. The
Execute selector lists callable scalar exports; the Wasm inspector lists every
export. Pointer, aggregate, `i64`, reference, vector, and multi-result
interfaces are not supported. A compatible selection survives a rebuild;
otherwise the runner prefers supported `main`, then a sole callable export.
Ambiguous exports require selection. `main(i32, i32)` receives `argc = 0` and a
null `argv`.

The pane shows the return value, stdout, stderr, status, and errors. Repeated
calls retain module state. **Reset execution**, **Stop**, timeout, traps, and
module replacement discard the runner without losing compilation artifacts. The
default execution timeout is 10 seconds, configurable under **Execution
settings** in the Execute pane; it starts after initialization. NaN is a valid
return value. Execution requires WebAssembly; native targets remain available
for inspection.

## Debug with LLDB

WasmBolt runs LLDB-DAP and WAMR together in one disposable debugger Worker.
Starting the debugger from C or C++ source creates a separate `debug.wasm` with
DWARF, `-O0`, and the matching Emscripten standalone runtime. The ordinary
shared `program.wasm` remains the fast execution artifact.

If the source has `main`, the debug program enters it through Emscripten's
`_start`. For a function-only example, WasmBolt reads the selected export's
actual Wasm signature and generates a temporary `main` that calls it with the
values from **Execute**. The wrapper and intermediate objects disappear from
Explorer after linking; no application signature is hardcoded.

To debug from the panel:

1. Compile the current C or C++ source and select the function and arguments in
   **Execute**. **Start** also performs the ordinary compile if needed.
2. Select the editor gutter, or press F9 on a source line, to add a breakpoint.
3. Open **Debugger** with the bug button, then choose **Start**.
4. When execution stops, inspect Variables and Call stack. Use Continue, Pause,
   Step over, Step into, Step out, Restart, or Stop from the debugger toolbar.

An imported standalone Wasm module can also be debugged directly. Keep its exact
source files in `/workspace`, include DWARF when building it, select the module
in Explorer, and choose **Use module**. A typical external Emscripten debug
build uses `-g -O0 -sSTANDALONE_WASM=1`.

The Debug console accepts ordinary LLDB commands without a prefix. The bottom
Terminal accepts the same commands with an `lldb` prefix while a debug session
is active:

```text
lldb frame variable value squared
lldb bt
```

Both inputs use DAP `evaluate` in the active LLDB-DAP session, so breakpoints,
the selected frame, variables, and process state remain synchronized. The
Terminal does not launch a separate `lldb` executable; start the session from
the Debugger panel first. Stopping or restarting discards the debugger Worker
without disturbing the compiler or its workspace files.

## Commands, files, and sharing

The **Terminal** routes `clang`, `clang++`, `opt`, `llc`, `wasm-ld`, `mlir-opt`,
`mlir-translate`, `dot`, and the packaged LLVM utilities to their runtime
workers. It accepts single and double quotes, backslash escapes, and `>` / `2>`
redirection. Quote LLVM pipeline arguments containing angle brackets. Each
command runs one tool; shell pipelines and input redirection are not supported.
During an active debug session, `lldb <command>` sends the text after `lldb`
through DAP `evaluate` to that same LLDB-DAP session. It does not load a second
LLDB runtime. For example:

```text
opt "-passes=print<domtree>" -disable-output optimized.ll 2> tree.txt
dot -Tsvg .square.dot -o square.svg
lldb frame variable
```

The current directory is `/workspace`. Compile fills it with source and
generated files. Manual commands can use explicit libraries and compiler flags;
their output updates the workspace while completed build artifacts remain
unchanged. A new Compile replaces the workspace. Worker recovery retains its
latest snapshot. Explorer lists workspace files and opens editable files in the
source editor. **Load Wasm** imports and selects an external module; a manual
link to `/workspace/program.wasm` makes that module current. Keep files under
`/workspace` to include them in snapshots and the runner's dependencies.

In standalone, **Copy share link** under **More actions** copies a link with
your source and compiler options. Opening it restores them without compiling or
running. Binaries, logs, layout, and execution state are excluded. Sharing is
unavailable in JupyterLab and JupyterLite, where sessions belong to the host
workspace.

Source, pipeline options, output selections, comparison layout, pane sizes, and
execution timeout are saved automatically. Jupyter also keeps a browser copy of
recent edits for each workspace. Reopening restores the session without
compiling. Output is marked out of date when source or options change. Invalid
saved state opens a default session with a warning. Compiled artifacts, command
files, and running processes are not saved.

## C and C++ notebooks

Our JupyterLite site includes xeus-cpp 0.10.0, with C23 and C++23 kernels. Open
**C++ examples.ipynb** or **C examples.ipynb** and choose **Run → Run All
Cells**. The examples use packaged standard library headers, define functions,
and reuse state across cells.

The notebook interpreter runs in its own browser worker. It is independent of
WasmBolt's compiler explorer: code, options, and results are not synchronized
between them. Its Clang version also differs from the explorer's LLVM runtime.
The first kernel start downloads the interpreter and its libraries. Browser
memory limits apply; native processes, native platform APIs, and arbitrary
native libraries are unavailable.

These kernels run in the bundled JupyterLite environment. They are not native
JupyterLab kernels.

<!-- guide:end -->

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete Pixi setup and build
sequence. The compiler is a separate heavyweight build; frontend builds require
its generated assets and verify their hashes.

For an already built checkout:

```sh
pixi run --as-is jupyter lab
pixi run --as-is jlpm serve
pixi run --as-is jlpm serve:standalone
```

In JupyterLab or JupyterLite, select **Open WasmBolt** in the launcher or
command palette. The Lite testbed is served on port 8080; the standalone preview
prints its local address. These commands run in separate terminals.

Built standalone and Lite directories can be served below a URL prefix. Keep
each site's `compiler` assets at their generated relative location. Serve `.js`
as JavaScript, `.wasm` as `application/wasm`, and `.data` as
`application/octet-stream`. Serve compiler-package `.tar.gz` files as raw bytes
with `application/gzip` and no `Content-Encoding`; HTTP decompression would
invalidate their manifest sizes and hashes. Compilation works offline after
initialization. MLIR and execution each need their runtime assets loaded before
offline use; offline page reload is a separate feature.

## Architecture

- Pure model, request construction, and diagnostic parsing.
- One instance-owned store outside React.
- Lumino commands orchestrate semantic changes and compiler effects.
- Functional React views, with explicit store and CodeMirror bridges.
- A shared Lumino workbench owns workers and view lifecycles, with tab panels
  inside resizable split panels. Jupyter owns docking of the workbench itself.
- Thin Jupyter and standalone adapters supply shell, persistence, and share
  URLs.

The shared package entry exports these contracts. Only `src/jupyter/` imports
JupyterLab packages; the plugin retains `wasmbolt:plugin`.

The compiler API returns `Result.artifacts`, `Result.stages`, and
`Result.files`. Artifacts carry their build ID, kind, path, and text or binary
content. Stages record status, commands, raw streams, diagnostics, and duration.
Consumers should select artifacts by kind and account for partial failures.
`ICompiler.compile` accepts stage progress; `ICompiler.command` returns a stage
and replacement workspace snapshot. `Options` includes the three pipeline fields
and the four input languages. `IRunner`, `RunRequest`, `RunResult`, and
`inspectWasm` are exported separately. Treat all returned binary buffers as
immutable; transport never detaches buffers already owned by application state.

Command names describe actions, such as `CommandIDs.setSource`,
`CommandIDs.resetLayout`, and `CommandIDs.selectOutput`. Their IDs use the same
words in kebab case, such as `wasmbolt:set-source`. Jupyter registers
`CommandIDs.open`; `registerCommands` takes an `ICommandContext` for the shared
commands.

`WasmFunction.signature` is display text, such as `i32(i32)`.
`WasmFunction.callable` reports whether the browser runner can represent an
export's scalar WebAssembly signature. Pass its discovered parameter and result
types as `RunRequest.signature`; the runner is not limited to a fixed signature
table.

## Runtime and limits

The runtime is reproduced from WasmBolt with LLVM 23.1.0 and Emscripten 4.0.9.
[runtime/README.md](runtime/README.md) records its origin, pins, licenses, and
build details. Generated `compiler/manifest.json` records asset sizes and
SHA-256 hashes. Browser test attachments record timings and Wasm memory
observations.

The LLDB-DAP runtime uses its separately pinned Emscripten 6.0.8 and WAMR
inputs. [native/debugger/README.md](native/debugger/README.md) contains the
complete source build, browser smoke, and staging recipe. It produces only the
one `lldb-dap` module and its pthread Worker, never a standalone `lldb` module.

Each initialized compiler or runner is large and reserves 256 MiB of initial
Wasm memory, with memory growth enabled and a 32 MiB stack. Running a program
alongside the compiler therefore requires two instances. Browser memory limits
still apply. Cancellation releases the worker; a later compile must initialize
another. Initialization and runtime failures offer a retry path. Ordinary
compiler errors retain diagnostics and raw output.

The genuine MLIR command runtimes download only when MLIR is used, with the same
integrity checks, progress, cancellation, and retry behavior as the core. MLIR
exploration uses explicit passes; automatic lowering to an executable, automatic
compilation, and notebook synchronization remain outside the explorer.

LLVM binary utilities run through LLVM's multicall driver in a fresh worker per
command. This keeps one-shot inspection tools out of the long-lived compiler
process while preserving the same `/workspace` snapshot. Emscripten-forge
packages are delivered as separately verified empack archives; the initial
environment provides `xtensor` without baking its headers into `Compiler.data`.

## Acknowledgments

WasmBolt combines its browser compiler runtime and LLVM lifecycle adaptations
with a shared React/Lumino workbench, compiler worker service, and JupyterLab,
JupyterLite, and standalone integrations.

The workbench and Jupyter integrations include BSD-3-Clause work by A. T.
Darian. The original copyright and license notice remain in `LICENSE`.

The compiler itself is provided by LLVM/Clang and built for WebAssembly using
Emscripten.

Our notebook environment uses
[xeus-cpp](https://github.com/compiler-research/xeus-cpp), CppInterOp, and
[jupyterlite-xeus](https://github.com/jupyterlite/xeus), with browser packages
from [emscripten-forge](https://github.com/emscripten-forge/recipes). Their work
makes interactive C and C++ notebooks possible without a server. The Lite build
preserves package license notices alongside the kernel assets.

## License

WasmBolt is BSD-3-Clause licensed. The compiler incorporates separately licensed
software. Required notices are included in `runtime/licenses/` and copied into
each distribution.
