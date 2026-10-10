# Swift browser compiler summary

This compiler layer starts on WasmBolt main `372acf6`, including the resident
Clang pipeline, compiled-tool cache and shared Debug target picker and optional clangd. It adds Swift
compilation without installing LLDB. Swift debugging follows in the next commit.
Preserved builds are reused; generated assets and local experiments stay ignored.

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

The compiler Wasm is 125 MiB before HTTP compression. The standalone SDK archive is about 21 MiB, including matching
Emscripten link inputs and Clang resource headers. Identical root/wasm32 runtime
archive copies are packaged once; linker paths use the wasm32 directory.

## Integration and reproduction

The frontend, upstream C++ driver, autolink extractor, Clang link driver and Wasm
LLD share one module. A browser TaskQueue schedules jobs in process; no external
compiler process runs. `swift --version`, `swiftc` output stages, object linking,
multiple inputs, `-Xfrontend`, `-Xcc`, `-Xlinker` and response files are supported.
SDK paths and runtime linker arguments come from installed configuration files.

The compiler Worker remains resident. Workspace inputs and generated files move
between its filesystem and the existing UI workspace. `fibonacci.swift` and
`fizzbuzz.swift` are standalone programs; `math.swift` and `main.swift` form one
multi-file program. AST, SIL, LLVM IR, optimized IR, assembly and Wasm output use
the current UI. The Swift-only preview excludes other compiler/tool downloads.

`00-fetch-sources.sh` pins and verifies source revisions, then applies two Swift
patches: `swift-browser-host.patch` for static Emscripten host/runtime support and
`swift-driver-executor.patch` for non-replacing in-process job execution. Swift's
matching LLVM fork needs no compiler patch for this layer. The debugger's LLVM
fork patch is applied separately by its build stage.

The compiler and its host Swift runtime use pthreads. `20-configure-wasm-llvm.sh`
enables LLVM threads; compiler configuration and final linking use `-pthread`.
The host Swift runtime uses `stdlib-host-wasm`; guest programs use the independent
single-threaded `stdlib-wasm`. The server supplies COOP/COEP headers. No thread
variants are assumed to exist on emscripten-forge for Swift's compiler libraries.

Native TableGen, cmark and Swift bootstrap the cross build. Dedicated source
checkouts avoid modifying an unrelated repository. See README for build order,
input overrides, packaging and serving. The standalone SDK archive includes
Clang resource headers, Swift modules and static guest runtime/link inputs.

## Source fixes

The host patch aligns compound declaration names to eight bytes for pointer
tags, allocates SIL trailing data with alignment padding, maps Emscripten to
Swift's WebAssembly driver, imports installed LLD CMake targets before Clang,
and makes reflection flag conversion explicit for a 32-bit host. The separate
driver patch allows an in-process TaskQueue to run a single job without replacing
the host process. Native behavior remains the default.

Swift C++ uses `-fno-optimize-sibling-calls` for an aggregate-argument failure
observed with this toolchain. Guest Swift still supports `-Onone`, `-O` and
`-Osize`. The SDK link response uses `--no-stack-first` to accommodate Swift's
4096-byte global base. These workarounds and alignment fixes need independent
upstream review; temporary diagnostics are excluded.

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

## Verified behavior and limits

Chrome checks cover version/help, AST/SIL/IR/assembly, objects, linking, multi-file
compilation, strings/arrays, all optimization levels, advanced driver arguments,
response files, dry-run and invalid-option/source recovery. Fibonacci prints 55;
the two-file example prints `Fibonacci(20) = 6765`. Checks and reports stay ignored.

Foundation, JavaScriptKit, concurrency, macros and SwiftPM are not packaged.
Implicit concurrency/StringProcessing imports and SwiftSyntax are disabled.
`swift file.swift` and the REPL are not implemented; use `swiftc` for compilation.
