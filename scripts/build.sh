#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${EMSCRIPTEN_SYSROOT:-}" ]]; then
  echo "Set EMSCRIPTEN_SYSROOT to the Emscripten SDK sysroot." >&2
  exit 2
fi
if [[ -z "${LLVM_WASM_PREFIX:-}" ]]; then
  echo "Set LLVM_WASM_PREFIX to the emscripten-forge LLVM target prefix." >&2
  exit 2
fi
if [[ -z "${LLVM_SOURCE_TREE:-}" ]]; then
  echo "Set LLVM_SOURCE_TREE to an llvm-project checkout matching the packaged LLVM version." >&2
  exit 2
fi

resource_tree="${CLANG_RESOURCE_TREE:-${LLVM_WASM_PREFIX}/lib/clang/23}"

emcmake cmake -S . -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="${LLVM_WASM_PREFIX}" \
  -DLLVM_DIR="${LLVM_WASM_PREFIX}/lib/cmake/llvm" \
  -DClang_DIR="${LLVM_WASM_PREFIX}/lib/cmake/clang" \
  -DLLD_DIR="${LLVM_WASM_PREFIX}/lib/cmake/lld" \
  -DGraphviz_DIR="${LLVM_WASM_PREFIX}/lib/cmake/Graphviz" \
  -DLLVM_SOURCE_TREE="${LLVM_SOURCE_TREE}" \
  -DEMSCRIPTEN_SYSROOT="${EMSCRIPTEN_SYSROOT}" \
  -DCLANG_RESOURCE_TREE="${resource_tree}"

cmake --build build --parallel

mkdir -p site
cp index.html app.js styles.css tutorials.md tutorial_wasm.md \
  tutorial_aarch64.md tutorial_x86.md site/
cp build/Compiler.js build/Compiler.wasm build/Compiler.data site/
