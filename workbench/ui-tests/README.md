# Browser acceptance tests

Run from the repository root using its single jlpm environment:

```sh
pixi run --as-is jlpm playwright install
pixi run --as-is jlpm test:browser
```

Inside a Pixi shell, omit `pixi run --as-is`. If your current directory is
`ui-tests`, select the root configuration explicitly:

```sh
jlpm playwright test --config ../playwright.config.mjs
```

Running `jlpm playwright test` from this directory without `--config` discovers
the test files but misses the root configuration. The test servers do not start,
so navigation fails with `ERR_CONNECTION_REFUSED`.

First build the compiler, production extension, and combined site as described
in CONTRIBUTING.md. The root Playwright configuration starts local static and
JupyterLab servers below non-root URLs. Locally it can reuse existing servers on
ports 8765 and 8766. The JupyterLab test server uses `work/jupyter-config` for
settings and saved workspaces so tests do not restore your personal workspace.
Servers started by Playwright stop when the run ends.

The local launcher runs on port 8767. By default, tests use `python -m wasmbolt`
from the checkout. Set `WASMBOLT_LOCAL_COMMAND` to the installed command to test
a wheel; CI uses a clean environment without JupyterLab. Build the combined site
before starting either version.

JupyterLab layout tests reset a dedicated workspace for each browser. This keeps
host sidebar widths from earlier resize tests out of the geometry checks;
WasmBolt's **Reset layout** only resets the workbench's own panes.

Successful HTTP requests, expected download disconnects, and Jupyter startup
messages are quiet by default. Server warnings and errors remain visible. To
include request logs and Jupyter startup details, run:

```sh
WASMBOLT_TEST_SERVER_LOGS=1 pixi run --as-is jlpm test:browser
```

Chromium exercises all hosts and failure modes. All browsers check tab layout,
comparison sizing, host-specific sharing controls, and guide navigation with
keyboard focus restoration. The standalone guide also opens offline. Firefox and
WebKit run the standalone workflow, artifact comparison, scalar execution,
LLVM/MLIR tools, real compiler matrix, and both notebook kernels. Results
include per-stage timings, artifact sizes, compiler measurements, screenshots,
and traces for failures. Binary files are summarized rather than serialized into
measurement attachments. Memory measurements observe the worker's Wasm linear
memory; they exclude browser overhead.

These tests use the actual shared workbench and actual compiler. They do not
need a remote compilation service. The Pages tests also execute the bundled C23
and C++23 notebooks with the actual xeus kernel, follow their links to the
rendered guide, and compile from Lite under the combined site's URL prefix.
Navigation to Lite stays in the same tab and supports returning to the explorer.
The local launcher runs these same tests with external requests blocked. The
network-disconnect test covers compilation after initialization, not offline
page reload.

Explorer coverage compiles each selected representation and checks that changing
tabs alone does no compiler work. It also covers independent comparison
selections, downloads, custom passes, lazy MLIR loading and retry, command
redirection, manual modules, scalar signatures, stateful calls, NaN, traps,
Stop, timeout, and replacement modules. Unit tests cover stage dependencies and
partial failure, buffer ownership, stale responses, worker generations, session
migration, and malformed protocol or Wasm data.

The standalone runtime test compiles the packaged `xtensor.cpp` example. It also
checks that empack `.tar.gz` assets are served as `application/gzip` without
`Content-Encoding`, so browsers receive the exact bytes recorded in the compiler
manifest.

CI runs the full configured suite on main branch pushes, pull requests, and
release builds. It builds all hosts and installs the required browsers before
running `jlpm test:browser` from the repository root. Both publishing jobs wait
for these checks to pass.
