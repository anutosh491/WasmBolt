# Swift demo timings

Measured **2026-10-11** on an **Apple M5, 16 GiB RAM, macOS 26.5.1**, using
headless Chrome **154.0.8037.98**, without network or CPU throttling.
[Public demo](https://wasmbolt-swift-demo.pages.dev/?language=swift);
[measured deployment](https://c276aa77.wasmbolt-swift-demo.pages.dev/?language=swift),
source `7e83b3f`. Compilation, linking, debugging and execution happen in the
browser; Cloudflare serves the build files. These observations depend on this
machine and connection, and are not guaranteed visitor timings or native parity.

## First use and cached use

Times below are seconds. Compiler startup and Date rows show median (range)
across three fresh browser contexts, three cached reloads and nine same-page
Date repeats. Cold REPL/debugger/CFG ranges cover two contexts; their cached
reload timings are single observations. A reload keeps downloaded assets but
creates fresh workers; reopening the REPL means `:quit`, then `swift repl`.

| Operation | First use, including downloads | Same page, subsequent use | After reload, assets cached |
| --- | ---: | ---: | ---: |
| Open page → compiler ready | 17.7 (17.6–21.9) | Compiler stays loaded | 1.6 (1.3–1.6) |
| `dates.swift`: Compile & Run, `-O` | 10.7 (10.6–14.3) | 1.2 (1.1–1.5) | 3.7 (3.2–3.9) |
| Fibonacci CFG → rendered graph, `-O` | 4.2–4.3 | 0.3–0.4 | 0.7 |
| Open bug panel → LLDB ready | 13.4–14.2 | Debugger stays loaded | 0.5 |
| `swift repl` → usable prompt | 14.7–25.3 | 2.0–2.3 on reopening | 2.6 |
| REPL `import Foundation` → prompt | 7.8–11.3 | Not measured separately | 2.2 |

The first Date row starts **after compiler readiness**. Opening a completely
fresh page and immediately running Date took approximately **28–36 seconds**
in total. Cached reloads still initialize runtimes and rebuild compiler module
caches; cached SDK bytes alone do not give the same speed as a loaded session.
Network checks confirmed no hashed Foundation payloads were fetched again
after reload. Small manifest requests still occur.

First-use HTTP transfers are approximately **44 MiB** for the compiler/core SDK,
**22 MiB** for compiler Foundation, **42 MiB** for LLDB, **39 MiB** for the REPL,
and **18 MiB** for REPL Foundation. CFG adds about **12 MiB** for opt/Graphviz.
Foundation, debugger, REPL and CFG downloads start only when needed.

## Warm compilation and execution

Five calls per program, using the resident compiler worker and loaded SDKs.
Commands follow `swiftc -O <inputs> -o benchmark.wasm`, reusing one output file.
Values are median (range), in **milliseconds**. Build includes compilation,
linking and returning the output bytes. Run includes Wasm instantiation,
constructors, execution and stdout capture, rather than only algorithm CPU time.

| Inputs | Compile + link | Instantiate + execute |
| --- | ---: | ---: |
| `fibonacci.swift` | 299 (274–366) | 36 (33–39) |
| `fizzbuzz.swift` | 371 (313–488) | 36 (29–50) |
| `dates.swift` | 748 (675–1082) | 161 (137–191) |
| `json.swift` | 767 (685–862) | 67 (61–92) |
| `concurrency.swift` | 531 (380–759) | 44 (36–91) |
| `math.swift main.swift` | 328 (310–395) | 35 (30–43) |

Full **Compile & Run** clicks also inspect the binary and update the UI.
Three warm clicks per example measured medians of **0.55 s** for Fibonacci,
**0.45 s** for FizzBuzz, **0.97 s** for JSON and **0.59 s** for concurrency;
Date's nine-click median was **1.24 s**. Expected stdout and exit code 0 were checked.

Fibonacci output generation, three clicks each, had median times of **178 ms**
for AST, **421 ms** for SIL, **211 ms** for unoptimized LLVM IR, **199 ms** for
optimized IR and **429 ms** for assembly. These use the loaded Swift compiler.

## Debugger and REPL interaction

With LLDB ready and `multi-debug.wasm` already built, Start → `main.swift:2`
took **2.0–3.3 s** across two runs. Restart took **1.3–2.4 s** across six calls.
Step into `math.swift` and subsequent steps, including frame/variable updates,
took **62–85 ms**. This excludes the panel's first download and building the binary.

The first REPL `1 + 1` took **0.4–0.7 s**; ten subsequent expressions took
**50–141 ms**. After importing Foundation, the first Date expression took
**0.4–0.6 s**, with subsequent expressions taking **66–118 ms**. These include
cell compilation/linking/execution and returning the terminal prompt.
Separate correctness checks cover persistent definitions, multiline functions,
Foundation Date/Codable, error recovery, reset, interruption and multi-file stepping.

## Repeating the measurements

For cold timings, clear this site's browser data and open the demo. Time until
Compile is enabled, select `dates.swift` with optimization **O**, then time
Compile & Run until stdout and compiler readiness return. Repeat without reload
for warm timings; reload without clearing site data for cached timings.
In the advanced terminal, time `swift repl`, `import Foundation`, then `:quit`
and `swift repl` again. Cold REPL startup is additional to page startup.

Suggested demo wording: “On an M5 Mac in Chrome, these examples compile, link
and run in roughly 0.5–1.5 seconds once loaded. First use downloads the toolchain;
the REPL took 15–25 seconds initially, about 2 seconds to reopen, and about
3 seconds after a cached reload. Everything executes locally in the browser.”
