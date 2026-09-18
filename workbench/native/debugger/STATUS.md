# Recovery status

Last updated: 2026-09-17 (LLVM `24572c2967f11f63f0d3bfd461ca59350e592349`).

## Result

The source-built browser debugger now passes the Phase 1 simple-guest gate in a
Chromium Worker served with COOP/COEP headers:

1. `crossOriginIsolated` and `SharedArrayBuffer` were available;
2. the module loaded in 253.705 ms;
3. DAP initialized, attached, and verified a source breakpoint at
   `/workspace/simple.cpp:2`;
4. execution stopped in `square_plus_one(int)` at line 2;
5. scopes and variables returned `value = 6` and `squared = 0`;
6. DAP `evaluate` with `context: "repl"` ran `frame variable value squared` in
   that same stopped session;
7. DAP `next` stopped at line 3 and variables returned `squared = 36`; and
8. DAP `continue` completed with guest exit status 37.

The protocol portion took 486.925 ms and the complete browser runner took 1.33
seconds. This was a single clean `-O2` acceptance run. The 20-session
soak/restart gate and the optional xtensor Phase 2 gate have not been run yet.

There is deliberately no standalone `lldb.js` or `lldb.wasm`. The one live
debugger is the LLDB-DAP Emscripten module, and terminal LLDB commands enter
that same adapter through DAP `evaluate` with the REPL context.

## Staged artifact identities

| File                                   |             Size | SHA-256                                                            |
| -------------------------------------- | ---------------: | ------------------------------------------------------------------ |
| `compiler/lldb-dap/lldb-dap.js`        |    125,559 bytes | `feb5e4ab02ddbb27940c86987e3ef781afdce371726ea436c27be4dbdb3ce86e` |
| `compiler/lldb-dap/lldb-dap.wasm`      | 66,898,487 bytes | `5fa7e7dd599dc281c88160169a95de562a4a978473b2d899756253f4fd586ede` |
| `compiler/lldb-dap/lldb-dap.worker.js` |         24 bytes | `f205167738aa5cca162f248ac4c916f7f14ad061cf6064493da58eb766549bc2` |
| acceptance `simple.wasm`               |    159,545 bytes | `9dedb045f18140cd65f904b3102330ef1e9730f438e35d65525fe9daf7d0a22b` |

Emscripten 6.0.8 self-loads the module script in its pthread workers. The small
checked-in `bridge/lldb-dap.worker.js` is therefore the explicit worker entry
required by workbench asset validation; it imports `lldb-dap.js`.

## Source-build checkpoints and timings

A clean workbench-local rebuild creates the following ignored paths under
`native/debugger/.work`. The completed source build used the same layout in its
recovery workspace; none of those generated checkpoints was copied into Git.

- WAMR source: `.work/wamr-d7050d9fe672e2d0bc65c44c966cebc0a1aca14b`
- WAMR archive: `.work/wamr-build/libvmlib.a`
- native table generators: `.work/llvm-native-tools/bin/`
- configured LLDB tree: `.work/llvm-lldb-build/`
- LLDB archive dependencies built: 223 of 223
- LLDB archive build: 2,655.12 seconds (44 minutes 15.12 seconds)
- link response SHA-256:
  `06ac25479f77bba36f55ffc702b96a256c076d1889c16d1235efde2409a3c31f`
- final `-O2` link and Binaryen optimization: 234.73 seconds real time
- scoped DAP archive rebuild after the scopes fix: 7.36 seconds
- scoped `liblldb`/DAP rebuild after the stepping fix: approximately 52.31
  seconds
- incremental bridge rebuilds: approximately 3–4 seconds

The two LLDB changes required by the embedded browser transport are preserved in
`patches/lldb-embedded-wasm-thread-selection.patch` and are applied idempotently
by `scripts/30-configure-lldb.sh`. They avoid redundant selected thread/frame
mutations which otherwise wait indefinitely on the WAMR event pthread during
`scopes` and `next`.

The bridge loads the exact mounted guest module into LLDB at WAMR's load address
using the dynamic loader and `ModulesDidLoad`. This makes DWARF source
breakpoints work without depending on qXfer library XML or libxml2.

## Workbench staging

The three debugger artifacts above were staged into
`workbench/compiler/lldb-dap/`. `compiler/manifest.json` records their exact
hashes and records these debugger-specific fields separately from the LLVM
utility runtime:

- `debuggerOrigin: source`
- `debuggerRevision: 24572c2967f11f63f0d3bfd461ca59350e592349`
- `debuggerEmscripten: 6.0.8`
- `debuggerWamrRevision: d7050d9fe672e2d0bc65c44c966cebc0a1aca14b`
- `debuggerThreaded: true`

`node scripts/compiler.mjs check` passed. The six product Worker bundles were
rebuilt; the staged `debug-worker.js` is 15,603 bytes with SHA-256
`c022861bb83438cf4b34c5649d0725b3773cabe8e5ffb4cd8cff83a8753b2d09`. The focused
debugger/capabilities tests passed (3 suites, 12 tests), both browser and test
TypeScript checks passed, and `git diff --check` passed.

The rebuilt standalone workbench on port 4185 also passed the same gate through
the real product UI. F9 toggled the breakpoint on `simple.cpp:2`; the Debugger
panel showed `value = 6` and `squared = 0`; Step Over moved to line 3 and showed
`squared = 36`; Continue reported `Process exited with code 37`. The run had no
page or console errors. F9 is the keyboard-accessible equivalent of clicking the
source gutter.

The authoritative recipe, patches, bridge, guests, provenance, and browser smoke
now live in this workbench under `native/debugger/`. A replay from that
source-controlled smoke harness passed the full gate in 491.82 ms. One
immediately preceding cold replay verified the breakpoint but timed out before
receiving its stop event; this is why the 20-session soak remains an explicit
publication gate rather than being marked complete.

## Remaining validation

- Run the 20-session restart/timeout soak in `E2E_TEST_PLAN.md`.
- Run xtensor Phase 2 after an `XTENSOR_INCLUDE_DIR` is supplied.
- Extend the product UI smoke to exercise the bottom `lldb <command>` input; its
  command path is already covered by focused tests and uses the same DAP session
  through `evaluate` with `context: "repl"`.

None of those remaining checks requires or should introduce a second LLDB
executable/module.
