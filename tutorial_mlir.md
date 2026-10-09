# MLIR in WasmBolt

Choose **MLIR** from the language menu. The editor starts with a tensor-based
`linalg.matmul`. **Compile** runs a small canonicalization and CSE pipeline.
Select **CFG**, then press **Compile** to render the MLIR operation graph with
control-flow edges. Its DOT and SVG files also appear in **Files**.
The advanced terminal exposes the genuine `mlir-opt` command line for explicit
experimentation.

## 1. Canonicalize and eliminate common subexpressions

```bash
mlir-opt --pass-pipeline=builtin.module(canonicalize,cse) /workspace/input.mlir -o /workspace/optimized.mlir
```

Open `optimized.mlir` from **Files**.

## 2. Bufferize tensors into explicit memory

```bash
mlir-opt --pass-pipeline='builtin.module(one-shot-bufferize{bufferize-function-boundaries})' /workspace/optimized.mlir -o /workspace/bufferized.mlir
```

The resulting function uses MemRef values and explicit allocation rather than
returning an abstract tensor value.

## 3. Lower Linalg to Affine loops

```bash
mlir-opt --pass-pipeline='builtin.module(convert-linalg-to-affine-loops,canonicalize,cse)' /workspace/bufferized.mlir -o /workspace/affine.mlir
```

Inspect `affine.mlir` for `affine.for`, loads/stores and scalar arithmetic.

## 4. Lower Affine to SCF

```bash
mlir-opt --pass-pipeline='builtin.module(lower-affine,canonicalize,cse)' /workspace/affine.mlir -o /workspace/loops.mlir
```

Inspect `loops.mlir` for `scf.for`, `memref.load`/`memref.store` and `arith` ops.

## 5. Lower SCF to CF

```bash
mlir-opt --pass-pipeline='builtin.module(convert-scf-to-cf,canonicalize,cse)' /workspace/loops.mlir -o /workspace/cf.mlir
```

Inspect `cf.mlir` for basic blocks and `cf.br`/`cf.cond_br`. Arithmetic and
memory operations remain until the LLVM conversion.

## 6. Lower to the LLVM dialect

```bash
mlir-opt --pass-pipeline='builtin.module(convert-to-llvm,reconcile-unrealized-casts)' /workspace/cf.mlir -o /workspace/llvm-dialect.mlir
```

Open `llvm-dialect.mlir` to inspect the final LLVM-dialect functions,
descriptors, branches, loads, stores and arithmetic. Every command above is
parsed and executed by MLIR's `MlirOptMain` driver inside the browser; WasmBolt
does not map pass names itself.

## 7. Translate the LLVM dialect to LLVM IR

```bash
mlir-translate --mlir-to-llvmir /workspace/llvm-dialect.mlir -o /workspace/mlir-output.ll
```

```bash
llc -mtriple=wasm32-unknown-emscripten -filetype=asm /workspace/mlir-output.ll -o /workspace/mlir-output.s
```

On a wasm64 deployment, use `wasm64-unknown-emscripten` as the target.
The LLVM IR and assembly appear in Files.

## 8. Generate and render an MLIR operation graph

MLIR's `view-op-graph` pass writes Graphviz DOT to standard error. The advanced
terminal supports ordinary `2>` redirection into the browser filesystem:

```bash
mlir-opt --view-op-graph /workspace/optimized.mlir -o /workspace/unchanged.mlir 2> /workspace/mlir-dataflow.dot
```

To focus on control-flow edges after lowering Linalg to loops:

```bash
mlir-opt --view-op-graph='print-data-flow-edges=false print-control-flow-edges=true' /workspace/loops.mlir -o /workspace/unchanged.mlir 2> /workspace/mlir-cfg.dot
```

Render either graph to SVG with the packaged Graphviz tool:

```bash
dot -Tsvg /workspace/mlir-cfg.dot -o /workspace/mlir-cfg.svg
```

WasmBolt opens the resulting SVG in the CFG viewer. Both graph generation and
rendering happen locally in the browser.
