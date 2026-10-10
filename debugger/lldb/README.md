# Browser LLDB

LLDB-DAP and WAMR, integrated with WasmBolt. See [summary.md](summary.md) for
architecture, fixes and limitations. Source pins are in `scripts/versions.sh`;
build outputs stay in `.work/`.

## Build

From the repository root, using Emscripten 6.0.8:

```sh
micromamba create -f debugger/lldb/environment-build.yml
micromamba activate wasmbolt-browser-build
export WASMBOLT_EMSDK_ROOT="$CONDA_PREFIX/opt/emsdk"

cd debugger/lldb
mkdir -p .work
git clone --filter=blob:none --no-checkout \
  https://github.com/llvm/llvm-project.git .work/llvm-project
source scripts/versions.sh
git -C .work/llvm-project fetch --depth=1 origin "$LLVM_REVISION"
git -C .work/llvm-project checkout --detach "$LLVM_REVISION"

bash scripts/00-preflight.sh
bash scripts/10-fetch-wamr.sh
bash scripts/20-build-wamr.sh
bash scripts/25-build-native-tools.sh
bash scripts/30-configure-lldb.sh
bash scripts/40-build-lldb.sh
bash scripts/45-build-bridge.sh
bash scripts/50-link-debugger.sh
bash scripts/60-build-test-guests.sh
```

Outputs: `.work/output/lldb-dap.{js,wasm,worker.js}`.
`WASMBOLT_BUILD_JOBS` defaults to two. Set `LLVM_PROJECT_ROOT` to reuse a pinned
checkout; build reuse options are documented in [summary.md](summary.md).

## Serve

Build the main compiler following the root [README](../../README.md) first.
Its compiler/linker module remains single-threaded; only the debugger uses pthreads.
From the repository root, with `LLVM_WASM_PREFIX` set to the main build's target prefix:

```sh
micromamba create --platform emscripten-wasm32 \
  -p debugger/lldb/.work/guest-prefix -f debugger/lldb/environment-guest.yml
python3 debugger/lldb/scripts/70-stage-site.py \
  --tools-prefix "$LLVM_WASM_PREFIX" \
  --guest-sysroot debugger/lldb/.work/em-cache/sysroot \
  --library-include debugger/lldb/.work/guest-prefix/include \
  --compress
python3 debugger/lldb/scripts/serve.py --port 8767
```

The guest prefix supplies JSON headers. Omit its creation and `--library-include`
for standard C/C++/IR only. Stage 60 supplies the standalone guest link archives.
Use `--compiler-build`, `--debugger-output` or `--guest-sysroot` for existing artifacts.

## Try

Open <http://127.0.0.1:8767/?debugger=1&example=simple.cpp> or the
[hosted demo](https://wasmbolt-lldb-demo.pages.dev/?debugger=1&example=simple.cpp).
Click a line number to set a breakpoint. Under **Debug target**, choose
**Build current source** or an existing `.wasm`, then Start, step and Continue.
The panel shows its path; Restart reuses the same program.

| File | Breakpoint | Expected result |
| --- | --- | --- |
| `simple.cpp` | 14 | `result=31`, exit 31 |
| `simple.c` | 4 | Exit 10 |
| `debug.ll` | 16 | `sum=42`, `result=42`, exit 42 |
| `json.cpp` | 7 | `score=42`, exit 42 |

**Build current source** uses `-O0 -g` and requires `main`; LLVM IR needs DWARF metadata.
The bug button hides/reopens the panel. Stop ends the session; Pause works while
running. LLDB stays loaded across sessions. Console commands use a backtick
prefix, e.g. `` `thread backtrace ``.

## Check

With the local server running:

```sh
cd debugger/lldb
npm install --no-package-lock
npx playwright install chromium
node smoke/run.mjs
node smoke/product.mjs 'http://127.0.0.1:8767/?debugger=1'
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing Chrome installation.
Optional matrix checks and hosting instructions are in [summary.md](summary.md).
