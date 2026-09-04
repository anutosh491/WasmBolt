# WasmBolt tutorial: AArch64

This tutorial generates AArch64 artifacts inside the browser. It does not link
or execute them. The example is freestanding because the current environment
does not contain an AArch64 Linux sysroot.

Select **C++23**, press **Reset**, and run each command separately.

## C++ frontend and optimizer

```bash
clang++ --target=aarch64-unknown-linux-gnu -std=c++23 -O0 -Xclang -disable-O0-optnone -S -emit-llvm /workspace/snippet.cpp -o /workspace/aarch64-input.ll
```

```bash
opt -S -passes=mem2reg,loop-mssa(licm) /workspace/aarch64-input.ll -o /workspace/aarch64-optimized.ll
```

```bash
opt -passes=dot-cfg -disable-output /workspace/aarch64-optimized.ll
```

```bash
dot -Tsvg /workspace/._Z13sum_invariantii.dot -o /workspace/aarch64-cfg.svg
```

## Instruction selection and scheduling

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -stop-after=finalize-isel /workspace/aarch64-optimized.ll -o /workspace/aarch64-selected.mir
```

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -stop-after=machine-scheduler /workspace/aarch64-optimized.ll -o /workspace/aarch64-scheduled.mir
```

## Assembly and object code

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -filetype=asm /workspace/aarch64-optimized.ll -o /workspace/aarch64.s
```

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -filetype=obj /workspace/aarch64-optimized.ll -o /workspace/aarch64.o
```

## Standalone LLVM IR

Refresh, select **LLVM IR**, press **Reset**, and run:

```bash
opt -S -passes=default<O2> /workspace/input.ll -o /workspace/optimized.ll
```

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -stop-after=finalize-isel /workspace/optimized.ll -o /workspace/aarch64-selected.mir
```

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -stop-after=machine-scheduler /workspace/optimized.ll -o /workspace/aarch64-scheduled.mir
```

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -filetype=asm /workspace/optimized.ll -o /workspace/aarch64.s
```

```bash
llc -mtriple=aarch64-unknown-linux-gnu -O2 -filetype=obj /workspace/optimized.ll -o /workspace/aarch64.o
```

The generated `.s`, `.mir`, and `.o` files can be inspected or downloaded, but
the browser cannot execute the AArch64 object.
