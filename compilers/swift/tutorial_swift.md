# Swift in WasmBolt

Open `fibonacci.swift` or `fizzbuzz.swift` in Explorer. Select **Swift** and
**WebAssembly 32**. Fibonacci prints `Fibonacci(10) = 55`; FizzBuzz prints
`Hello, 🌐!` and the sequence through 20. Everything runs in your browser.

Select AST, SIL, LLVM IR, Optimized IR or Assembly, then **Compile**.
**LLVM IR** uses `-Onone`; Optimized IR uses the selected optimization.
Swift exposes `Onone`, `O` and `Osize`. Assembly is WebAssembly assembler syntax.
**Compile & Run** compiles and links with one `swiftc` command, then executes
its Wasm entry point. The terminal shows the same short `swiftc` commands you can run yourself.
Generated `.sil`, `.ll`, `.s`, `.o` and `.wasm` files appear in Explorer;
click a file to inspect or download it. The compiler/linker stay loaded.
Select **CFG**, then **Compile**, to view LLVM control flow using the selected
optimization. `opt` produces DOT files; Graphviz renders the first function as
`cfg.svg`. Both the full build and Swift-only preview support this. To inspect
another function, run `dot -Tsvg <file.dot> -o graph.svg` and open `graph.svg` in Explorer.

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

Click generated files in Explorer to inspect them. Select a `.wasm` file and
**Load selected .wasm** to run it. `swiftc -### fibonacci.swift -o fibonacci.wasm`
prints the underlying jobs. The upstream C++ driver parses advanced arguments,
including `-Xfrontend`, `-Xcc`, `-Xlinker`, multiple inputs and response files.
Raw `swift-frontend` and `wasm-ld` are also available. Commands are argv parsing,
not a shell; `swift file.swift` and SwiftPM are not implemented here.

## Foundation and concurrency

`dates.swift` formats dates with ICU. Use **Compile & Run**, or
`swiftc dates.swift -o dates.wasm`. It also prints the current time.

`json.swift` uses `FoundationEssentials` to encode and decode a meeting with
`Codable`. Compile each example separately.

`concurrency.swift` uses an actor and a task group to sum squares, printing `55`.
Tasks run cooperatively on one guest thread.

Foundation is included in the demo's compiler SDK, rather than built on each
page load. FoundationNetworking and OS services such as spawning processes are
outside this browser build.

