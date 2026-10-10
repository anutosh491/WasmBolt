# Swift browser build summary

Swift compilation and Swift-aware LLDB use the preserved build from 2026-10-04.
This branch is based on structured WasmBolt main `372acf6` (2026-10-10), including
resident Clang outputs, cached analysis modules and the shared Debug target picker and optional clangd. It extends that UI directly;
no workbench, Jupyter/Lumino application or old dependency tree is imported.

Keep two reviewable layers: Swift compiler integration, followed by matching
Swift LLDB/WAMR integration. The final checkout contains both reproductions.
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
compression. The standalone SDK archive is about 21 MiB, including matching
Emscripten link inputs and Clang resource headers. Identical root/wasm32 runtime
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
panel. Start compiles full DWARF types, copies the guest/source and installs the
same Swift SDK in a fresh LLDB Worker. LLDB's compiled module is cached for the
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
   This is a workaround needing a reduced toolchain reproducer. Guest Swift
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
recipe. Full DWARF types (`-gdwarf-types`, DWARF 4, `-Onone`) provide the
verified integer locals. Ordinary `-g` relies on runtime reflection unavailable
in this backend. The debugger installs the matching SDK and sets its Swift
module/Clang include paths before attach.

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
The full product renders Swift's LLVM CFG with the existing `opt`/Graphviz tools;
the normal C/C++/LLVM IR output and tool-cache regression checks pass unchanged.
The driver-backed preview additionally passes version/help, AST/SIL/IR/assembly,
object linking, multi-file compilation, user response files, `-Xfrontend`/`-Xcc`/
`-Xlinker`, dry-run/skip execution, invalid-option/source recovery and all three
optimization levels in Chrome. Fibonacci debugger stepping still shows `next = 1`
and `answer = 55` before exit 0. These development checks remain in ignored `.work`.

Foundation, concurrency, macros and compiler regex literals are excluded.
Implicit concurrency/StringProcessing imports and SwiftSyntax are disabled.
Complex value formatting and arbitrary Swift expression evaluation remain
unvalidated. Raw LLDB variables can report missing reflection metadata while the
DAP Variables response displays the verified scalar values.

Multi-file debugging is verified with `math.swift` and `main.swift`: a full-DWARF
`swiftc` build links both into one Wasm program. Choosing that `.wasm` under
Debug target makes Start use the existing binary; Restart retains it as stepping
changes the active editor. Breakpoints in both files resolve, Step into opens
the callee, selecting stack frames opens either source, and Step out returns
to the caller. The checks inspect `next = 1`, `answer = 6765`, stdout and exit 0;
single-file Swift source-build debugging still passes with the same cached tools.

## Current repository boundary

Refreshed onto latest structured `main` on 2026-10-10. `compilers/swift/` owns
this recipe; `debugger/lldb/` contains only the shared interpreter/transport
needed by Swift. Both feature branches can be reproduced from their own checkout
without importing another app or branch. Swift's LLVM fork, pthread compiler
runtime and guest SDK remain separate from the published 6-x main toolchain.
No source pins were advanced during this structural refresh. The UI adapters extend the already-merged debugger panel. Cloudflare deployment
is deferred until the local Swift-only preview has been reviewed; the existing
LLDB demo is untouched.
