# LLDB-DAP and WAMR E2E gate

Do not begin with xtensor. First prove the debugger lifecycle on a tiny guest,
then run the same protocol against the template-heavy example.

## Request tracing

The earlier prototype occasionally reached WAMR stop status 5 while the UI
remained in `Running`. The suspected boundary is an eager DAP `scopes` or
`variables` request, but the exact request was never proven.

Instrument the browser bridge around every adapter dispatch:

```text
[DAP/request] <sequence> <command> enter
[DAP/request] <sequence> <command> exit
```

Also log:

- WAMR stop generation and stop status;
- LLDB process state transitions;
- each emitted DAP `stopped`, `continued`, and `terminated` event.

The UI should publish a paused state after `stopped` and `stackTrace`. Do not
request `scopes` or `variables` automatically. Fetch them only when the user
expands a frame or variable group. A request whose `enter` has no matching
`exit` identifies the blocking LLDB-DAP call.

## Phase 1: simple guest

Build [simple.cpp](tests/simple.cpp) with `-O0 -g`. Then:

1. create the target and set a source breakpoint on line 2;
2. launch and require one `stopped` event;
3. request `stackTrace` and verify `square_plus_one`;
4. request variables lazily and verify `value = 6`, `squared = 0`;
5. issue `next` and verify line 3 and `squared = 36`;
6. continue and verify exit status 37;
7. restart and prove that the breakpoint is hit again.

Repeat start, stop, restart, breakpoint, next, and continue at least 20 times.
Any timeout terminates the disposable debugger Worker; it must never freeze the
IDE or compiler Worker.

## Phase 2: xtensor guest

Only after Phase 1 is stable, build [xtensor.cpp](tests/xtensor.cpp) with the
emscripten-forge xtensor headers and `-O0 -g`. Break inside
`xtensor_broadcast_sum` and verify:

- `scale = 2`;
- `total = 141` after the sum line;
- `result = 282` after the multiply line;
- the process exit code is `282 & 0xff`, or 26.

Template-heavy source stepping may land in xtensor headers. That is useful to
investigate, but it must not weaken the simple-guest acceptance gate.

## Publication gate

- Chromium loads the page without a long-task/crash dialog.
- COOP/COEP and `SharedArrayBuffer` checks pass.
- The simple test passes 20 consecutive sessions.
- The variables request has paired enter/exit logs.
- The debugger runs in a disposable Worker, not on the UI thread.
- No generated `.js`, `.wasm`, archive, or LLVM build tree is committed.
