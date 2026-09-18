#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

"${SCRIPT_DIR}/10-fetch-wamr.sh"
write_em_config

c_flags='-O2 -g0 -fPIC -msimd128 '
c_flags+='-sSUPPORT_LONGJMP=wasm -fwasm-exceptions -pthread'

with_emscripten "${EMCMAKE}" cmake \
  -S "${DEBUGGER_DIR}/wamr" \
  -B "${WAMR_BUILD_DIR}" \
  -G 'Unix Makefiles' \
  -DCMAKE_BUILD_TYPE=Release \
  -DWAMR_ROOT_DIR="${WAMR_SOURCE_DIR}" \
  -DWAMR_BUILD_REF_TYPES=1 \
  -DWAMR_BUILD_CALL_INDIRECT_OVERLONG=1 \
  -DCMAKE_C_FLAGS="${c_flags}"

with_emscripten cmake --build "${WAMR_BUILD_DIR}" \
  --target vmlib --parallel "${JOBS}"

require_file "${WAMR_BUILD_DIR}/libvmlib.a"
note "WAMR archive: ${WAMR_BUILD_DIR}/libvmlib.a"
note "SHA-256: $(sha256_file "${WAMR_BUILD_DIR}/libvmlib.a")"
