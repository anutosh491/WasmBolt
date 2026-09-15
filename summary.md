# WasmBolt execution boundaries

WasmBolt does not require every LLVM tool to share one WebAssembly instance.
The current design chooses the boundary according to how a tool is used:

```text
WasmBolt UI
├── persistent compiler runtime
│   └── Clang, opt/llc pipelines, Graphviz, LLD and loaded side modules
└── disposable utility Worker
    └── LLVM multicall driver
        ├── llvm-readobj
        ├── llvm-nm
        ├── llvm-size
        └── llvm-cxxfilt
```

The persistent runtime is useful for nested compilation and linking, shared
compiler state, and generated files that feed later stages. Stateless binary
inspection utilities instead receive copies of the current workspace files,
write their output back to the terminal, and terminate with their Worker.

The first browser experiment used the `llvm-driver` package from the
`emscripten-forge-4x-experimental` channel. Its WebAssembly module is 6.7 MB.
In a local clean Chrome profile the first Worker completed in about 48 ms;
subsequent fresh Workers completed in about 22–35 ms. All four utilities were
also exercised after WasmBolt compiled a C++ snippet into a real Wasm object.

This result means the binary inspection utilities do not currently justify
new reusable driver libraries in upstream LLVM. The existing multicall driver
plus a Worker provides the required isolation without native `fork`/`exec`.
