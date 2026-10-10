# LLDB browser runtime summary

The focused reproduction is LLVM-main LLDB-DAP plus WAMR's classic interpreter,
compiled into one pthread-enabled Emscripten module. The bridge replaces socket
I/O with an in-memory GDB-remote connection. LLDB retains breakpoint, stepping,
frame and variable semantics.

The source pins and build stages are in [README.md](README.md). The two local
upstream patches are in `patches/`. Native bridge sources are needed too:
patches alone cannot reproduce the browser transport and DAP event loop.

## Fixes retained from the latest build

- Emscripten source loading calls the initializer synchronously. LLDB's nested
  async source task could block stopped-frame variable inspection.
- One listener consumer publishes DAP process events. The bridge stops native
  DAP event threads and polls the listener from its owning worker.
- `EXIT_RUNTIME=0`, `noExitRuntime` in the incoming API, and the module
  factory's `noExitRuntime: true` preserve pthreads between commands. Without
  them, mailbox callbacks could terminate the runtime and delayed resumes timed
  out.
- WAMR answers unsupported `qWasmStackValue` with an empty RSP reply. Silence
  caused packet timeout/recovery interrupts when inspecting startup frames.
  Operand-stack variable locations remain unsupported.
- Running/stepping process events arm the next stop, including resumes through
  LLDB REPL commands rather than DAP toolbar controls.
- Captured WASI stdout/stderr are forwarded as incremental DAP output, with a
  final drain before exit.

The small UI adapter now publishes stopped state before inspecting variables,
invalidates stale frame requests, and keeps exit authoritative over late Continue
acknowledgements. Pause is enabled only while running. The bug button changes
panel visibility independently of session lifetime. Restart/Stop invalidate old
start requests before replacing the Worker. No previous app framework is imported.
Opening the panel preloads LLDB's compiled module into a page-level cache. Fresh
process Workers reuse that code through `instantiateWasm`, including their
pthreads. Hiding the panel, Stop and Restart preserve the cache; the browser
acceptance check counts asset requests across all examples and restarts.
The Variables panel expands LLDB's child references on demand, including nested
structs and arrays. Stepping or changing frames discards the previous stop's
children. C++ field updates, restart and exit are verified alongside the
C/C++/LLVM IR examples; this UI change needs no new LLVM or WAMR patch.

## Validation and limits

The previous verified browser matrix covered C, C++, LLVM IR, delayed resumes up
to 60 seconds, delayed attach/configuration, adjacent/distant breakpoints,
Pause, iostream, JSON, xtensor and stepping out of `main` into `_start`. The
maintained runner and guests remain here so those checks can be repeated.

C/C++ programs are linked as standalone Wasm. The compiler/linker pipeline is
separate from the debugger: this recipe uses Emscripten to produce test guests.
The product's in-browser Clang and wasm-ld integration is not duplicated here.

LLVM IR requires its own DWARF metadata. Unsupported operand-stack locations can
produce variable errors but must not prevent Continue. Nested xtensor
formatting, arbitrary debugger expressions and poisoned-session recovery need
further validation. Swift debugging uses Swift's matching LLVM/LLDB fork in the
separate Swift recipe.

The IR example explicitly binds `sum` and `result` using `llvm.dbg.value` and
`DILocalVariable` metadata. SSA names alone do not create debugger variables.
After executing the addition, `sum=42` is visible at `ir_add`'s return; after
the caller assignment completes, `result=42` is visible at `main`'s return.

## Upstream boundaries

The LLDB source-loading patch is an Emscripten-specific LLVM candidate. The WAMR
patch adds embedded transport/session behavior without browser UI concepts. It
needs standalone native/socket regression tests before proposing upstream.
Neither the product UI nor its dependency tree belongs in these upstream
patches.

## Build and runtime boundaries

| Component | Build |
| --- | --- |
| Main Clang/wasm-ld module | Existing single-threaded 6-x packages |
| LLVM/Clang dependencies inside LLDB | Static archives with `-pthread`, `LLVM_ENABLE_THREADS=ON` |
| LLDB-DAP, bridge and WAMR classic interpreter | Static pthread build |
| LLVM/MLIR/Graphviz tools | Independent single-threaded modules in disposable Workers |
| Guest C/C++/IR program | Single-threaded standalone Wasm with WASI |

The separate compiler module does not share C++ archives or memory with LLDB.
LLD is not an LLDB dependency here. Guest DWARF connects the two modules, so
main's LLVM 23.1.2 packages and the pinned LLDB build can coexist. Compiler/linker
load on page startup; LLDB preloads on panel opening. Each debug session creates
fresh process memory while reusing the compiled LLDB module until page reload.

`WASMBOLT_DEBUGGER_INPUT_DIR` reuses completed static inputs;
`WASMBOLT_DEBUGGER_WORK_DIR` selects new bridge/output/test files. Both default
to `.work/`. Optional libxml2 is disabled unless `LIBXML2_PREFIX` supplies a
compatible static Emscripten build. The recorded SDK package hash is macOS arm64;
other hosts must supply Emscripten 6.0.8. Host and guest modules are wasm32.

For library runtime fixtures, set `NLOHMANN_JSON_INCLUDE_DIR` or
`XTENSOR_INCLUDE_DIR` before stage 60. The latter needs both xtensor and xtl
headers. `node smoke/run.mjs matrix` requires these optional guests. Individual
checks include `llvm-ir-step-out-main 0` and `step-in-out-delayed 60000`;
reports go to `.work/test-results/`.

