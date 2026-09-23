# Debugging WebAssembly with LLDB in WasmBolt

This tutorial describes the interface validated by the standalone browser
debugger and the workflow the WasmBolt IDE must expose. The debugger runs
entirely in the browser: LLDB-DAP talks to WAMR's classic interpreter through
an in-memory GDB-remote transport.

## Open the debugger playground

For the local WasmBolt build, open:

```text
http://127.0.0.1:4189/?debugger=1
```

This special page loads exact source/wasm pairs built by Emscripten 6.0.8. The
files are size-checked and SHA-256 verified before they enter the workspace.
They let us validate LLDB independently from WasmBolt's older compiler runtime.

For every example:

1. Click the bug button. Its blue active state means debugging is enabled.
2. Open the source file and click the debugger gutter at the documented line.
3. Select the matching `.wasm` file in Explorer.
4. Open **Debugger** and click **Start**.
5. Inspect Variables and Call Stack, then use the toolbar or enter an LLDB
   command in the debug console.
6. Continue to process exit before opening the next pair.

Selecting a supplied module means Start only attaches the debugger. It does
not compile again and it does not print an expanded linker command.

### Demo matrix

| Source              | Module               | Breakpoint | Expected stop                          |
| ------------------- | -------------------- | ---------: | -------------------------------------- |
| `simple.cpp`        | `simple.wasm`        |         12 | `compute`, `input = 7`                 |
| `simple.c`          | `simple-c.wasm`      |         11 | `main`, `input = 17`                   |
| `iostream.cpp`      | `iostream.wasm`      |         16 | `calculate_score`, `base = 10`         |
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

The user-facing command is intentionally ordinary:

```bash
clang++ -g -O0 simple.cpp -o simple.wasm
```

`clang++` owns the Emscripten sysroot, runtime libraries, and linker command.
WasmBolt must not require users to type or inspect an expanded `wasm-ld`
invocation.

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
pair additionally passed Step Into, Step Out, Step Over, and Continue in the
WasmBolt UI.

WasmBolt's older Emscripten 4.0.9/manual-link debug module is not compatible
enough for the full stepping flow. Until the compiler runtime moves to the
validated Emscripten 6.x driver path, editing a playground source does not
rebuild its paired module. Re-stage the examples after rebuilding them rather
than assuming that edited source still matches the embedded DWARF.
