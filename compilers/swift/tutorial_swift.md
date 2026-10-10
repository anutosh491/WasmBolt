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
In the full WasmBolt build, CFG compiles Swift to LLVM IR, runs `opt` to produce
DOT files and renders one with Graphviz. The Swift-only preview omits these tools.

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
not a shell; `swift file.swift`, the REPL and SwiftPM are not implemented here.

JavaScriptKit, Foundation, concurrency and macros are not included in this SDK.
See [README.md](README.md) for reproduction and [summary.md](summary.md) for
source patches, threading and current limits.
