# WasmBolt LLDB and WAMR design

Last updated: 2026-09-23.

This is the source of truth for WasmBolt's browser debugger. It records what
has been reproduced, why the design differs from native LLDB at two browser
boundaries, and what remains before product integration.

## Product contract

WasmBolt should debug normal C and C++ compiled to WebAssembly entirely in the
browser. One debug session must support source breakpoints, Continue, Pause,
Step Over, Step Into, Step Out, frames, locals, a debug console, and LLDB
commands entered from the Terminal.

The long-term user-facing build command stays conventional:

```text
clang++ -g -O0 source.cpp -o program.wasm
```

Until Clang's ToolSession-owned linker dispatch lands, the focused demo is
honest about its two in-process tool calls: Clang compiles the source to
`debug.o`, then `wasm-ld` links `debug.wasm` with `-L` and named Emscripten
libraries. It does not print an expanded list of archive paths. Start Debugging
performs both calls and attaches once; debugger commands never recompile the
module.

## Architecture

```text
WasmBolt page
  |
  `-- one replaceable debugger Web Worker
       |
       `-- one pthread-enabled Emscripten module
            |-- lldb-dap and liblldb
            |-- LLDB ProcessGDBRemote and WebAssembly target support
            |-- in-memory GDB-remote Connection
            `-- WAMR classic interpreter
                 `-- the program being debugged
```

The debugger Worker is separate from the persistent compiler Worker. A failed
debug session can therefore be replaced without losing compiler state.
Emscripten pthread workers are internal implementation threads; WasmBolt does
not create a disposable browser Worker for each debugger command.

The Debugger panel, editor gutter, debug console, and Terminal all observe one
LLDB process. Terminal commands are sent to that adapter as DAP `evaluate`
requests with REPL context. There is no second product `lldb.js` instance for
the Terminal because two debuggers would disagree about process state,
selected frames, and breakpoints.

## Native behavior and browser boundaries

The design follows native LLDB-DAP except at two demonstrated platform
boundaries.

### In-memory GDB-remote transport

Browsers cannot expose the socket transport used by a native WAMR debug
server. The WAMR patch therefore adds an embedded transport API that accepts
request bytes and reports response bytes through memory callbacks. LLDB still
uses `ProcessGDBRemote`; only its `Connection` is replaced by an in-memory
queue. Breakpoint, stepping, halt, thread, stack, and variable semantics remain
owned by LLDB and WAMR.

### LLDB event ownership

Native LLDB-DAP starts an event thread that consumes `SBListener` process
events and publishes DAP events. A browser adapter also needs its owning Web
Worker to service requests and make output visible to JavaScript. Running the
native consumer and a Worker consumer together raced: WAMR reached multiple
breakpoints and LLDB consumed the stop packets, but the browser sometimes saw
no `stopped` event.

The browser adapter stops LLDB-DAP's event handlers after initialization and
after attach, then drains the same `SBListener` non-blockingly from its Worker.
It publishes events with LLDB-DAP's existing helpers. There is exactly one
event consumer. No breakpoint is hidden, serialized, or emulated by the UI.

The JavaScript drain loop must call `wasmbolt_dap_poll_runtime()` before it
reads `wasmbolt_dap_message_count()`. Omitting that poll leaves the inferior
correctly stopped inside LLDB, but no DAP `stopped` event reaches the UI. This
was reproduced in the WasmBolt integration: `breakpoint list` showed a resolved
and hit breakpoint and `process status` showed the stopped source frame while
the panel still appeared to be running. Restoring the poll immediately made
the panel receive the frame, scopes, and variables.

Pause uses the ordinary DAP `pause` request. LLDB calls `SBProcess::Halt()`,
WAMR stops the interpreter, the listener reports the stopped state, and the
adapter publishes `reason: pause`. The earlier custom shared-memory pause pump
was removed because it was unnecessary.

The WasmBolt Worker schedules Pause as an interrupt instead of placing it
behind a still-pending DAP attach operation. It exposes the running state only
after `configurationDone`. This preserves native halt semantics while avoiding
a browser scheduling race in which a short program exits first.

### Emscripten source loading

When DAP selects a frame, LLDB's `SourceManager` loads the source file. Native
LLDB launches `CommonInitializerImpl` with `std::async`, waits 500 ms before
showing a progress event, and then waits for completion. In the pthread-enabled
browser Worker, that nested async task never began, so `scopes` blocked while
selecting the stopped frame. Increasing the pthread pool from 16 to 32 did not
change the result.

The source-controlled patch calls `CommonInitializerImpl` synchronously only
under Emscripten. Source loading semantics are unchanged; only the optional
delayed progress event is omitted. Native targets keep the existing async
path. This is the minimal LLVM patch to propose upstream.

## Reproducible inputs

The reproducible experiment lives under `debugger/`; all generated state lives
under its ignored `.work` directory.

| Input         | Pinned identity                              |
| ------------- | -------------------------------------------- |
| LLVM          | `11b427b038a33f4301bdbc818ffc77c425e4494a`   |
| WAMR          | `d7050d9fe672e2d0bc65c44c966cebc0a1aca14b`   |
| Emscripten    | `6.0.8-h53c7e63_1` from emscripten-forge 6x  |
| xtensor       | `0.27.1-h0b0027f_0` from emscripten-forge 4x |
| xtl           | `0.8.2-h0b0027f_0` from emscripten-forge 4x  |
| nlohmann_json | `3.12.0-h2d46287_0` from emscripten-forge 6x |

The clean test artifact hashes are:

