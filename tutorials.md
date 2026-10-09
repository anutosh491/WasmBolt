# WasmBolt tutorials

Choose the tutorial's language, press **Reset**, and open **Advanced terminal**.
Run one command at a time. Generated files appear in **Files**; inspection
output appears in **Analysis** and the terminal.

- [MLIR](tutorial_mlir.md): optimize a Linalg/Tensor program, bufferize it,
  lower through loops and control flow, translate the LLVM dialect to LLVM IR, and render operation graphs.
- [WebAssembly](tutorial_wasm.md): C++, LLVM IR, Boost.cpp, SymEngine,
  optimization, code generation, linking, loading, and execution.
- [LLVM tools](tutorial_llvm_tools.md): inspect symbols, sections, sizes and
  disassembly; create archives; copy and strip objects.
- [AArch64](tutorial_aarch64.md): freestanding C++ and LLVM IR through
  optimization, instruction selection, scheduling, assembly, and object code.
- [x86-64](tutorial_x86.md): freestanding C++ and LLVM IR through optimization,
  instruction selection, scheduling, assembly, and object code.

The minimal template contains Emscripten's libc++. For the optional Boost.cpp
or SymEngine sections, uncomment the corresponding example dependency in
`environment-wasm-host.yml` before building the deployment. Those packages
target WebAssembly and must not be treated as an AArch64 or x86-64 sysroot.

The native-target tutorials therefore use freestanding code with no platform
library dependencies. A valid hosted C++ program for another target requires a
matching target sysroot; a valid third-party-library object also requires
headers, configuration, and libraries built for that same target ABI.
