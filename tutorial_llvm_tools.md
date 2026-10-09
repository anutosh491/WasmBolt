# LLVM tools in WasmBolt

Select **C++23**, press **Reset**, and open **Advanced terminal**. Run each
command separately. Keep the page open so generated files remain available.

## 1. Create an object with debug information

```bash
clang++ --target=wasm32-unknown-emscripten -g -c /workspace/snippet.cpp -o /workspace/tools-demo.o
```

## 2. Inspect the object

`llvm-readobj` shows the Wasm header and sections, including `.debug_info`:

```bash
llvm-readobj --file-headers --sections /workspace/tools-demo.o
```

`llvm-nm` lists defined symbols, including `_Z13sum_invariantii`:

```bash
llvm-nm --defined-only /workspace/tools-demo.o
```

`llvm-size` reports section sizes:

```bash
llvm-size /workspace/tools-demo.o
```

`llvm-objdump` disassembles the function:

```bash
llvm-objdump -d /workspace/tools-demo.o
```

`llvm-cxxfilt` turns its C++ symbol into `sum_invariant(int, int)`:

```bash
llvm-cxxfilt _Z13sum_invariantii
```

## 3. Create and inspect an archive

```bash
llvm-ar rcs /workspace/tools-demo.a /workspace/tools-demo.o
```

```bash
llvm-ar t /workspace/tools-demo.a
```

The archive listing contains `tools-demo.o`. `llvm-ranlib` rebuilds its index:

```bash
llvm-ranlib /workspace/tools-demo.a
```

## 4. Copy an object and remove debug sections

```bash
llvm-objcopy /workspace/tools-demo.o /workspace/tools-demo-copy.o
```

```bash
llvm-strip --strip-debug /workspace/tools-demo-copy.o
```

```bash
llvm-readobj --sections /workspace/tools-demo-copy.o
```

The copy no longer has `.debug_info`; the original still does. Generated
objects and archives appear in **Files** and can be downloaded. Inspection
output appears in **Analysis** and the terminal.
