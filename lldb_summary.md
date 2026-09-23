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

The user-facing build command stays conventional:

```text
clang++ -g -O0 source.cpp -o program.wasm
```

The compiler driver owns its sysroot, runtime libraries, and linker expansion.
The UI must not print or reconstruct the expanded `wasm-ld` invocation. Start
Debugging compiles once when necessary and attaches to the resulting module;
debugger commands never recompile it.

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

Pause uses the ordinary DAP `pause` request. LLDB calls `SBProcess::Halt()`,
WAMR stops the interpreter, the listener reports the stopped state, and the
adapter publishes `reason: pause`. The earlier custom shared-memory pause pump
was removed because it was unnecessary.

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

| Input | Pinned identity |
| --- | --- |
| LLVM | `11b427b038a33f4301bdbc818ffc77c425e4494a` |
| WAMR | `d7050d9fe672e2d0bc65c44c966cebc0a1aca14b` |
| Emscripten | `6.0.8-h53c7e63_1` from emscripten-forge 6x |
| xtensor | `0.27.1-h0b0027f_0` from emscripten-forge 4x |
| xtl | `0.8.2-h0b0027f_0` from emscripten-forge 4x |
| nlohmann_json | `3.12.0-h2d46287_0` from emscripten-forge 6x |

The clean test artifact hashes are:

| Artifact | SHA-256 |
| --- | --- |
| `lldb-dap.js` | `5c5ba4d4943f519b04ca345d3110fe7b9e18cf783b554eedfb4e1608839f9cf9` |
| `lldb-dap.wasm` | `8fffc68a209af6bffb8fcff109f17740bc7e2334783a98b2e955493460f2bfe6` |
| pthread Worker | `f205167738aa5cca162f248ac4c916f7f14ad061cf6064493da58eb766549bc2` |

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
- `iostream`: stopped and stepped in `calculate_score`, captured
  `score=25`, and exited correctly.
- xtensor: stopped in `xtensor_broadcast_sum`, displayed xtensor expression
  objects and `total = 141`, stepped, and displayed `result = 282`.
- nlohmann_json: displayed the parsed JSON object, `base = 35` and
  `bonus = 7`, stepped, and displayed `score = 42`.
- Fresh-session soak: 20 out of 20 browser launches passed. The second ten
  mixed adjacent and distant breakpoints, stepping, Pause, iostream, xtensor,
  JSON, and the baseline flow.

The clean baseline DAP flow completed in approximately 499 ms after the module
was available. The measured xtensor flow took approximately 827 ms and the
nlohmann_json flow approximately 549 ms. These are debugger-flow measurements,
not initial network download measurements.

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

- Test disconnect, same-Worker restart, invalid modules, failed breakpoint
  resolution, and replacement after a deliberately poisoned session.
- Review the WAMR patch as a standalone upstream change and add native tests.
- Integrate the proven adapter into WasmBolt's explicitly enabled Debugger
  panel and Terminal.
- Make Start Debugging use the simple compiler-driver command and attach to its
  output without printing the expanded runtime-library link command.
- Restore package files through the same verified empack environment used by
  the compiler; do not bake third-party headers into debugger artifacts.
- Run the integrated WasmBolt browser tests before publishing a public link.

## Product invariant

WasmBolt ships one lazy debugger Worker and one live LLDB session per debug
run. Debugging is disabled until the user chooses it. Every debugger UI and
Terminal action observes that session. Compilation and normal execution remain
independent, and generated `.js`, `.wasm`, `.data`, object files, archives, and
build trees are never committed.