Variables before assignment are uninitialized. Step out may stop on the caller's
call line; Step over completes its assignment. The six initial workspace sources
are editable before the compiler loads; generated `debug.o` and `debug.wasm`
appear after Start.

## Current repository boundary

Based on the 6-x structure on 2026-10-10. All reproduction files are under
`debugger/lldb/`, including the isolated browser-check dependency. Main's CMake, compiler/linker adapters and published-tool Workers are retained.
The merged UI receives a small debugger hook and current-line styling; actual
session handling stays under `debugger/lldb/`.
The original pinned LLVM/WAMR revisions remain deliberate reproducible inputs;
this refresh does not claim a newer LLVM build or LLDB forge package. Build
outputs, SDK packages, sources and dependency installations are ignored.

## Refresh on the merged UI (2026-10-10)

Base: WasmBolt main `372acf6` (2026-10-10), including clangd and inline terminal input. The browser compiler/linker and tool
assets use the existing 23.1.2 6-x build. LLVM/Clang/LLDB pthread archives and WAMR
were preserved; the bridge was rebuilt and LLDB relinked into a new output tree
with Emscripten 6.0.8. This is not a full fresh LLVM compilation.

An old generated debugger artifact stepped correctly but missed captured guest
stdout. Relinking the checked-in bridge restored incremental output and the
final drain before exit. The build scripts are the source of truth; cached
artifacts must not be assumed to contain every bridge fix.

The staged site copies only browser assets. It supplies the standalone guest
link archives separately, uses a dedicated LLDB Worker/pthread pool, and connects
DAP attach/breakpoints/configuration before allowing execution. Generated sources,
build trees, packages and screenshots remain ignored.

The library demonstration uses `nlohmann_json` 3.12.0 build `h2d46287_0` from the
6-x channel (Emscripten ABI 6.0.8, SHA-256
`cb6771f9e38a06403701074e2857907c8a0d73da58e9f23e29955f009745d99a`).
The cached xtensor 0.27.1 package targets Emscripten 4; it is not used as a 6-x
package demonstration. Its existing native-built guest remains an optional
runtime regression case; nested formatter coverage remains limited.

Current local UI checks cover freshly browser-compiled C, C++, LLVM IR, JSON,
iostream output, delayed steps, Pause, Stop/restart, console commands and panel
visibility. The fresh runtime's 19-case browser matrix also passes, including
60-second resumes, delayed attach/configuration and stepping from main into
startup code. The public preview is tested through its HTTPS URL, not merely
by inspecting response headers.
The local and public UI checks also confirm exactly one compiler Wasm/data
request and one LLDB Wasm request across all examples, panel toggles and Restart.
Opening the panel preloads LLDB before Start without starting a guest process.
The workspace now starts with six sources, independently of the compiler
download: `snippet.cpp`, `simple.cpp`, `simple.c`, `json.cpp`, `debug.ll` and
`input.mlir`. The C++ debugger example includes iostream output. Source edits
made during startup are retained when the compiler filesystem becomes available.
The browser check deliberately holds the compiler download to verify this.

The static demo is deployed at https://wasmbolt-lldb-demo.pages.dev and remains
available while the Mac sleeps. The production browser check passes C++, C,
LLVM IR and JSON compilation/debugging, iostream output, Pause, panel toggles,
Stop/restart, console commands and one runtime download per page session.
`80-stage-pages.mjs` compresses a separate upload tree to meet Pages' asset limit;
the original builds are preserved. Production serves decoded assets correctly;
Wrangler's local Pages preview can double-compress the large files.

Remaining scope: browser/platform coverage beyond tested Chrome, richer variable
trees/formatters, external package/SDK source viewing and arbitrary guest exception
support. Those external sources are not copied into the LLDB filesystem yet. Direct MLIR source-level
debugging is not implemented. Other hosting targets must preserve isolation
headers and account for large Wasm assets. Swift work follows this branch and must replace LLDB with the
matching Swift fork rather than mix archive ABIs.

## Hosting reproduction

The local server applies COOP `same-origin`, COEP `require-corp` and CORP
`same-origin`. Stable hosting needs those headers and HTTPS for pthreads. Plain
GitHub Pages does not apply the staged `_headers` file. A temporary
`cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8767` depends on the
Mac remaining awake; the deployed Pages demo does not.

From the repository root, after stage 70:

```sh
node debugger/lldb/scripts/80-stage-pages.mjs
npx wrangler@4.149.0 login --device --scopes account:read user:read pages:write
# Create once; --force selects Pages instead of Workers delegation.
npx wrangler@4.149.0 pages project create wasmbolt-lldb-demo --production-branch main --force
npx wrangler@4.149.0 pages deploy debugger/lldb/.work/pages \
  --project-name wasmbolt-lldb-demo --branch main --commit-dirty=true
```

The separate upload tree Brotli-compresses Wasm, data and archives at unchanged
URLs, with `Content-Encoding: br`. Browsers decode them automatically. The script
rejects files above Pages' 25 MiB asset limit; this deployment is about 104 MiB,
with its largest asset about 22 MiB. Builds and the ordinary local site remain
unchanged. Wrangler's local Pages preview can double-compress large assets;
use `serve.py` locally and verify production with
`node smoke/product.mjs '<public-url>/?debugger=1'` before sharing.

The branch is based on main after the resident-Clang pipeline, compiled-tool
cache and shared Debug target selector. Source builds and existing workspace
Wasm modules use the same picker. Restart retains the launched program and
source snapshot even when stepping changes the active editor.
