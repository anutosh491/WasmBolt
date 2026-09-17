# Isolated command-line tool workers

`src/compiler/tool-worker.ts` is the process-equivalent boundary for genuine
Emscripten command-line programs. It is suitable for dedicated `mlir-opt`,
`mlir-translate`, `opt` and `llc` builds.

The host supplies either an argv array or one direct command string, a complete
workspace snapshot and the runtime asset names. The worker:

1. verifies and loads that runtime's Wasm asset;
2. restores `/workspace` into the runtime's private MEMFS;
3. passes `argv.slice(1)` directly to Emscripten's generated `main` wrapper;
4. captures the real program's exit status, stdout and stderr;
5. returns the resulting workspace snapshot; and
6. is terminated by the client after the response.

There is deliberately no knowledge of `-o`, MLIR translation names, LLVM pass
pipelines or any other tool option in this layer. The upstream driver's own
command-line parser defines the CLI. Command-string support only performs
generic quoting and word splitting; it does not emulate pipes or a shell.

An ordinary non-zero exit is a command result. A runtime abort, invalid worker
message or transport failure rejects the request. Either way, the next call uses
a new Worker and a new Wasm instance, so process-global LLVM command-line state
and a fatal tool invocation cannot poison the following call.

Structured UI pipelines should prefer argv arrays. The terminal may tokenize one
command and pass the resulting argv. Files returned by the worker must be merged
into the canonical workspace before another service is started.
