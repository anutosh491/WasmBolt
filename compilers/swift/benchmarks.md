# Browser demo timings

Measured **2026-10-12** on an **Apple M5, 16 GiB RAM, macOS 26.5.1**, using
headless Chrome **154.0.8037.98**, without network or CPU throttling.
[Swift deployment](https://0be96219.wasmbolt-swift-demo.pages.dev/?language=swift),
[LLDB deployment](https://7881155d.wasmbolt-lldb-demo.pages.dev/),
[Clang REPL deployment](https://acc539f1.wasmbolt-lldb-demo.pages.dev/).
These are observations on this machine and connection, not guaranteed visitor
latencies or native performance parity. Compilation and execution happen in the browser.

## Swift first visit and cached use

Times are seconds. Compiler and program rows give median (range) from three
fresh profiles and three cached reloads; repeated Fibonacci/Date rows cover nine/six
clicks. CFG, debugger and REPL rows are single observations. Reload retains assets
but creates new workers and compiler module caches. Reopen means `:quit`, then
`swift repl` without reloading.

| Operation | First use | Same page, subsequent use | Cached reload |
| --- | ---: | ---: | ---: |
| Page → editable source and seven workspace files | 0.5–0.8 | Already visible | Not measured separately |
| Page → compiler ready | 11.2 (10.9–11.4) | Stays loaded | 1.5 (1.4–2.1) |
| Fibonacci Compile & Run after readiness | 3.7 (3.3–3.8) | 0.5 (0.4–0.7) | 1.6 (1.6–3.6) |
| Page → first Fibonacci output | 15.1 (14.3–15.3) | — | — |
| Date Compile & Run after Fibonacci, SDK warming in progress | 8.5 (8.5–8.7) | 1.4 (1.2–1.9) | 4.5 (2.6–4.8) |
| Fibonacci CFG, including opt/Graphviz loading | 5.2 | 0.3 | 0.6 |
| Open bug panel → matching Swift LLDB ready | 14.1 | Stays loaded | 0.6 |
| Start an existing multi-file debug binary → breakpoint | 1.7 | 1.6 on restart | Not measured separately |
| `swift repl` after exploring compilation/debugging | 12.1 | 1.8 on reopening | 2.8 |
| REPL `import Foundation` immediately after prompt | 7.6 | Not measured separately | 2.6 |

The earlier 44 MiB package took **16.1 s (15.6–16.5)** to become compiler-ready
and **18.2 s (17.1–19.0)** to show its first Fibonacci output in three fresh
profiles on the same day. The new initial package is **29.8 MiB**: 22.2 MiB
compiler plus 7.6 MiB headers/modules. Link archives add 7.4 MiB on first linking.
The native Swift driver's job plan identifies linking actions; AST/SIL/IR/object
commands need no link archive download. Stronger Brotli compression decodes to
identical compiler bytes. Repackaging retains all 2,029 original SDK files.

Link inputs warm after essential downloads finish. Other compiler library SDKs
warm sequentially after the visitor compiles source, unless data saving is enabled.
REPL binaries/SDKs and LLDB remain on demand. After the REPL prompt appears,
optional REPL libraries warm separately. Installation remains on demand.
The generated catalog applies this policy to packaged libraries, not only Foundation.

A separate test opened the REPL immediately after compiler readiness, in two
fresh profiles. It took **13.3–15.8 s**, **2.2–2.7 s** to reopen, and
**2.7–3.5 s** after a cached reload. First `1 + 1` took **0.43–0.46 s**.
An immediate first `import Foundation` took **7.6–9.9 s**, including its
still-cold optional host library; Date execution then took **0.46–0.87 s**.
These cold waits remain substantial; this demo does not claim an instant REPL.

The earlier loading policy took **25.3 s** for immediate REPL startup and
competed with unrelated SDK warming. The REPL now reuses the cached compiler
headers and downloads a **7.5 MiB host overlay**, rather than a 13.3 MiB full SDK;
its identical executable compresses to **22.0 MiB**, rather than 25.8 MiB.
Core plus overlay reproduce every original REPL file byte. Foundation module
metadata remains present at context creation; only its matching runtime library
is deferred. Compiler and linker inputs are unchanged by this REPL adjustment.
Network checks confirm no REPL payload transfer during compiler initialization
and each requested SDK/binary part transfers once. Before cross-worker download
coordination, a concurrent import fetched one 17 MiB chunk twice and took 9–12 s.

A separate first-library profile waited **6.4 s** for the complete Foundation SDK,
then spent **4.4 s** compiling/linking Date, **0.13 s** inspecting the generated
module and **0.40 s** instantiating/executing it. Background byte warming does
not precompile a compiler context's imported-module caches. Compiler and REPL
share downloaded assets, but have separate contexts and target library forms.

## Other demos and tools

Seconds, one fresh profile and cached reload per public deployment. Tool version
commands check initialization, not general optimization/translation performance.
opt/Graphviz and mlir-opt load as part of the actual CFG rows; their later version
commands are already warm.

| Operation | First use | Same page, subsequent use | Cached reload |
| --- | ---: | ---: | ---: |
| LLDB C/C++ demo: compiler ready | 10.6 | Stays loaded | 1.0 |
| Clang REPL demo: compiler ready | 14.5 | Stays loaded | 1.6 |
| C++ `simple.cpp`: first Compile & Run | 2.5 | Not measured separately | Not measured separately |
| C/C++ LLDB panel ready | 4.7 | Stays loaded | 0.3 |
| C++ Start, including build → breakpoint | 3.3 | 0.5–0.6 on restart | 1.8 |
| `clang-repl` → prompt | 14.0 | 0.3 on reopening | 1.1 |
| LLVM CFG, opt + dot | 3.8–6.8 | 0.2 | 0.5–0.6 |
| MLIR CFG, mlir-opt with dot already loaded | 5.3–8.7 | 0.2–0.4 | Not measured separately |
| `llc --version` | 3.6–7.3 | 0.05–0.1 | 0.3 |
| `llvm-nm --version` | 2.0–2.6 | 0.2 | 0.2 |
| `mlir-translate --version` | 2.0–4.3 | 0.2–0.4 | 0.2–0.3 |
| Enable clangd → service ready | 3.2–6.4 | Not measured separately | 0.5–0.6 |

Range rows combine observations from the two C/C++ deployments, whose network
throughput differed. clangd service readiness does not imply all headers have
finished parsing. Both demos passed C++ source-only AST, LLVM output generation,
LLVM/MLIR CFG, tool startup and cached payload reuse. LLDB checks cover C++, C,
LLVM IR sum/result values, JSON, multi-file Swift stepping, variables, restart,
stdout and disabled Pause after exit. REPL checks cover persistent state,
Foundation Date/Codable, error recovery, reset, interruption and reopening.

## Warm compilation and execution

Measured **2026-10-11**, five calls per program, using the resident compiler worker
and loaded SDKs. These older warm measurements use the same compiler binary;
this packaging change does not alter compiled code.
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

## Repeating measurements

For first-visit timings, use a fresh browser profile or clear site data. Time page
opening to Compile becoming enabled, then first Compile & Run to expected stdout
and restored readiness. Keep page-to-output separate from compiler readiness.
Repeat without reload for resident-session timings; reload without clearing data
for cached timings. For REPL, measure `swift repl`, `import Foundation`, then
`:quit` and `swift repl` again. Record whether optional SDK warming had finished.

Suggested wording: “The editor appears in about a second. On our M5 Mac in Chrome,
Swift becomes ready in about 11 seconds on first visit, and about 1–2 seconds
after caching. First Fibonacci output takes 14–15 seconds from page opening;
repeated runs take about half a second. Everything executes in the browser.”
