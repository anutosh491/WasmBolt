# Swift browser build summary

Swift compilation and Swift-aware LLDB use the preserved build from 2026-10-04.
This branch is based on structured WasmBolt main `372acf6` (2026-10-10), including
resident Clang outputs, cached analysis modules and the shared Debug target picker and optional clangd. It extends that UI directly;
no workbench, Jupyter/Lumino application or old dependency tree is imported.

Keep three reviewable layers: Swift compiler integration, matching Swift
LLDB/WAMR integration, then the persistent Wasm REPL. Each includes its own
source patches, build steps and usage instructions.
Builds remain uncommitted and are preserved separately from these source files.

## Source pins

| Component                       | Revision/version                           |
| ------------------------------- | ------------------------------------------ |
| Swift main, 6.5                 | `6b8daddf6f30bb1bbdcaaede7f673e76eb155278` |
| Swift LLVM `stable/23.x`        | `ab70a4c40271da180ff2fcf2d92cd24bee8a2cb3` |
| cmark                           | `0c8947bbd58c491c54aae114aca40621cddc8357` |
| StringProcessing                | `a6ac4f725d0a28e8fa01ed2a2f23b97add65b776` |
| Emscripten, emscripten-forge-6x | 6.0.8                                      |

The previous `emscripten-repl` experiment was reviewed, but its ORC runtime path
is unnecessary for the object-file pipeline. Swift frontend and Wasm LLD are
static libraries in one browser module. The upstream C++ Swift driver plans and
schedules jobs; a serial browser TaskQueue calls the frontend, autolink extractor,
Clang link driver and Wasm LLD in-process. Repeated calls share the module's filesystem.
The newer Swift-written driver is not ported here. Script interpretation, the
REPL, SwiftPM and external tool jobs are not provided by this compiler module.

Native TableGen and a matching native Swift frontend bootstrap the cross build.
Swift-written compiler modules remain enabled with `CROSSCOMPILE`; disabling
Swift-in-Swift no longer works at this revision. A pthread Swift runtime
supports the compiler's Swift code. A separate single-threaded static runtime
supports ordinary guest programs and WAMR.

The compiler Wasm is 125 MiB and Swift-enabled LLDB Wasm 138 MiB before HTTP
compression. The core SDK archive is about 23 MiB gzip, with an optional
28 MiB Foundation archive, including matching Emscripten link inputs and Clang
resource headers. Identical root/wasm32 runtime
archive copies are packaged once; linker paths use the wasm32 directory.

## Product integration

`compilers/swift/client.js` owns one resident compiler Worker and its pthread
pool. The bridge dispatches Swift driver, frontend and Wasm LLD calls serially in the
same module and filesystem. Workspace sources and referenced inputs are copied
in; generated files are mirrored back into WasmBolt's Explorer. Compiling uses
normal `swiftc` commands for AST, SIL, IR, optimized IR, assembly and objects.
Programs link a separate static guest runtime and run in fresh Wasm instances.
`sdk/wasmbolt.cfg` provides browser SDK defaults before user arguments; Swift's
driver validates all options. `sdk/static-executable-args.lnk` supplies the
WebAssembly toolchain's standard runtime link response file. The autolink
extractor discovers imported Swift libraries from object files. Tool paths in
MEMFS identify in-process entry points; they are not native subprocesses.
The link response file uses `--no-stack-first`: Swift's WebAssembly driver
reserves the first 4096 bytes with `--global-base=4096`, which conflicts with
LLVM 23's default stack-first layout when the stack is larger than that. The
SDK places the stack after data. This default-driver compatibility issue is
another candidate to discuss upstream; no LLVM source workaround was added.

`debugger/lldb/` owns the shared DAP transport, WAMR classic interpreter and
panel. Opening the panel preloads LLDB and the headers/modules SDK in parallel.
Start compiles full DWARF types, copies the selected guest/source and installs
that SDK in a fresh LLDB Worker. Compiled LLDB and SDK bytes are cached for the
page; Stop/Restart replace the process, while hiding the panel preserves it.

