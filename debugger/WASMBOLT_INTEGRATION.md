# WasmBolt debugger integration contract

This document records the product-side requirements proved by the standalone
LLDB/WAMR experiment and the focused WasmBolt browser acceptance run. It keeps
the debugger-only branch self-contained without importing the complete IDE.

## Runtime topology

One replaceable browser Worker owns one pthread-enabled Emscripten module that
contains LLDB-DAP, liblldb, the in-memory GDB-remote bridge, and WAMR's classic
interpreter. Emscripten-created pthread Workers belong to that module. The
product must not create a separate `lldb.js`/`lldb.wasm` for Terminal commands.

The compiler uses a separate persistent Worker. Stopping or replacing the
debugger must not discard compiler state or workspace files.

Hosting must return these headers for the page, Workers, and Wasm assets:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

`SharedArrayBuffer` and WebAssembly threads must be available before the bug
button is offered.

## Versioned assets

The product manifest must integrity-check and stage:

- `lldb-dap/lldb-dap.js`;
- `lldb-dap/lldb-dap.wasm`;
- `lldb-dap/lldb-dap.worker.js`; and
- the debugger Worker that owns DAP request and event routing.

The compiler, debug sysroot, LLDB, and WAMR build must use one compatible
Emscripten family. The verified configuration uses Emscripten 6.0.8. The older
Emscripten 4.0.9/manual-link guest could stop at a breakpoint but failed Step
Into and must not be restored as the debugger build path.

Third-party headers come from the compiler's verified empack environment. They
are not embedded into the debugger module. nlohmann-json is available from the
6x channel; 6x xtl and xtensor recipes remain packaging follow-up, while their
header-only 4x packages have been compiled and debugged with the 6.0.8 compiler.

Generated `.js`, `.wasm`, `.data`, objects, archives, package payloads, and
build directories remain outside Git.

## Start and build behavior

Debugging is disabled until the user clicks the bug button. Start takes the
selected source snapshot, creates a fresh DWARF module, and attaches once.

Until Clang's ToolSession-owned linker dispatch lands, the honest browser path
has two tool calls:

```text
clang++ ... -O0 -g -c /workspace/source.cpp -o /workspace/debug.o
wasm-ld /workspace/debug.o /lib/wasm32-emscripten/crt1.o \
  -L/lib/wasm32-emscripten -lstandalonewasm-nocatch \
  -lstubs-debug -lc-debug -ldlmalloc-debug -lclang_rt.builtins \
  -lc++-debug-noexcept -lc++abi-debug-noexcept \
  -o /workspace/debug.wasm
```

The UI may show these two commands, but it must not expand every archive to a
long absolute-path link command. The user never types the build. Once linker
dispatch is available, replace it with the conventional driver command:

```text
clang++ -O0 -g source.cpp -o debug.wasm
```

Only source files are present initially. `debug.o` and `debug.wasm` appear
after Start. Selecting `debug.wasm` renders its WAT representation.

## DAP ordering and event ownership

The debugger Worker follows this order:

1. load and initialize the Emscripten module;
2. send DAP `initialize`;
3. prepare the WAMR session;
4. begin DAP `attach`;
5. install every source breakpoint;
6. send `configurationDone`;
7. expose the running or stopped state to the UI; and
8. complete attach and normal request processing.

Exactly one consumer drains LLDB process events. The browser bridge disables
the competing native LLDB-DAP event consumers and publishes events with
LLDB-DAP's existing helpers.

Every drain iteration must call `wasmbolt_dap_poll_runtime()` before reading
`wasmbolt_dap_message_count()`. Without the poll, LLDB can show a resolved and
hit breakpoint while the browser receives no DAP `stopped` event.

A stop received before `configurationDone` is buffered. WAMR's synthetic
attach step is not exposed as a user stop. A pre-configuration `continued`
event must not expose Pause prematurely.

Pause is an interrupt rather than an ordered operation. It must be allowed to
overtake the still-pending attach operation; otherwise a short inferior can
exit before `SBProcess::Halt()` runs. Continue, stepping, frame selection, and
ordinary REPL commands remain ordered.

## UI and lifecycle ownership

- CodeMirror gutter clicks and F9 update one breakpoint model.
- Breakpoints are reapplied when a session is started or restarted.
- A stopped event refreshes frames, selects the top frame, loads variables,
  selects its workspace source, and highlights its 1-based source line.
- Continue, Pause, Step Over, Step Into, and Step Out are enabled only for the
  matching process state.
- Restart terminates the complete Worker tree, creates a fresh debugger
  Worker, and reuses the latest module/source/breakpoint request.
- Stop terminates the complete Worker tree, rejects pending requests, clears
  frames and variables, and returns the panel to idle without touching files.
- Process exit also clears frames and makes a later Start create a new Worker.

The Debug Console sends DAP `evaluate` requests with REPL context. Terminal
input beginning with `lldb ` removes only that routing prefix and sends the
remainder to the same live adapter. Both surfaces therefore observe the same
selected frame, breakpoints, variables, and inferior.

## Verified product acceptance flow

The focused WasmBolt link passed all of the following in cross-origin-isolated
Chromium with no console or page errors:

- physical gutter breakpoints on adjacent source lines;
- Start from source, followed by generated `debug.o` and `debug.wasm`;
- Step Into `add`, Step Out, Step Over, and Continue;
- Debug Console `bt` and Terminal `lldb frame variable`;
- Restart with breakpoint preservation;
- Pause inside `busy_work` with locals and a source call stack;
- Stop, a clean second Start, the same breakpoint, and another Stop;
- C, C++, iostream, xtl, xtensor, and nlohmann-json sources; and
- selecting `debug.wasm` and rendering WAT.

The standalone matrix additionally covers multiple/distant breakpoints,
static LLDB commands, LLVM IR carrying DWARF metadata, 20 fresh sessions, and
the low-level LLDB/WAMR bridge independently from the WasmBolt UI.

Before a public deployment, promote the product acceptance flow into the main
WasmBolt UI test suite and test invalid modules, unresolved breakpoints,
disconnect, and replacement after a deliberately poisoned session.

## WasmBolt implementation map

When applying this experiment to the WasmBolt workbench, keep the integration
changes within these existing product boundaries:

- `src/lldb/debugger.ts`: public request, state, event, and client contracts;
- `src/lldb/debug-protocol.ts`: validated page/Worker messages;
- `src/lldb/client.ts`: replaceable Worker and request ownership;
- `src/lldb/phase.ts`: configuration, running, stopped, and exit ordering;
- `src/lldb/debug-worker.ts`: module loading, DAP, WAMR polling, Pause, and
  source/frame refresh;
- `src/commands.ts`: Start, controls, Stop, gutter synchronization, and
  Terminal `lldb ` routing;
- `src/ui/editor.tsx`: gutter markers and stopped-line decoration;
- `src/ui/debug.tsx`: toolbar, variables, call stack, and Debug Console;
- `src/compiler/request.ts`: the current two-stage DWARF build plan;
- `src/compiler/module.ts`: lazy debug-sysroot mounting;
- `scripts/compiler.mjs`: source-built asset staging and integrity metadata;
- `src/debug-demos.ts`: verified debugger example restoration; and
- `src/__tests__/debug*.spec.ts`: client, phase, reducer, and command coverage.

The domain model remains independent of React. Lumino commands orchestrate
the compiler and debugger clients, and the debugger Worker owns all native
state. Do not move DAP, WAMR, compilation, or filesystem effects into the UI.
