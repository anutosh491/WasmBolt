# WasmBolt tutorials

- [WebAssembly](tutorial_wasm.md): C++, LLVM IR, Boost.cpp, SymEngine,
  optimization, code generation, linking, loading, and execution.
- [AArch64](tutorial_aarch64.md): freestanding C++ and LLVM IR through
  optimization, instruction selection, scheduling, assembly, and object code.
- [x86-64](tutorial_x86.md): freestanding C++ and LLVM IR through optimization,
  instruction selection, scheduling, assembly, and object code.

The minimal template contains Emscripten's libc++. The optional Boost.cpp and
SymEngine sections require adding `boost-cpp` and `symengine` to
`environment-wasm-host.yml` before building the deployment. Those packages
target WebAssembly and must not be treated as an AArch64 or x86-64 sysroot.

The native-target tutorials therefore use freestanding code with no platform
library dependencies. A valid hosted C++ program for another target requires a
matching target sysroot; a valid third-party-library object also requires
headers, configuration, and libraries built for that same target ABI.
