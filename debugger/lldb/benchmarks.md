# C/C++ demo timings

Measured on 11 October 2026 using Chrome 154.0.8037.98 on an Apple M5 Mac
with 16 GiB RAM and macOS 26.5.1. These are public Cloudflare Pages measurements,
with no CPU or network throttling. Both versions use the same compiler,
debugger and clang-repl binaries; no toolchain rebuild was involved.

Each demo started in a fresh browser context, exercised its features, then
reloaded in that context. Startup and first-use figures are single observations;
warm figures are medians of three calls, except MLIR CFG (two) and REPL
expressions (five). Download times vary with the connection and CDN state.
The Mac was running other applications; C++ indexing consumed several cores during the final run,
so warm CPU timings are observations rather than controlled speedup comparisons.

## Reloading after the first use

These measurements include loading cached bytes and creating new runtime
instances. They do not assume the old page or its Workers are still running.

| Action | Before | After |
| --- | ---: | ---: |
| LLDB demo: compiler ready after reload | 7.13 s | 0.82 s |
| LLDB panel ready after reload | 4.91 s | 0.15 s |
| LLDB demo: first C++ CFG after reload | 4.77 s | 0.98 s |
| clang-repl demo: compiler ready after reload | 7.01 s | 0.80 s |
| clang-repl ready after reload | 5.76 s | 0.71 s |
| clang-repl demo: first C++ CFG after reload | 4.05 s | 0.68 s |

Building `simple.cpp` after reload and reaching its breakpoint took
2.19 s after the panel was ready, including guest SDK setup and a fresh
LLDB/WAMR process.

Neither updated demo requested its large binary/data/SDK payloads again on
reload. Small manifests and JavaScript are still checked. Browser storage
availability and eviction affect whether this cache can be reused.

## Working in an open page

| Action | Current median |
| --- | ---: |
| LLDB demo: C++ CFG | 302 ms |
| LLDB demo: MLIR CFG | 372 ms |
| Restart C++ debugging at the same breakpoint | 1017 ms |
| clang-repl demo: C++ CFG | 292 ms |
| clang-repl demo: MLIR CFG | 304 ms |
| Quit and reopen clang-repl | 363 ms |
| Evaluate `1 + 1` in clang-repl | 33 ms |

In the LLDB workflow, each CFG previously copied about 5 MB of workspace
files into both opt and Graphviz. The new path sends 1,516 bytes of LLVM IR
to opt and 399 bytes of DOT to Graphviz. Explicit terminal commands retain
access to the complete workspace.

## First visit, with empty browser storage

| Action | Before | After |
| --- | ---: | ---: |
| LLDB demo: compiler ready | 8.16 s | 5.54 s |
| First LLDB panel opening | 4.71 s | 3.11 s |
| Build C++ and reach the first breakpoint, after panel ready | 3.91 s | 4.04 s |
| LLDB demo: first C++ CFG | 6.35 s | 4.65 s |
| LLDB demo: first MLIR CFG | 6.55 s | 6.75 s |
| clang-repl demo: compiler ready | 7.83 s | 10.52 s |
| First clang-repl startup, after compiler ready | 6.64 s | 7.62 s |
| clang-repl demo: first C++ CFG | 5.70 s | 5.17 s |
| clang-repl demo: first MLIR CFG | 6.35 s | 5.99 s |

These runs establish faster cached reloads and smaller worker transfers;
they do not establish a first-visit speedup. The first visit still downloads
the toolchain. The debugger and REPL stay lazy until selected.

The checks covered C++, C, LLVM IR and nlohmann_json debugging, local values,
step in/over/out, restart, program output and disabled Pause after exit.
Clang REPL checks covered iostream, vector, persistent cells, error recovery,
reset, quit and Ctrl+C recovery. LLVM utility and complete MLIR lowering
tutorials, resident Clang outputs/execution, and nested C++ values also passed.
Both demos generated LLVM and MLIR CFGs and rendered SVGs.
