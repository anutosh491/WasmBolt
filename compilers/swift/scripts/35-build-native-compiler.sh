#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

"${PYTHON}" "${PROJECT_DIR}/scripts/build-llvm-dependencies.py" \
  --ninja "${NINJA}" --cmake "${CMAKE}" \
  --consumer "${NATIVE_SWIFT_DIR}" --llvm "${NATIVE_LLVM_DIR}" \
  --jobs "${JOBS}" swift-frontend
"${CMAKE}" --build "${NATIVE_SWIFT_DIR}" --parallel "${JOBS}" \
  --target swift-frontend swift-compatibility-symbols
