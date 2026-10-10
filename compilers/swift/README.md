# Swift browser compiler and matching debugger

This recipe builds Swift's C++ driver, frontend and Wasm LLD into one static
Emscripten module. `swift` and `swiftc` use upstream argument parsing and job
scheduling, with an in-process browser executor. SDK defaults supply paths and
runtime libraries. Raw `swift-frontend` and `wasm-ld` remain available.

The compiler and Swift-enabled LLDB use pthreads. Programs use a separate,
normal single-threaded static Swift standard library for WAMR. This is normal
Swift, not Embedded Swift or the ORC REPL.

See [summary.md](summary.md) for source fixes and
[tutorial_swift.md](tutorial_swift.md) for outputs, execution and debugging.

## Inputs

`sources.json` pins Swift main 6.5, Swift LLVM `stable/23.x`, cmark and
StringProcessing to the revisions used in the verified build. The matching LLVM
fork is essential for Swift compiler APIs and Swift language support in LLDB.
Emscripten is 6.0.8 from emscripten-forge-6x, matching the LLDB recipe.

The verified host is macOS arm64, with Xcode command-line tools and an installed
native Swift compiler. Create and activate `compilers/swift/environment-build.yml`, then set
`WASMBOLT_EMSDK_ROOT="$CONDA_PREFIX/opt/emsdk"`. Build tools are discovered on
`PATH`; override `WASMBOLT_CMAKE`, `WASMBOLT_NINJA`, `WASMBOLT_NODE` or
`WASMBOLT_PYTHON` when needed. Other native hosts have not been validated.

This branch starts at current `main` independently of the LLDB branch. It
includes only the shared `debugger/lldb` bridge, WAMR patch and interpreter build
stages needed by Swift. Do not build LLVM-main LLDB for this recipe: Swift needs
its matching fork. The Swift adapter extends the current UI; the published main Clang module stays separate.

## Build

Run these commands from `compilers/swift`. `00-fetch-sources.sh` creates
dedicated pinned checkouts, verifies existing revisions and applies the
recorded source patches. It does not reset an unrelated checkout.

```sh
bash scripts/00-fetch-sources.sh
bash scripts/10-native-tools.sh
bash scripts/20-configure-wasm-llvm.sh
bash scripts/25-cmark.sh native
bash scripts/25-cmark.sh wasm
bash scripts/30-configure-swift.sh native
bash scripts/35-build-native-compiler.sh
bash scripts/32-build-wasm-llvm.sh
bash scripts/38-configure-stdlib.sh guest
bash scripts/38-configure-stdlib.sh host
bash scripts/39-build-stdlib.sh guest
bash scripts/39-build-stdlib.sh host
bash scripts/30-configure-swift.sh wasm
bash scripts/40-build-compiler.sh
bash scripts/45-configure-lldb.sh
source scripts/common.sh
"${PYTHON}" scripts/46-build-lldb-objects.py \
  --ninja "${NINJA}" --build "${WORK_DIR}/lldb-wasm" --jobs 2
bash scripts/47-build-lldb-libraries.sh
```

Build WAMR once, using the same activated environment:

```sh
(cd ../../debugger/lldb && bash scripts/10-fetch-wamr.sh && bash scripts/20-build-wamr.sh)
```

Then return here:

```sh
bash scripts/48-build-debugger-bridge.sh
bash scripts/49-link-debugger.sh
python3 scripts/50-package.py
```

The Swift debugger uses the sibling `debugger/lldb/bridge` and its WAMR
archive. It rebuilds LLDB against Swift's LLVM fork rather than using the
LLVM-main LLDB archive. Override `WASMBOLT_DEBUGGER_SOURCE_DIR` or
`WASMBOLT_WAMR_INPUT_DIR` to reuse compatible inputs elsewhere.

`WASMBOLT_SWIFT_WORK_DIR` defaults to `.work`. `WASMBOLT_SWIFT_SOURCE_ROOT`
selects the directory containing Swift, cmark and StringProcessing; default
`.work/sources`. `WASMBOLT_SWIFT_LLVM_SOURCE` selects the matching LLVM source;
default `.work/llvm-project`. `WASMBOLT_SWIFT_JOBS` defaults to six; lower it
for limited RAM and avoid simultaneous Ninja processes in the same build.

Outputs are `.work/compiler/wasmbolt-swift.{js,wasm}`, the SDK and guest link
inputs in `.work/swift-package/runtime.tar.gz`, and
`.work/output/lldb-dap.{js,wasm}` plus its pthread worker. SDK packaging accepts
`--sysroot` for another matching Emscripten sysroot. All outputs are ignored.
Stage either the normal WasmBolt site with Swift added, or a Swift-only preview:

```sh
# From the repository root, after building and packaging Swift:
python3 compilers/swift/scripts/70-stage-site.py --base-site site --site build/swift-site
python3 scripts/serve.py --site build/swift-site --port 8775
# Dedicated demo; no Clang or LLVM utility binaries are needed:
python3 compilers/swift/scripts/70-stage-site.py --swift-only --site build/swift-only
python3 scripts/serve.py --site build/swift-only --port 8775
```

`--base-site` means the generated site from the existing WasmBolt/LLDB staging
steps, not a source checkout. The dedicated preview and full product share the
same UI and adapters. Build directories and staged sites are ignored.

## Validate independently of the UI

```sh
npm install --no-package-lock
npx playwright install chromium
node tests/prepare.mjs
node tests/compiler.mjs
node tests/compiler-browser.mjs
node tests/compiler-browser.mjs debug
```

The independent scalar/array browser gate checks AST, SIL, IR, assembly, DWARF objects, static
linking, invalid-source recovery, strings and arrays at `-Onone`, `-O` and
`-Osize`: 15 compilation checks and ten fresh-instance execution checks. It
saves the exact compiled guest for the debugger gate, which tests line 7, step
into `add`, integer locals, a delayed step, step out, stdout and exit.

The SDK contains its own guest link inputs. Tests do not load another compiler
package or import the app's filesystem/worker services. The small test-only
archive loader and WASI runner live under `tests/support`.

Playwright serves a temporary COOP/COEP localhost page. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use system Chrome, or install its
Chromium with `npx playwright install chromium` from this directory.
Reports and compiled browser guests stay in `.work/`.
