# WasmBolt tutorial: x86-64

This tutorial generates x86-64 artifacts inside the browser. It does not link
or execute them. The example is freestanding because the current environment
does not contain an x86-64 Linux sysroot.

Select **C++23**, press **Reset**, and run each command separately.

## C++ frontend and optimizer

```bash
clang++ --target=x86_64-unknown-linux-gnu -std=c++23 -O0 -Xclang -disable-O0-optnone -S -emit-llvm /workspace/snippet.cpp -o /workspace/x86-input.ll
```

```bash
opt -S -passes=mem2reg,loop-mssa(licm) /workspace/x86-input.ll -o /workspace/x86-optimized.ll
```

```bash
opt -passes=dot-cfg -disable-output /workspace/x86-optimized.ll
```

```bash
dot -Tsvg /workspace/._Z13sum_invariantii.dot -o /workspace/x86-cfg.svg
```

## Instruction selection and scheduling

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -stop-after=finalize-isel /workspace/x86-optimized.ll -o /workspace/x86-selected.mir
```

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -stop-after=machine-scheduler /workspace/x86-optimized.ll -o /workspace/x86-scheduled.mir
```

## Assembly and object code

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -filetype=asm /workspace/x86-optimized.ll -o /workspace/x86.s
```

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -filetype=obj /workspace/x86-optimized.ll -o /workspace/x86.o
```

## Standalone LLVM IR

Refresh, select **LLVM IR**, press **Reset**, and run:

```bash
opt -S -passes=default<O2> /workspace/input.ll -o /workspace/optimized.ll
```

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -stop-after=finalize-isel /workspace/optimized.ll -o /workspace/x86-selected.mir
```

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -stop-after=machine-scheduler /workspace/optimized.ll -o /workspace/x86-scheduled.mir
```

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -filetype=asm /workspace/optimized.ll -o /workspace/x86.s
```

```bash
llc -mtriple=x86_64-unknown-linux-gnu -O2 -filetype=obj /workspace/optimized.ll -o /workspace/x86.o
```

The generated `.s`, `.mir`, and `.o` files can be inspected or downloaded, but
the browser cannot execute the x86-64 object.
