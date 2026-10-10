#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

# The exported Swift target's dependencies supply the actual LLVM/Clang set.
"${CMAKE}" --build "${WASM_SWIFT_DIR}" --parallel "${JOBS}" \
  --target swiftDriver swiftFrontendTool swiftCompilerModules
"${CMAKE}" --build "${WASM_LLVM_DIR}" --parallel "${JOBS}" \
  --target lldWasm lldCommon

wasm_cmake -S "${PROJECT_DIR}/bridge" -B "${WORK_DIR}/compiler" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_DIR="${WASM_LLVM_DIR}/lib/cmake/llvm" \
  -DClang_DIR="${WASM_LLVM_DIR}/lib/cmake/clang" \
  -DLLD_DIR="${WASM_LLVM_DIR}/lib/cmake/lld" \
  -DSwift_DIR="${WASM_SWIFT_DIR}/lib/cmake/swift" \
  -DSWIFT_SOURCE_DIR="${SWIFT_SOURCE_DIR}" \
  -DSWIFT_HOST_RUNTIME="${WORK_DIR}/stdlib-host-wasm" \
  -DCMAKE_C_FLAGS="${WASM_FLAGS}" -DCMAKE_CXX_FLAGS="${WASM_CXX_FLAGS}"
"${PYTHON}" "${PROJECT_DIR}/scripts/build-llvm-dependencies.py" \
  --ninja "${NINJA}" --cmake "${CMAKE}" --label Swift \
  --consumer "${WORK_DIR}/compiler" --llvm "${WASM_SWIFT_DIR}" \
  --jobs "${JOBS}" wasmbolt-swift
"${CMAKE}" --build "${WORK_DIR}/compiler" --parallel 1
