# Browser debugger rebuild

This directory owns the native half of WasmBolt's LLDB-DAP and WAMR browser
debugger. Build state belongs in `.work/`; source pins, patches, configuration,
and provenance remain in Git.

The architecture is deliberately split into three layers:

1. LLDB-DAP owns the Debug Adapter Protocol and LLDB state.
2. A small bridge replaces the TCP GDB-remote connection with an in-memory byte
   transport.
3. WAMR's classic interpreter executes the user's Wasm module and exposes its
   debug state through that transport.

The browser module is a disposable, pthread-enabled Worker. It is not part of
the compiler worker. A failed or hung debug session should terminate this Worker
and start a fresh one.

## Rebuild stages

All stages use `native/debugger/.work`; none uses `/private/tmp`.

```bash
cd native/debugger
bash scripts/00-preflight.sh
bash scripts/10-fetch-wamr.sh
bash scripts/20-build-wamr.sh
bash scripts/25-build-native-tools.sh
```

The exact working experiment used a static Emscripten 6.0.8 libxml2 build. For
the shortest recovery path, the script disables optional libxml2 support. To
reproduce the old feature set, point `LIBXML2_PREFIX` at an equivalent prefix
before configuring LLDB:

```bash
export LIBXML2_PREFIX=/absolute/path/to/emscripten-6-libxml2-prefix
bash scripts/30-configure-lldb.sh
bash scripts/40-build-lldb.sh
```

```bash
bash scripts/45-build-bridge.sh
bash scripts/50-link-debugger.sh
bash scripts/60-build-test-guests.sh
```

The recovered bridge is checked in under `bridge/`. An alternate source can
still be tested by setting `WASMBOLT_DAP_BRIDGE_SOURCE` explicitly.

Successful output is written to `.work/output/lldb-dap.js`,
`.work/output/lldb-dap.wasm`, and `.work/output/lldb-dap.worker.js`. These
generated assets stay outside Git. There is no separate `lldb.js` or
`lldb.wasm`; the UI and terminal share this one DAP session.

The final command always builds the tiny `simple.wasm` acceptance guest. Set
`XTENSOR_INCLUDE_DIR` to an extracted emscripten-forge include prefix to also
build `xtensor.wasm`. Debug paths are remapped to `/workspace/simple.cpp` and
`/workspace/xtensor.cpp`, matching the paths mounted by the browser Worker.

## Verify and stage

Run the source-controlled browser smoke after the final link:

```bash
node smoke/run.mjs
```

The runner starts a disposable COOP/COEP server, discovers an installed
Playwright Chromium or system Chrome, and checks breakpoint, variables, DAP REPL
evaluation, Step Over, Continue, and exit code 37. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when automatic browser discovery is not
suitable. Set `WASMBOLT_DEBUGGER_WORK_DIR` to test another compatible build
directory without copying its generated artifacts.

Stage the three runtime files and rebuild the product Worker from the workbench
root:

```bash
cd ../..
pixi run --as-is node scripts/compiler.mjs stage-debugger \
  native/debugger/.work/output
pixi run --as-is jlpm build:worker
pixi run --as-is jlpm check:compiler
```

## Current recovery status

- The exact Emscripten package, LLVM and WAMR revisions, patches, flags, and
  output checksums are recorded.
- The source-built `-O2` module passes the simple-guest browser gate:
  breakpoint, variables, DAP REPL evaluation, Step Over, Continue, and exit
  code 37.
- The staged workbench passes the same flow through its real Debugger panel.
  Click the gutter or press F9 on a source line to toggle a breakpoint.
- Terminal `lldb <command>` input uses DAP `evaluate` with `context: "repl"` in
  the active adapter; it never creates a second debugger.
- The 20-session soak and optional xtensor gate remain follow-up validation.

See [PROVENANCE.md](PROVENANCE.md) for exact identities and the historical link
command. See [E2E_TEST_PLAN.md](E2E_TEST_PLAN.md) for the acceptance gate.
