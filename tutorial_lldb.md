# Debugging WebAssembly with LLDB in WasmBolt

This tutorial describes the interface validated by the standalone browser
debugger and the workflow the WasmBolt IDE must expose. The debugger runs
entirely in the browser: LLDB-DAP talks to WAMR's classic interpreter through
an in-memory GDB-remote transport.

## Open the debugger playground

For the current local WasmBolt build, open:

```text
http://127.0.0.1:4192/?debugger=1
```

This focused page loads source files and the Emscripten 6.0.8 compiler and
debugger runtimes. Generated `debug.o` and `debug.wasm` files appear only after
Start builds the selected source.

For every example:

1. Click the bug button. Its blue active state means debugging is enabled.
2. Open the source file and click the debugger gutter at the documented line.
3. Open **Debugger** and click **Start**. It compiles, links, and attaches.
4. Inspect Variables and Call Stack, then use the toolbar or enter an LLDB
   command in the debug console.
5. Continue to process exit before opening the next example.

Clicking the generated `debug.wasm` opens its WAT rendering. Debug controls do
not rebuild the module; a rebuild occurs only when Start needs a fresh module.

### Acceptance matrix

The focused link builds the C and C++ sources when Start is pressed. The
source-controlled standalone harness also keeps exact source/module pairs for
independent LLDB testing, including the LLVM IR case.

| Source              | Module               | Breakpoint | Expected stop                          |
| ------------------- | -------------------- | ---------: | -------------------------------------- |
| `simple.cpp`        | `simple.wasm`        |         12 | `compute`, `input = 7`                 |
| `simple.c`          | `simple-c.wasm`      |         11 | `main`, `input = 17`                   |
| `iostream.cpp`      | `iostream.wasm`      |         16 | `calculate_score`, `base = 10`         |
| `pause.cpp`         | `pause.wasm`         |          - | Pause inside `busy_work`               |
| `xtl.cpp`           | `xtl.wasm`           |          8 | `optional_score`, `input = 13`         |
| `xtensor.cpp`       | `xtensor.wasm`       |         10 | `xtensor_broadcast_sum`, `total = 141` |
| `nlohmann_json.cpp` | `nlohmann_json.wasm` |          7 | `json_score`, `base = 35`, `bonus = 7` |
| `debug.ll`          | `debug-ir.wasm`      |          9 | `ir_add`, `left = 19`, `right = 23`    |

For the complete stepping example, use `simple.cpp`: Step Into from line 12
enters `add`, Step Out returns to `compute`, Step Over advances to line 13,
and Continue exits with status 31.

### Debug LLVM IR

LLVM IR can be source-debugged when it carries valid debug metadata. The
included `debug.ll` defines `DICompileUnit`, `DISubprogram`, local-variable,
and line-location metadata and uses `llvm.dbg.value` for its arguments. A tiny
C entry point calls `ir_add`; line 9 therefore stops with `left = 19` and
`right = 23` visible in LLDB.

An arbitrary plain `.ll` file without `!DI*` metadata has no source-line or
local-variable mapping for LLDB. It can still be inspected at the function or
instruction level, but the editor cannot truthfully offer C-like line stepping
or named locals that are absent from the module.

## Build a debuggable module

Start with `simple.cpp`:

```cpp
int add(int left, int right) {
  int result = left + right;
  return result;
}

int multiply(int value, int factor) {
  int result = value * factor;
  return result;
}

int compute(int input) {
  int sum = add(input, 4);
  int product = multiply(sum, 3);
  return product - 2;
}

int main() { return compute(7); }
```

The long-term user-facing command is intentionally ordinary:

```bash
clang++ -g -O0 simple.cpp -o simple.wasm
```

Until Clang's ToolSession-owned linker dispatch lands, Start honestly shows two
commands: a `clang++ -O0 -g -c` compile to `debug.o`, followed by `wasm-ld`
using `-L` and named Emscripten libraries. The user does not type them, and the
Terminal does not show a long expansion of individual archive paths.

## Use the Debugger panel

1. Click the bug button to enable debugging. The debugger is off by default.
2. Open `simple.cpp` and click the gutter at line 12, the `sum` assignment.
3. Click **Start**. WasmBolt builds the module once if the source is newer and
   attaches LLDB-DAP to that `.wasm` file.
4. Inspect Variables and Call Stack when execution pauses.
5. Use Continue, Pause, Step Over, Step Into, Step Out, Restart, and Stop from
   the debugger toolbar.

The validated sequence is:

- stop at `compute` line 12 with `input = 7`;
- Step Into `add` and inspect `left = 7` and `right = 4`;
- Step Out to `compute`;
- Step Over and observe `sum = 11`; and
- Continue to exit with status 31.

Adjacent breakpoints at lines 12 and 13 and distant breakpoints in `compute`
and `add` have both been tested as separate multiple-breakpoint flows. Pause
also stops a running loop and returns a valid source frame.

Restart creates a fresh debugger Worker and reapplies the current breakpoints.
Stop discards the Worker, clears frames and variables, and enables a clean
Start. The sequence Start, breakpoint, Stop, Start, same breakpoint has passed
in the browser UI.

## Enter LLDB commands in the Terminal

The Terminal and Debugger panel share the same LLDB session. They must not
start separate debugger processes. Once the debugger is enabled and the
module is attached, these commands exercise the same state as the gutter and
toolbar:

```text
lldb breakpoint set --file simple.cpp --line 12
lldb breakpoint set --file simple.cpp --line 2
lldb process continue
lldb thread backtrace
lldb frame variable input sum product
lldb breakpoint delete 2
lldb thread step-over
lldb frame variable input sum product
lldb process continue
```

The `lldb ` prefix is WasmBolt terminal routing. The remainder is passed to
LLDB as a DAP REPL evaluation; it is not parsed or reimplemented by the UI.
A terminal breakpoint and a gutter breakpoint therefore appear in the same
breakpoint list.

## Run the source-controlled acceptance probes

After rebuilding the standalone runtime, the browser harness can reproduce
the same behavior without the IDE:

```bash
cd debugger
node smoke/run.mjs
node smoke/run.mjs static-commands
node smoke/run.mjs multiple-breakpoints
node smoke/run.mjs distant-breakpoints
node smoke/run.mjs step-in-out
node smoke/run.mjs pause
node smoke/run.mjs iostream
```

When their package include prefixes are supplied during guest construction,
the same harness also tests real header-only libraries:

```bash
node smoke/run.mjs xtensor
node smoke/run.mjs json
```

The xtensor probe stops inside `xtensor_broadcast_sum`, observes `total = 141`,
steps once, observes `result = 282`, and exits normally. The nlohmann_json
probe inspects a parsed JSON object, `base = 35`, `bonus = 7`, and
`score = 42`.

## Current boundary

Everything above has passed in the standalone Chromium harness. The core UI
sequence—gutter breakpoint, frames, variables, Step Into, Step Out, Step Over,
and Continue—also passed inside WasmBolt when loading the same Emscripten 6.x
acceptance module.

The local debugger playground has passed integrated gutter breakpoints, frames,
and variables for all seven source/module pairs in the table. The simple C++
pair additionally passed Step Into, Step Out, Step Over, Continue, Restart, and
Stop in the WasmBolt UI. Debug Console `bt`, Terminal
`lldb frame variable`, and Pause inside `busy_work` also passed.

The focused compiler and debugger now use the same Emscripten 6.0.8 family.
The earlier Emscripten 4.0.9/manual-link debug module could stop at a breakpoint
but failed Step Into and is not used by the current focused link.
