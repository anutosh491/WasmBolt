# Swift browser compiler summary

This layer adds the Swift compiler to WasmBolt main `372acf6`. Swift's C++ driver,
frontend, Clang link driver and Wasm LLD execute serially in one resident browser
module. Normal `swiftc` commands produce AST, SIL, LLVM IR, assembly, objects and
linked Wasm, including multi-file programs and user response files. The main
C/C++/IR/MLIR controls remain available; staging can also select a Swift-only demo.
Builds and generated SDKs stay under ignored `.work/` directories.

## Sources and build

`sources.json` records every source revision. Swift is
`6b8daddf6f30bb1bbdcaaede7f673e76eb155278` (6.5-dev); its LLVM fork is
`ab70a4c40271da180ff2fcf2d92cd24bee8a2cb3`. The toolchain uses Emscripten 6.0.8.
Foundation/CoreFoundation/ICU/Collections sources are pinned independently to
matching 6.2 releases, avoiding newer macro-plugin/SwiftSyntax requirements.

The verified host is macOS arm64. Scripts bootstrap native TableGen, cmark and
a native Swift frontend, then cross-build LLVM/Clang/LLD, the Swift compiler and
its host runtime. Swift-in-Swift uses CROSSCOMPILE; disabling it no longer works
at this revision. README.md contains the complete ordered build commands.

Host LLVM/Clang/LLD and Swift use `-pthread` and LLVM_ENABLE_THREADS=ON. Swift
IRGen starts a cleanup thread even in the ordinary single-codegen-thread path.
The browser bridge uses a pool of four. A pool of one exhausted during JSON
compilation; two and four passed the measured Date, JSON and Fibonacci cases.
Those checks did not establish a speed benefit from reducing the current pool.
The host heap is shared across its workers. User programs link an independent
static guest runtime with no pthreads and a cooperative concurrency executor.
COOP/COEP headers are required for the compiler host; scripts/serve.py and the
Pages packager provide them. Do not mix this pinned compiler with LLVM-main
archives or separately published development libraries.

## Recorded source patches

- swift-browser-host.patch fixes wasm32 CompoundDeclName alignment and SIL
  trailing-object allocation padding, which caused corruption in interpolation
  and array examples. It also supplies cross-build platform/CMake adjustments.
- swift-driver-executor.patch lets an embedded executor opt out of replacing
  its host process for a single frontend job. The default native behavior is
  unchanged. The bridge implements a serial browser TaskQueue; driver parsing,
  scheduling, response files and temporary cleanup stay in Swift.
- foundation-emscripten.patch and corelibs-foundation-emscripten.patch enable
  EmscriptenLibc imports and appropriate Wasm platform fallbacks. The additional
  corelibs-foundation-without-dispatch.patch preserves run-loop constants while
  excluding unsupported Timer operations. FoundationNetworking, libdispatch
  and OS process services are outside this build.

Swift C++ compilation uses -fno-optimize-sibling-calls: optimized Wasm sibling
calls mispassed an aggregate IRGen address with this toolchain. This workaround
needs a reduced toolchain reproducer; guest Swift optimization remains enabled.
The alignment/allocation fixes and embedded driver API are upstream candidates.
Their affected code remained in Swift main checked on 2026-10-10. No Swift issue
or PR was submitted by this task. SDK --no-stack-first accommodates the Swift
WebAssembly driver's --global-base=4096 with LLVM 23's stack layout; that default
interaction is another upstream discussion candidate.

## Browser integration and SDK delivery

The UI mirrors /workspace while the real compiler SDK/FS stays in its Worker.
Changed inputs and deletions are synchronized; generated binaries are not copied
back before every compiler invocation. Output files return to Explorer. SDK
configuration supplies default target, module/include paths and runtime link
inputs; advanced arguments remain under the real driver. Autolink extraction
selects imported Swift libraries. Compile & Run uses one compile/link sequence.

50-package.py bundles existing local build outputs: a core SDK (~23 MiB gzip)
and optional Foundation (~28 MiB gzip), plus a headers/modules archive. These
are transport files, not additional compiler builds. Foundation downloads on
its first import/link. Local gzip uses native DecompressionStream and a small
regular-file tar parser; no untarjs dependency is needed for these controlled
archives. Real Emscripten FS extraction measured ~123 ms for the core SDK.

Pages uses Brotli-compressed chunks and hashed filenames, with explicit manifests
to avoid SPA-fallback HTML. The loader caches hashed assets in CacheStorage,
removes superseded parts, and downloads normally when storage is unavailable.
Initial compiler payload is ~44 MiB, down from ~78 MiB. A public Chrome run
measured readiness at 18 seconds cold and 1.5 seconds after reload; these depend
on connection and hardware. Compiler initialization, including pthread workers,
measured ~0.8 seconds locally. No single-threaded rebuild was needed for these
loading improvements, and existing builds are retained.

Swift LLVM CFG uses the existing opt/Graphviz packages. Only required IR/DOT
inputs are transferred. Tool download/compilation overlaps Swift IR generation.
LLVM analysis tools share a worker, with a fresh CLI runtime per command.
Graphviz's classic globals require a disposable worker, with compiled Wasm cached.
Utilities remain disposable. This layer does not add an IDE/workbench framework.

## Validation and limits

The existing compiler gates exercise version/help, re-entry, error recovery,
15 compilation cases and ten executions. Product checks also cover AST/SIL/IR/
optimized IR/assembly, single-source and multi-file builds, object linking,
-Xfrontend/-Xcc/-Xlinker, response files and -Onone/-O/-Osize. Fibonacci, FizzBuzz,
Date/DateFormatter with ICU, Unicode Codable JSON and cooperative actor/task-group
execution pass. All artifacts and development reports stay under ignored .work/.
Warm local compile/link measured ~0.5 seconds for Fibonacci and ~1.3 seconds for
JSON/Date; native measurements were two to three times faster. No native parity
claim is made. SwiftPM, script interpretation, JavaScriptKit and SourceKit-LSP
are deferred; compiler regex literals/macros remain outside validated scope.
