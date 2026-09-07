# MLIR in WasmBolt

Choose **MLIR** from the language menu. The editor starts with a tensor-based
`linalg.matmul`. **Compile** runs a small canonicalization and CSE pipeline.
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

## 3. Lower Linalg to loops

```bash
mlir-opt --pass-pipeline='builtin.module(convert-linalg-to-loops,canonicalize,cse)' /workspace/bufferized.mlir -o /workspace/loops.mlir
```

This exposes the loop nests, loads, stores and scalar arithmetic implementing
the matrix multiplication.

## 4. Lower to the LLVM dialect

```bash
mlir-opt --pass-pipeline='builtin.module(lower-affine,convert-scf-to-cf,convert-to-llvm,reconcile-unrealized-casts)' /workspace/loops.mlir -o /workspace/llvm-dialect.mlir
```

Open `llvm-dialect.mlir` to inspect the final LLVM-dialect functions,
descriptors, branches, loads, stores and arithmetic. Every command above is
parsed and executed by MLIR's `MlirOptMain` driver inside the browser; WasmBolt
does not map pass names itself.

## 5. Generate and render an MLIR operation graph

MLIR's `view-op-graph` pass writes Graphviz DOT to standard error. The advanced
terminal supports ordinary `2>` redirection into the browser filesystem:

```bash
mlir-opt --view-op-graph /workspace/optimized.mlir -o /workspace/unchanged.mlir 2> /workspace/mlir-dataflow.dot
```

To focus on control-flow edges after lowering Linalg to loops:

```bash
mlir-opt --view-op-graph='print-data-flow-edges=false print-control-flow-edges=true' /workspace/loops.mlir -o /workspace/unchanged.mlir 2> /workspace/mlir-cfg.dot
```

Render either graph to SVG with the in-process Graphviz driver:

```bash
dot -Tsvg /workspace/mlir-cfg.dot -o /workspace/mlir-cfg.svg
```

WasmBolt opens the resulting SVG in the CFG viewer. Both graph generation and
rendering happen locally in the browser.