The normal product retains C/C++/IR/MLIR controls and the current main toolchain.
`70-stage-site.py --swift-only` stages a dedicated demo from these same sources:
standalone Fibonacci/FizzBuzz examples and a two-file `math.swift`/`main.swift`
program, only the WebAssembly target and no Clang/tool binary download.
Its UI filesystem is a small workspace mirror; the real compiler SDK/FS belongs
to the Worker. The demo exercises Fibonacci and FizzBuzz, with Unicode output.

## Threading and ABI

| Build | Configuration |
| --- | --- |
| Swift's LLVM, Clang and LLD | `20-configure-wasm-llvm.sh`: `LLVM_ENABLE_THREADS=ON`; common `WASM_FLAGS` contains `-pthread` |
| Swift frontend and compiler Swift runtime | `30-configure-swift.sh`, host mode in `38-configure-stdlib.sh`: pthreads; bridge pool of four |
| Swift-aware LLDB | `45-configure-lldb.sh`: Swift support, static libLLDB and LLVM threads enabled; `49-link-debugger.py` links pthreads with pool of 16 |
| WAMR debugger host | `debugger/lldb/scripts/20-build-wamr.sh`: classic interpreter/debug engine with pthreads |
| Compiled guest Swift program | Guest mode in `38-configure-stdlib.sh`: `SWIFT_THREADING_PACKAGE=none`; independent static runtime |

Both host and guest ABI are wasm32. Swift's pinned LLVM fork supplies the Clang
importer and linker as well as LLDB. Never mix it with LLVM-main LLDB archives
or the separately published 6-x development libraries. The existing WasmBolt
Clang module remains single-threaded. Hosting the threaded modules requires
COOP/COEP isolation headers (the local server supplies them).

Host pthreads are used during compilation, not only by LLDB. At this Swift
revision, `IRGen.cpp` starts a `std::thread` to release SIL even on the ordinary
single-codegen-thread path. A browser audit also observed overlapping threads
while importing Foundation. A pool of one exhausted during JSON compilation;
two and four passed Date, JSON and Fibonacci compilation at all three
optimization levels and basic Foundation REPL cells. This limited comparison
does not establish a benefit from reducing the existing pool of four, which is
retained for the demo. Pthread workers share host linear memory; they do not
each receive a separate 512 MiB heap. User-created guest threads remain outside
this build, and the cooperative concurrency example does not demonstrate
parallel execution.

## Local source fixes

Exact patches are `patches/swift-browser-host.patch`,
`patches/swift-driver-executor.patch` and `patches/lldb-swift-browser.patch`.
No upstream issue or PR was filed for these
findings during the original task.

1. `CompoundDeclName` used pointer-sized alignment on wasm32 although tagging
   needs eight-byte alignment. Use `Identifier::RequiredAlignment` to prevent
   compound-name corruption during string interpolation.
2. `AllocStackInst` and `DebugValueInst` allocated a sum of trailing-field sizes
   without alignment padding. Use `totalSizeToAlloc` with actual field
   order/counts. The old allocation corrupted allocator metadata for arrays.
3. Optimized sibling calls mispassed an aggregate IRGen address with this
   Emscripten toolchain. Build Swift C++ with `-fno-optimize-sibling-calls`.
   LLDB reflection uses the same workaround: without it a correct four-byte
   metadata pointer acquired garbage upper bits when returned through an
   aggregate, breaking class/dictionary children. This still needs a reduced
   toolchain reproducer. Guest Swift
   optimization remains enabled and is tested independently.
4. Reflection task flags require explicit `size_t` conversion when a 32-bit LLDB
   host instantiates 64-bit reflection. This does not enable arbitrary 64-bit
   task inspection in the browser.
5. Import LLD before checking Clang's exported CMake targets. Map Emscripten to
   Swift's WebAssembly toolchain for native SDK bootstrapping.
6. The matching LLVM fork needs Emscripten host/static LLDB support, disabled
   native process spawning, synchronous source loading and Swift resource-path
   configuration. These are included in its recorded patch.
