# Browser LLDB experiment

This directory is a self-contained, reproducible checkpoint for WasmBolt's
LLDB-DAP and WAMR browser debugger. It intentionally contains no WasmBolt UI
and no generated compiler or debugger artifacts.

The committed pieces are:

- `patches/`: the focused LLVM source-loading fix and WAMR's in-memory
  GDB-remote transport experiment;
- `bridge/`: the browser LLDB-DAP adapter and WAMR runtime bridge;
- `scripts/`: pinned configure, build, link, and guest-build stages;
- `smoke/`: a cross-origin-isolated Chromium acceptance runner; and
- `tests/`: small C++ fixtures plus xtensor and nlohmann_json coverage.

[`WASMBOLT_INTEGRATION.md`](WASMBOLT_INTEGRATION.md) records the product-side
Worker, compiler, DAP ordering, lifecycle, UI, and acceptance requirements.

All generated state is written below the ignored `debugger/.work/` directory.
The product architecture, exact validated behaviors, upstream plan, and known
remaining work are recorded in [`../lldb_summary.md`](../lldb_summary.md).

## Rebuild

Use an LLVM checkout at the revision recorded in `scripts/versions.sh`. When
the WasmBolt repository is nested directly inside that checkout, the scripts
find it automatically. Otherwise set `LLVM_PROJECT_ROOT` explicitly.

```bash
cd debugger
bash scripts/00-preflight.sh
bash scripts/10-fetch-wamr.sh
bash scripts/20-build-wamr.sh
bash scripts/25-build-native-tools.sh
bash scripts/30-configure-lldb.sh
bash scripts/40-build-lldb.sh
bash scripts/45-build-bridge.sh
bash scripts/50-link-debugger.sh
bash scripts/60-build-test-guests.sh
```

`XTENSOR_INCLUDE_DIR` and `NLOHMANN_JSON_INCLUDE_DIR` enable their optional
guest builds. They must point at extracted emscripten-forge package prefixes;
third-party headers are never copied into this repository.

To stage the source/module pairs for a local WasmBolt debugger playground:

```bash
node scripts/70-stage-playground.mjs /path/to/WasmBolt/workbench/compiler/debug-examples
```

The generated directory is intentionally ignored. Its manifest records the
exact byte size and SHA-256 digest of every browser-loaded file.

## Verify

The baseline flow is:

```bash
node smoke/run.mjs
```

The named probes include:

```bash
node smoke/run.mjs multiple-breakpoints
node smoke/run.mjs distant-breakpoints
node smoke/run.mjs step-in-out
node smoke/run.mjs pause
node smoke/run.mjs iostream
node smoke/run.mjs xtensor
node smoke/run.mjs json
```

After staging the runtime into a WasmBolt checkout and serving its focused
debugger page, run the complete product acceptance flow against its URL:

```bash
node smoke/wasmbolt.mjs http://127.0.0.1:4192/?debugger=1
```

The runner serves only localhost, adds the COOP/COEP headers required for
`SharedArrayBuffer`, launches Chromium, and exits nonzero on failure.
