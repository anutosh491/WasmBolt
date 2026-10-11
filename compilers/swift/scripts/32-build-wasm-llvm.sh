#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

"${PYTHON}" "${PROJECT_DIR}/scripts/build-llvm-dependencies.py" \
  --ninja "${NINJA}" --cmake "${CMAKE}" \
  --consumer "${NATIVE_SWIFT_DIR}" --graph-llvm "${NATIVE_LLVM_DIR}" \
  --llvm "${WASM_LLVM_DIR}" --jobs "${JOBS}" swift-frontend
"${CMAKE}" --build "${WASM_LLVM_DIR}" --parallel "${JOBS}" \
  --target lldWasm lldCommon clang-resource-headers