7. `Compilation::performJobs` may replace the host process for a single job,
   bypassing even a caller-supplied TaskQueue. The separate driver patch adds
   an opt-out parameter, defaulting to the existing behavior. The browser
   executor disables it; job scheduling, file lists and temporary cleanup remain
   in the upstream driver. This is an upstream API candidate, not a JavaScript
   rewrite of Swift's command-line flags. Only the driver archive and browser
   bridge needed rebuilding for this change; previous compiler builds were kept.

The alignment fixes are candidates for Swift upstream review. Temporary
diagnostics and allocator canaries used during debugging were removed.

### Upstream check

Checked Swift main at `488fdfe4523bb35326ca384fda4c00e1e5581301`
(2026-10-10). The affected code remains in
[`Identifier.h`](https://github.com/swiftlang/swift/blob/488fdfe4523bb35326ca384fda4c00e1e5581301/include/swift/AST/Identifier.h),
[`SILInstructions.cpp`](https://github.com/swiftlang/swift/blob/488fdfe4523bb35326ca384fda4c00e1e5581301/lib/SIL/IR/SILInstructions.cpp),
[`Compilation.cpp`](https://github.com/swiftlang/swift/blob/488fdfe4523bb35326ca384fda4c00e1e5581301/lib/Driver/Compilation.cpp)
and [`ReflectionContext.h`](https://github.com/swiftlang/swift/blob/488fdfe4523bb35326ca384fda4c00e1e5581301/include/swift/RemoteInspection/ReflectionContext.h).
The declaration-name and trailing-allocation fixes address observed compiler
corruption; the reflection cast addresses a cross-build error. The driver change
is an API request for embedded execution. Sibling-call disabling remains a
toolchain workaround requiring a reduced reproducer. None of these Swift
findings has been submitted upstream by this task; source pins remain unchanged.

## Debugger

Swift-enabled LLDB uses the same LLDB-DAP/WAMR bridge as the focused LLDB
recipe. Debug builds use full DWARF types (`-gdwarf-types`, DWARF 4, `-Onone`).
The debugger installs the matching SDK and sets its Swift module/Clang include
paths before attach. The Variables panel lazily expands LLDB's child references;
stepping, changing frames and ending a session discard stale children.

`45-configure-lldb.sh` also applies two focused reflection patches:

- `lldb-swift-wasm-reflection.patch`, against Swift's LLVM/LLDB fork, registers
  the named `swift5_*` data segments from live linear memory. Wasm has no
  loadable image header, so the existing header-address path skipped them.
  Symbol lookup also requires an exact load-address match: overlapping Wasm
  code/data file offsets otherwise associated a type descriptor with an
  unrelated function, corrupting symbolic type-reference decoding.
- `swift-reflection-heap-layout.patch`, against Swift, uses a pointer-sized
  inline reference count in both class-layout readers. On wasm32 the heap
  header is eight bytes, not twelve; the previous calculation read the wrong
  field offsets. The 64-bit header remains sixteen bytes.

The browser compiler also dispatches Swift's existing `-modulewrap` job, used
by ordinary `swiftc -g` builds, in-process rather than rejecting it as an unknown
tool. This is browser integration, not a Swift source patch.

These are upstream contribution candidates, separate from WasmBolt's UI and
transport. No upstream submission has been made by this task. The browser
reproducer compiles its own Swift struct, enum, array and nested generic value,
then inspects the resulting program with this same LLDB/WAMR build.

Shared fixes preserve pthreads between commands, arm stop publication after debugger
resumes, and forward captured WASI output before exit. The test enters through
the standalone startup path so constructors and output cleanup run. See
`debugger/lldb/bridge/` for the shared runtime. The bridge retains the single
DAP listener, runtime keepalive and final WASI output drain from the LLDB branch.

## Validation and scope

The original browser compiler passed 15 compilation and ten execution checks.
The separated harness repeats those same checks without app imports. Its
debugger test uses the exact browser-produced Wasm: breakpoint at line 7, step
into line 3, arguments 19/23, delayed step over to `sum = 42`, step out,
Continue, `Swift answer: 42` and exit 0. String interpolation, arrays, generics,
normal Swift and all three optimization levels are covered.

The independent harness keeps its small arithmetic fixture as `tests/scalar.swift`;
the user-facing examples are `tests/fibonacci.swift` and `tests/fizzbuzz.swift`. Temporary
product browser checks exercise the current UI, all Swift outputs, program
execution, scalar locals, stepping, lifecycle and compiler error recovery.
Their scripts/reports live in ignored `.work/`, not a new product test framework.
The Fibonacci/FizzBuzz starter runs at `-Onone`, `-O` and `-Osize`. Product checks
also cover new source files, terminal commands, output inspection, restart and
Stop during startup. Compiler and LLDB Wasm each download once per page.
Pause interrupts a running Swift loop; selecting the program frame exposes its
global counter. Continue, a second Pause and Stop also pass.
Both the full product and Swift-only preview render Swift's LLVM CFG with the
existing `opt`/Graphviz tools. Preview checks cover Fibonacci and FizzBuzz,
source/optimization changes and one download per tool across repeated runs.
The normal C/C++/LLVM IR output and tool-cache regression checks pass unchanged.
The driver-backed preview additionally passes version/help, AST/SIL/IR/assembly,
object linking, multi-file compilation, user response files, `-Xfrontend`/`-Xcc`/
`-Xlinker`, dry-run/skip execution, invalid-option/source recovery and all three
optimization levels in Chrome. Fibonacci debugger stepping still shows `next = 1`
and `answer = 55` before exit 0. These development checks remain in ignored `.work`.

Foundation and single-threaded guest concurrency are included as described below.
Macros and compiler regex literals remain outside the validated demo. SwiftSyntax
is disabled; the guest SDK supplies implicit concurrency/StringProcessing imports.
Struct fields, array elements, Unicode string summaries, enum payloads, class
fields, dictionaries and nested generic values are now verified through LLDB reflection and the expandable
Variables panel. Member/element reads such as `point.x` and `numbers[1]` work
without executing target code. Arbitrary Swift expressions/function calls remain
unsupported: `ProcessWasm` disables JIT execution and Swift's expression parser
requires it. The separate Swift REPL runs its own process; it cannot evaluate
code in a paused program's stack frame.

Multi-file debugging is verified with `math.swift` and `main.swift`: a full-DWARF
`swiftc` build links both into one Wasm program. Choosing that `.wasm` under
Debug target makes Start use the existing binary; Restart retains it as stepping
changes the active editor. Breakpoints in both files resolve, Step into opens
the callee, selecting stack frames opens either source, and Step out returns
to the caller. The checks inspect `next = 1`, `answer = 6765`, stdout and exit 0;
single-file Swift source-build debugging still passes with the same cached tools.

## Wasm REPL

The REPL ports the interpreter from [Swift PR #1](https://github.com/anutosh491/swift/pull/1),
head `6f48c1dd2f9268cb03598675a69eb3713311f5a2`, onto the pinned Swift revision.
`swift-repl-browser.patch` contains the interpreter, REPL source-file handling,
AST transformations and Wasm executor. Native execution retains ORC; Emscripten
execution emits a PIC object per cell, invokes Wasm LLD in process, loads the
side module with `dlopen(RTLD_GLOBAL)` and calls its wrapper. Earlier modules
remain loaded so subsequent cells can reference their definitions and metadata.
LLDB is independent; its Wasm process plugin does not provide a JIT.

`60-build-repl.sh` reuses the compiler's LLVM, cmark and host Swift runtime,
but builds Swift's immediate-mode libraries in an isolated source/build tree.
The existing compiler and debugger modules remain usable. The REPL host uses
`MAIN_MODULE=2`, pthreads and one copy of the static host Swift runtime. Cells
import that runtime rather than linking another copy. Matching PIC
`crtbegin-mt.o` supplies TLS initialization required by Emscripten's loader.
Each cell also links the matching `swiftrt.o`, whose constructor registers its
Swift type and protocol-conformance sections with the host runtime. The
Foundation side module includes the same startup object. Omitting it left new
types undiscoverable during runtime generic lookup; a REPL-defined Codable
struct reached a null metadata pointer when JSONEncoder first used it. This
registration is part of `swift-repl-browser.patch`, not a Swift runtime workaround.
`-Bsymbolic` binds definitions in a cell locally while leaving references to
previous cells and the host as imports. No duplicate LLVM-option workaround is
included.

`lld-relative-data.patch` fixes locally bound location-relative data relocations
in Swift's LLVM fork. Swift metadata and C++ relative vtables store distances
between addresses. Both addresses move by the same load base, so their difference
is already final; LLD previously tried to emit an unsupported runtime relocation.
The separate upstream LLVM patch has wasm32/wasm64 regressions for local/hidden
symbols, `-Bsymbolic`, PIE and nonzero addends, plus negative coverage for
preemptible and absolute targets. This recipe records the same narrow fix.

`repl.js` owns a separate Worker. Entering `swift repl` in the advanced terminal
starts the session; multiline input accumulates until complete. `:reset` creates
a fresh Worker while reusing the compiled Wasm module, and `:quit` returns to tool
commands. Compile errors keep the session alive; execution failures stop it.
Ctrl+C terminates the REPL Worker, including a cell stuck in a loop.
The compiler/linker and debugger use their existing independent Workers.

The production build passes the browser cell gate: persistent state, displayed
expressions, multiline functions, Unicode output, arrays/map, structs, string
interpolation, generics, classes, enums, compile-error recovery and reset.
The product UI also passes multiline prompts, Ctrl+C during an infinite loop,
quit/re-entry, compilation and Fibonacci debugger stepping after the REPL.
Compiler, REPL and LLDB binaries each download once per page, including resets
and interruption. Validation uses the production bridge without probe exports.
Generated cells and all build/test reports remain under ignored `.work/`.

## Current repository boundary

Refreshed onto latest structured `main` on 2026-10-10. `compilers/swift/` owns
this recipe; `debugger/lldb/` contains only the shared interpreter/transport
needed by Swift. Both feature branches can be reproduced from their own checkout
without importing another app or branch. Swift's LLVM fork, pthread compiler
runtime and guest SDK remain separate from the published 6-x main toolchain.
No source pins were advanced during this structural refresh. The UI adapters extend
the already-merged debugger panel. The Swift-only demo is deployed separately;
the existing C/C++ LLDB demo is untouched by this Swift refresh.

SourceKit-LSP is deferred to a separate editor-support change. The main branch's
clangd integration remains available for C/C++. This Swift build disables
SourceKit; a browser language service needs additional SourceKit/dispatch support,
and the full Swift-written LSP also needs libraries such as Foundation and
SwiftSyntax. Compiler, debugger and REPL do not depend on that future port.

## Foundation and guest concurrency (2026-10-11)

The optional `41-build-foundation.sh` builds static Foundation, CoreFoundation,
ICU, Collections and libxml2. It uses the existing FetchContent source hooks with
pinned checkouts, then stages modules, C headers and archives in `foundation-sdk`.
`50-package.py` includes that SDK automatically. Foundation is cross-compiled
before deployment; browser `swiftc` compiles user programs and links the imports
in process. No compiler server or server-side Foundation execution is involved.

Foundation, corelibs and ICU use matching Swift 6.2 release sources; the compiler
remains the pinned Swift 6.5 development build. This avoids introducing the
macro plugin/SwiftSyntax build required by newer Foundation sources. Exact pins
are in `sources.json`. `foundation-emscripten.patch` and `corelibs-foundation-emscripten.patch` add
EmscriptenLibc imports and appropriate WebAssembly platform branches. CoreFoundation distinguishes Emscripten from
Unix, sharing existing WASI fallbacks through `TARGET_OS_WASM`. FoundationNetworking,
libdispatch, subprocesses and unsupported OS services are not built.

The guest standard library enables Synchronization and concurrency with the
single-threaded global executor. Actor isolation and task groups work without
making the guest a pthread program. Clocks use actual browser realtime and
monotonic clocks, with equivalent WAMR imports. WasmFS supplies a real in-memory
filesystem. The standalone runtime uses its memory-growing pure-WASI variant;
DateFormatter/ICU otherwise exhaust the minimal heap left after static data.
Link inputs and headers come from the same generated Emscripten cache.

Two additional source fixes are recorded separately:

- `lldb-swift-wasm-strings.patch`: read the 32-bit String enum payload directly.
  A heap-backed `Builtin.NativeObject` lacks the synthetic formatter assumed by
  the old path. JSON-decoded strings previously printed a formatter error even
  though the actual program contained the correct value. Raw enum payload bits
  match `_StringObject.rawBits`; small, literal, Unicode and decoded strings pass.
- `wamr-wasi-command-ctors.patch`: commands exporting `_start` run their own
  constructors. With built-in libc-WASI disabled, WAMR also called exported
  `__wasm_call_ctors` during instantiation. WasmFS then initialized twice and
  asserted under the debugger. The patch skips that eager call for commands,
  including embeddings supplying their own WASI imports. Current WAMR main
  still has the conditional handling in
  [wasm_runtime.c](https://github.com/bytecodealliance/wasm-micro-runtime/blob/main/core/iwasm/interpreter/wasm_runtime.c).
  Interpreter behavior is validated here; the corresponding AOT guard is kept
  consistent but this demo does not build AOT.

Both fixes are upstream candidates. The Foundation Emscripten port also belongs
in its source projects. Swift's EmscriptenLibc overlay re-declares ENOTSUP and
EOPNOTSUPP on this toolchain; qualified EmscriptenLibc constants avoid the ambiguity
in the Foundation port. No untested overlay change is included.

Local browser checks pass Date(), Date arithmetic, ICU DateFormatter, ISO8601
Codable JSON, Unicode strings, actor/task-group execution and deterministic output
at `Onone`, `O` and `Osize`. LLDB stops in both new examples, reads decoded meeting
fields/Date and the task result `55`, then continues to exit 0. Foundation examples
are now split into `dates.swift` and `json.swift`, beside `concurrency.swift`,
Fibonacci and FizzBuzz. The previous combined example passed on deployment
`c6e051ae`; the split examples pass the local compiler/debugger gates, including
all five compiler output tabs, nested attendee inspection, stepping and clean exit.

Async @main frame-local locations are not yet reliable: one probe printed `55`
but exposed a stale `0` in its suspended async frame. The concurrency example uses
top-level await and a synchronous reporting function with verified variables.
Arbitrary paused-frame expression execution still requires a Wasm LLDB JIT
backend. The independent REPL is not a replacement for evaluating code in that
frame. Foundation REPL work uses its own matching host runtime and side module;
it does not change the compiler/debugger runtimes or guest linking defaults.

## Demo performance and separate REPL SDK

The compiler downloads its Wasm and core SDK concurrently and starts Wasm
initialization as soon as that binary arrives. It remains resident. Foundation
loads on the first relevant import or link, rather than before compiler readiness.
Workspace synchronization sends changed inputs, propagates deletions and avoids
copying a generated Wasm binary back into the compiler before rebuilding it.
Compile & Run uses one `swiftc` compile/link job sequence. LLDB receives only
headers/modules (about 18 MiB gzip), rather than the compiler's link libraries.
These archives package existing local build outputs for automatic browser loading;
they are not additional compiler builds or changes to emscripten-forge recipes.

Warm local Chrome compile/link calls measured roughly 0.5 s for Fibonacci and
1.3 s each for JSON and Date. Matching native compile/link measurements were
about two to three times faster; this demo does not claim native performance parity.
The split programs also reduce linked output: JSON is about 21 MiB, Date about 65 MiB.

The REPL uses `repl-modules.tar.gz` from the pthread host standard library.
`61-build-repl-foundation.sh` packages matching host Foundation modules and a
separate shared Wasm library, loaded only when imported. Its runtime export list
comes from that library's imports. `swift-repl-runtime-loading.patch` canonicalizes
library paths before `dlopen`; `corelibs-foundation-without-dispatch.patch` retains
run-loop mode constants and omits unavailable Timer operations without Dispatch.
The bridge supplies WASI argument imports, reports the compiled Swift version
and uses numbered prompts. Bare `swift` shows help; `swift repl` starts evaluation.

The combined browser gate passes 44 standard-library and Foundation entries,
including Date/DateFormatter, Unicode Codable JSON, CommandLine arguments,
run-loop constants, error recovery and reset. A fresh Foundation import also
works after reset. Async REPL cells remain unvalidated.

Profiling the long session exposed repeated recursive walks in
`ModuleDecl::collectLinkLibraries`. Each source-module visit started another
traversal with its own visited set, revisiting the earlier REPL cells and
collecting duplicate libraries. `swift-link-library-traversal.patch` collects
each module's local libraries using the existing shared traversal instead.
The same 44-entry gate went from exceeding 240 seconds to completing in about
16 seconds, including page/REPL startup and reset, in local Chrome. These are
end-to-end measurements, not a claim of native performance parity.
An additional 87-entry stress run retains 80 definitions, imports Foundation
late, then encodes and decodes a new Codable type. Cell execution totals about
7.3 seconds locally; the last simple declarations take about 25 ms each, and the
first Foundation import takes about 3.6 seconds including loading its SDK/library.

The recursive call is also present in the upstream Swift main source checked
on 2026-10-11. The traversal patch is an upstream candidate; it is recorded and
applied only to the isolated REPL build here. No upstream branch, commit or PR
was created. Compiler and LLDB binaries, source pins and guest runtimes were
preserved throughout this REPL investigation.

Cloudflare packaging emits explicit manifests for all payloads: Pages' SPA
fallback otherwise returns HTML for missing manifest URLs. SDK tar chunks and
Wasm chunks use HTTP Brotli compression and content-hashed filenames. The browser
automatically decodes Brotli; the small SDK parser handles regular tar files.
Local staging still uses gzip archives and native DecompressionStream. No
untarjs dependency is used. Initial compiler transfer falls from about 78 MiB to
44 MiB; the REPL is not downloaded during compiler startup. The REPL Foundation
bundle excludes duplicate standard-library modules already in its base SDK.

Chrome did not retain the large payloads in its automatic HTTP cache despite
immutable headers. The loader therefore caches hashed payloads in CacheStorage,
removes superseded parts of the same payload, and falls back to downloads if
storage is unavailable. A fresh browser still needs its first download.
[Demo benchmarks](benchmarks.md) record first-use, same-page and cached-reload
timings, including Date compilation/execution, CFG, LLDB and REPL startup.

Extraction into the real Emscripten FS measured 123 ms for the core SDK and
31 ms for REPL Foundation. Host initialization, including its pthread pool,
measured 0.8 seconds for the compiler and 1.5 seconds for the REPL. These
measurements do not establish the overhead versus a single-threaded rebuild,
but explain why replacing the extractor or removing threads is not the first
response to ten-second downloads. Existing builds and thread counts are retained.

CFG transfers only its IR and DOT inputs, rather than every workspace binary.
Tool download/compilation overlaps Swift IR generation. LLVM analysis tools share
one Worker but create a fresh CLI runtime per invocation; Graphviz's classic
global JS declarations require a disposable Worker, with compiled Wasm retained.
The compiler and debugger keep their own resident session infrastructure.
Multi-file debugger checks measured Start-to-main at 1.7 seconds and Restart at
1.4 seconds locally, including real source/frame switches, variable updates,
stdout, exit, and disabled Pause after exit. Public checks pass REPL/Foundation,
JSON compilation, interruption, reset and Fibonacci LLDB stepping in one session.
