# Swift in WasmBolt

Swift's driver, frontend and Wasm LLD run in one persistent compiler worker.
`swiftc` produces AST, SIL, LLVM IR, assembly and linked Wasm. See [summary.md](summary.md) for
source fixes and [tutorial_swift.md](tutorial_swift.md) for examples.

## Build

`sources.json` pins Swift, its LLVM fork and SDK dependencies. The verified
host is macOS arm64 with Xcode command-line tools and native Swift. Activate
`environment-build.yml`, set `WASMBOLT_EMSDK_ROOT="$CONDA_PREFIX/opt/emsdk"`,
and run from `compilers/swift`:

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
# Optional Foundation, ICU and Collections:
bash scripts/41-build-foundation.sh
bash scripts/30-configure-swift.sh wasm
bash scripts/40-build-compiler.sh
python3 scripts/50-package.py
```

Compiler hosts use pthreads; guest programs use an independent wasm32 runtime
with cooperative concurrency. Foundation loads on its first compiler import.

`WASMBOLT_SWIFT_WORK_DIR` selects ignored build output (default `.work`);
`WASMBOLT_SWIFT_SOURCE_ROOT` and `WASMBOLT_SWIFT_LLVM_SOURCE` select pinned
source directories. `WASMBOLT_SWIFT_JOBS` defaults to six. Lower it for limited
RAM; avoid concurrent Ninja processes in one build directory.

## Preview and deploy

From the repository root, reuse a built WasmBolt site for opt and Graphviz:

```sh
python3 compilers/swift/scripts/70-stage-site.py --base-site site --site build/swift-site
python3 scripts/serve.py --site build/swift-site --port 8775
# Swift-only demo, using the same product UI:
python3 compilers/swift/scripts/70-stage-site.py --swift-only --base-site site --site build/swift-only
node compilers/swift/scripts/80-stage-pages.mjs build/swift-only build/swift-pages
```

Serve the generated Pages directory through Cloudflare Pages. Its headers
provide COOP/COEP isolation; content-hashed payloads support browser caching.
Builds, SDK archives and previews stay untracked.

## Validate

From `compilers/swift`, install the existing browser gate dependencies:

```sh
npm install --no-package-lock
npx playwright install chromium
node tests/prepare.mjs
node tests/compiler.mjs
node tests/compiler-browser.mjs
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for system Chrome. The gates exercise
compiler outputs and execution. Reports and
compiled guests stay in `.work/`.
