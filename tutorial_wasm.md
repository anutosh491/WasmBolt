# WasmBolt tutorial: WebAssembly

These tutorials run the toolchain manually from **Advanced terminal**. Run one
command at a time. A command that writes a file automatically selects that file
in the browser filesystem. Do not refresh until the current pipeline is
complete because `/workspace` belongs to the current browser session.

## 1. C++ to WebAssembly

Select **C++23**, press **Reset**, and keep the resulting `snippet.cpp`.

### Inspect the Clang AST

```bash
clang++ --target=wasm32-unknown-emscripten -std=c++23 -fsyntax-only -Xclang -ast-dump /workspace/snippet.cpp
```

### Emit LLVM IR

`-disable-O0-optnone` leaves the function available to the explicit optimizer
pipeline used in the next command.

```bash
clang++ --target=wasm32-unknown-emscripten -std=c++23 -O0 -Xclang -disable-O0-optnone -S -emit-llvm /workspace/snippet.cpp -o /workspace/cpp-input.ll
```

### Optimize the IR

```bash
opt -S -passes=mem2reg,loop-mssa(licm) /workspace/cpp-input.ll -o /workspace/cpp-optimized.ll
```

### Generate and render the CFG

```bash
opt -passes=dot-cfg -disable-output /workspace/cpp-optimized.ll
```

```bash
dot -Tsvg /workspace/._Z13sum_invariantii.dot -o /workspace/cpp-cfg.svg
```

### Inspect MIR after instruction selection

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -stop-after=finalize-isel /workspace/cpp-optimized.ll -o /workspace/cpp-selected.mir
```

### Inspect WebAssembly register stackification

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -stop-after=wasm-reg-stackify /workspace/cpp-optimized.ll -o /workspace/cpp-stackified.mir
```

### Emit readable WebAssembly assembly

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -filetype=asm /workspace/cpp-optimized.ll -o /workspace/cpp-output.s
```

### Emit and link the WebAssembly module

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -filetype=obj -relocation-model=pic /workspace/cpp-optimized.ll -o /workspace/cpp-output.o
```

```bash
wasm-ld -shared --import-memory --experimental-pic --unresolved-symbols=import-dynamic --export-all --export=__wasm_call_ctors --export-if-defined=__wasm_apply_data_relocs --no-gc-sections /workspace/cpp-output.o -o /workspace/cpp-output.wasm
```

Select `cpp-output.wasm`, choose **Load selected .wasm**, and execute
`sum_invariant` with arguments `5` and `4`. The expected result is `60`.

## 2. LLVM IR to WebAssembly

Refresh, select **LLVM IR**, and press **Reset**. The independent source is
available as `/workspace/input.ll`. This workflow starts after the Clang AST
and frontend stages.

### Verify and optimize

```bash
opt -S -passes=verify /workspace/input.ll -o /workspace/llvm-verified.ll
```

```bash
opt -S -passes=default<O2> /workspace/llvm-verified.ll -o /workspace/llvm-optimized.ll
```

### Generate and render the CFG

```bash
opt -passes=dot-cfg -disable-output /workspace/llvm-optimized.ll
```

```bash
dot -Tsvg /workspace/.absolute_difference.dot -o /workspace/llvm-cfg.svg
```

### Inspect instruction selection and stackification

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -stop-after=finalize-isel /workspace/llvm-optimized.ll -o /workspace/llvm-selected.mir
```

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -stop-after=wasm-reg-stackify /workspace/llvm-optimized.ll -o /workspace/llvm-stackified.mir
```

### Emit assembly, object code, and the linked module

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -filetype=asm /workspace/llvm-optimized.ll -o /workspace/llvm-output.s
```

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -filetype=obj -relocation-model=pic /workspace/llvm-optimized.ll -o /workspace/llvm-output.o
```

```bash
wasm-ld -shared --import-memory --experimental-pic --unresolved-symbols=import-dynamic --export-all --export=__wasm_call_ctors --export-if-defined=__wasm_apply_data_relocs --no-gc-sections /workspace/llvm-output.o -o /workspace/llvm-output.wasm
```

Load `llvm-output.wasm` and execute `absolute_difference(5, 4)`. The expected
result is `1`.

## 3. Boost.cpp to WebAssembly

First add `boost-cpp` to `environment-wasm-host.yml` and rebuild WasmBolt.

Select **C++23** and replace the editor with:

```cpp
#include <boost/math/constants/constants.hpp>

double boost_pi() {
  return boost::math::constants::pi<double>();
}
```

The compatibility include is required because raw `clang++` is being invoked
directly rather than through Emscripten's `em++` wrapper.

### Emit LLVM IR

```bash
clang++ --target=wasm32-unknown-emscripten -std=c++23 -O2 -fPIC -fwasm-exceptions -Xclang -iwithsysroot/include/compat -S -emit-llvm /workspace/snippet.cpp -o /workspace/boost.ll
```

### Emit the object and link the module

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -filetype=obj -relocation-model=pic /workspace/boost.ll -o /workspace/boost.o
```

```bash
wasm-ld -shared --import-memory --experimental-pic --unresolved-symbols=import-dynamic --export-all --export=__wasm_call_ctors --export-if-defined=__wasm_apply_data_relocs --no-gc-sections /workspace/boost.o -o /workspace/boost.wasm
```

Load `boost.wasm` and execute the discovered `f64()` export. The expected
result is π: approximately `3.141592653589793`.

## 4. SymEngine expansion and LaTeX output

First add `symengine` to `environment-wasm-host.yml` and rebuild WasmBolt.

Refresh, select **C++23**, and replace the editor with:

```cpp
#include <iostream>
#include <symengine/expression.h>
#include <symengine/printers.h>

int print_expanded_latex(int n) {
  using namespace SymEngine;

  Expression x("x");
  Expression expression = expand(pow(x + Expression(n), 2));
  std::cout << latex(*expression.get_basic()) << '\n';
  return 0;
}
```

For `n = 3`, this prints the LaTeX representation of the expanded expression
`x² + 6x + 9` instead of returning an artificial string length.

### Emit LLVM IR

```bash
clang++ --target=wasm32-unknown-emscripten -std=c++23 -O2 -fPIC -fwasm-exceptions -Xclang -iwithsysroot/include/compat -S -emit-llvm /workspace/snippet.cpp -o /workspace/symengine.ll
```

### Emit the object and link with SymEngine

```bash
llc -mtriple=wasm32-unknown-emscripten -O2 -filetype=obj -relocation-model=pic /workspace/symengine.ll -o /workspace/symengine.o
```

```bash
wasm-ld -shared --import-memory --experimental-pic --unresolved-symbols=import-dynamic --export-all --export=__wasm_call_ctors --export-if-defined=__wasm_apply_data_relocs --no-gc-sections -L/lib -lsymengine /workspace/symengine.o -o /workspace/symengine.wasm
```

Load `symengine.wasm`, select the detected `i32(i32)` export, and run it with
argument `3`. The function returns `0`; its meaningful result—the expanded
LaTeX expression—is printed in the Advanced terminal.