| Artifact        | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `lldb-dap.js`   | `2069e50043b14f000834648d979f9d378b67b2269a61dc917f7d9e4f87021b14` |
| `lldb-dap.wasm` | `e7862c3384ed6ef0b54d84210dad64ba54a81feb27f532135c025a0e9931b587` |
| pthread Worker  | `f205167738aa5cca162f248ac4c916f7f14ad061cf6064493da58eb766549bc2` |

The module uses Wasm exceptions, tail calls, `-pthread`, a 16-thread pool,
512 MiB initial memory, and a 2 GiB maximum. Hosting requires COOP/COEP headers
and `SharedArrayBuffer`.

## Verified on 2026-09-23

All tests ran in a real cross-origin-isolated Chromium Web Worker with the
clean source patch, tracing disabled, and no thread-selection workaround.

- Simple C++: breakpoint, stack, scopes, locals, Step Over, Continue, exit.
- Adjacent breakpoints: lines 12 and 13 both hit in order.
- Distant breakpoints: `compute` and `add` both hit in order.
- Step Into entered `add`, showed its locals, Step Out returned to `compute`,
  and Step Over advanced to the next statement.
- Pause stopped a running loop in `busy_work`, returned a source stack, and
  continued to exit.
- Direct LLDB commands: two breakpoints, continue, backtrace, frame variables,
  step-over, and exit.
- The integrated UI passed physical gutter clicks, Debug Console `bt`, Terminal
  `lldb frame variable`, restart with retained breakpoints, Pause with locals
  and a source stack, and Stop followed by a clean Start.
- `iostream`: stopped and stepped in `calculate_score`, captured
  `score=25`, and exited correctly.
- xtensor: stopped in `xtensor_broadcast_sum`, displayed xtensor expression
  objects and `total = 141`, stepped, and displayed `result = 282`.
- nlohmann_json: displayed the parsed JSON object, `base = 35` and
  `bonus = 7`, stepped, and displayed `score = 42`.
- xtl: stopped in `optional_score` and displayed `input = 13`.
- Simple C: stopped in `main` and displayed `input = 17`.
- Hand-written LLVM IR with DWARF metadata: stopped at `debug.ll:9` in
  `ir_add` and displayed `left = 19` and `right = 23`.
- Fresh-session soak: 20 out of 20 browser launches passed. The second ten
  mixed adjacent and distant breakpoints, stepping, Pause, iostream, xtensor,
  JSON, and the baseline flow.

The clean baseline DAP flow completed in approximately 499 ms after the module
was available. The measured xtensor flow took approximately 827 ms and the
nlohmann_json flow approximately 549 ms. These are debugger-flow measurements,
not initial network download measurements.

The adapter was also exercised through the WasmBolt UI with the exact
Emscripten 6.x `simple.wasm` acceptance artifact. The panel stopped at the
gutter breakpoint, displayed locals and the call stack, stepped into `add`,
stepped out, stepped over, and continued to exit with status 31.

The debugger-only WasmBolt playground additionally passed an integrated
breakpoint/frame/variable check for simple C, simple C++, iostream, xtl,
xtensor, nlohmann_json, and LLVM IR. Each source was paired with its exact
Emscripten 6.0.8 module through a byte-size and SHA-256 manifest; selecting the
module attaches directly and avoids the legacy in-browser debug build path.

The focused WasmBolt compiler now uses the same Emscripten 6.0.8 family as the
debugger. Start builds `debug.o`, links `debug.wasm`, and the resulting module
passes the complete stepping flow. The earlier Emscripten 4.0.9/manual-link
module could hit a breakpoint but failed Step Into; it is no longer used by the
focused debugger link.

## LLVM foundation already upstream

- [LLVM #223169](https://github.com/llvm/llvm-project/pull/223169):
  `HostInfoEmscripten`;
- [LLVM #223200](https://github.com/llvm/llvm-project/pull/223200):
  `PlatformEmscripten`;
- [LLVM #223206](https://github.com/llvm/llvm-project/pull/223206): build
  `lldbHost` under Emscripten; and
- [LLVM #223210](https://github.com/llvm/llvm-project/pull/223210): static
  `liblldb` support under Emscripten.

The remaining LLVM candidate is the focused Emscripten source-loading patch.
It should be proposed separately with the deadlock reproduction and without
WasmBolt-specific APIs.

## WAMR upstream plan

The WAMR change must remain transport-neutral. The proposed API should:

- create debugger state without opening a socket;
- accept GDB-remote request bytes from memory;
- return response bytes through a callback;
- expose the existing interpreter stop and continue behavior; and
- leave the socket-backed path unchanged.

The upstream test matrix should cover initial stop, one breakpoint, adjacent
and distant breakpoints, Continue, Step Over, Step Into, Step Out, Pause,
thread exit, and unchanged socket operation. WasmBolt UI concepts must not
appear in the WAMR patch.

## Still required

- Test disconnect, invalid modules, failed breakpoint resolution, and
  replacement after a deliberately poisoned session.
- Review the WAMR patch as a standalone upstream change and add native tests.
- Promote the latest integrated browser acceptance pass into a committed UI
  test before publishing a public link.
- Land the Clang ToolSession linker path, then replace the current honest
  two-stage build with the conventional one-driver command.
- Add Emscripten 6x xtl and xtensor recipes. Their current header-only 4x
  packages are verified with the Emscripten 6 compiler but remain explicit
  packaging follow-up.

## Product invariant

WasmBolt ships one lazy debugger Worker and one live LLDB session per debug
run. Debugging is disabled until the user chooses it. Every debugger UI and
Terminal action observes that session. Compilation and normal execution remain
independent, and generated `.js`, `.wasm`, `.data`, object files, archives, and
build trees are never committed.
