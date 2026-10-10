#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

mode="${1:-wasm}"
args=(-S "${SWIFT_DEV_DIR}/cmark" -B "${WORK_DIR}/cmark-${mode}" -G Ninja
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release
  -DCMARK_TESTS=OFF -DCMARK_SHARED=OFF -DCMARK_STATIC=ON)
if [[ "${mode}" == wasm ]]; then
  wasm_cmake "${args[@]}" -DCMAKE_C_FLAGS="${WASM_FLAGS}"
elif [[ "${mode}" == native ]]; then
  "${CMAKE}" "${args[@]}" -DCMAKE_C_COMPILER="$(xcrun -f clang)"
else
  printf 'Expected native or wasm, got %s\n' "${mode}" >&2
  exit 1
fi
"${CMAKE}" --build "${WORK_DIR}/cmark-${mode}" --parallel "${JOBS}"
