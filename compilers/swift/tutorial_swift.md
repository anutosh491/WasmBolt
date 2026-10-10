# Swift in WasmBolt

Open `fibonacci.swift` or `fizzbuzz.swift` in Explorer. Select **Swift** and
**WebAssembly 32**. Fibonacci prints `Fibonacci(10) = 55`; FizzBuzz prints
`Hello, 🌐!` and the sequence through 20. Everything runs in your browser.

Select AST, SIL, LLVM IR, Optimized IR or Assembly, then **Compile**.
**LLVM IR** uses `-Onone`; Optimized IR uses the selected optimization.
Swift exposes `Onone`, `O` and `Osize`. Assembly is WebAssembly assembler syntax.
**Compile & Run** builds an object, links the static Swift runtime and executes
its Wasm entry point. The terminal shows the same short `swiftc` commands you can run yourself.
Generated `.sil`, `.ll`, `.s`, `.o` and `.wasm` files appear in Explorer;
click a file to inspect or download it. The compiler/linker stay loaded.
Select **CFG**, then **Compile**, to view LLVM control flow using the selected
optimization. `opt` produces DOT files; Graphviz renders the first function as
`cfg.svg`. Both the full build and Swift-only preview support this. To inspect
another function, run `dot -Tsvg <file.dot> -o graph.svg` and open `graph.svg` in Explorer.

## Debug Fibonacci

1. Click the bug button and wait for **LLDB ready**. It downloads once per page.
2. Set a breakpoint at line **7** (`let next = previous + current`). Leave
   **Debug target** on **Build current source**, then click Start.
3. Inspect `n = 10`, `index = 2`, `previous = 0`, `current = 1`.
4. Step over to line **8**: `next = 1` is now available. Step through the
   assignments and next iteration to watch the sequence grow.
5. Remove the loop breakpoint before Step out. Step out stops back at line **16**.
   Step over to line **17** to store `answer = 55`, then Continue to see stdout and exit code 0.
6. Stop releases the debug process; Restart creates a new session. Hiding the
   panel leaves the session intact. Pause is available only while running.

**Build current source** uses `-Onone -gdwarf-types -dwarf-version=4`, independently
of the output optimization selector. You can instead choose an existing `.wasm`
under **Debug target**. The panel shows its path; Restart reuses the same program.
Expand struct, array and enum rows in Variables to inspect their fields or
elements. The debug console also accepts member reads such as `point.x` and
`numbers[1]`. Evaluating new Swift code in the paused program, such as `n + 1`
or a function call, requires Wasm JIT support that LLDB does not yet provide.

## Advanced terminal

Use `swift` for version/help and `swiftc` for compilation. SDK paths and runtime
libraries are installed toolchain defaults, just as with a desktop compiler:

```sh
swift --version
swiftc --help
swiftc -dump-ast fibonacci.swift
swiftc -emit-sil fibonacci.swift -o fibonacci.sil
swiftc -emit-ir fibonacci.swift -o fibonacci.ll
swiftc -O -emit-ir fibonacci.swift -o fibonacci-opt.ll
swiftc -S fibonacci.swift -o fibonacci.s
swiftc -c fibonacci.swift -o fibonacci.o
swiftc fibonacci.o -o fibonacci.wasm
swiftc fizzbuzz.swift -o fizzbuzz.wasm
```

The workspace also includes a two-file program: `math.swift` defines Fibonacci
and `main.swift` calls it. Compile both through the advanced terminal:

```sh
swiftc math.swift main.swift -o multi.wasm
```

Select `multi.wasm` and **Load selected .wasm**, then run `__main_argc_argv`.
It prints `Fibonacci(20) = 6765`. For your own programs, use Explorer's **+** to
add supporting files and keep top-level executable code in `main.swift`.
The standalone `fibonacci.swift` and `fizzbuzz.swift` examples each have their
own top-level program; compile them separately.

To debug both files, build full debug information:

```sh
swiftc -g math.swift main.swift -o multi-debug.wasm
```

Set a breakpoint at `main.swift:2`, open the debugger and choose
`multi-debug.wasm` under **Debug target**, then click **Start**. **Step into** opens `math.swift` at
line 2; **Step out** returns to `main.swift`. Step over to line 3 to inspect
`answer = 6765`, then Continue. You can also set a breakpoint at `math.swift:7`
and step over to line 8 to inspect `next = 1`; remove that loop breakpoint
before Step out. Restart keeps the same selected binary.

Click generated files in Explorer to inspect them. Select a `.wasm` file and
**Load selected .wasm** to run it. `swiftc -### fibonacci.swift -o fibonacci.wasm`
prints the underlying jobs. The upstream C++ driver parses advanced arguments,
including `-Xfrontend`, `-Xcc`, `-Xlinker`, multiple inputs and response files.
Raw `swift-frontend` and `wasm-ld` are also available. Commands are argv parsing,
not a shell; `swift file.swift` and SwiftPM are not implemented here.

## REPL

Enter `swift` in the advanced terminal, then submit one line at a time:

```swift
var counter = 1
counter += 1
print(counter)
print("Hello, 🌐!")
func fib(_ n: Int) -> Int {
  if n < 2 { return n }
  return fib(n - 1) + fib(n - 2)
}
print(fib(10))
```

The prompt changes to `…>` for unfinished input. Definitions persist across
cells; `print(counter)` prints `2`, and `print(fib(10))` prints `55`.
`:reset` clears the session; `:quit` returns to tool commands.
**Ctrl+C** in the terminal interrupts a running cell and clears the session.
The REPL module downloads on first use and stays cached for the page.

JavaScriptKit, Foundation, concurrency and macros are not included in this SDK.
See [README.md](README.md) for reproduction and [summary.md](summary.md) for
source patches, threading and current limits.
