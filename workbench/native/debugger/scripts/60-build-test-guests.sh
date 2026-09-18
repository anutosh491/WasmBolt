#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

guest_dir="${WORK_DIR}/guests"
simple_source="${DEBUGGER_DIR}/tests/simple.cpp"
xtensor_source="${DEBUGGER_DIR}/tests/xtensor.cpp"
mkdir -p "${guest_dir}"

guest_flags=(
  -std=c++23
  -g
  -O0
  -mno-reference-types
  -sSTANDALONE_WASM=1
)

with_emscripten "${EMXX}" "${guest_flags[@]}" \
  "-fdebug-prefix-map=${simple_source}=/workspace/simple.cpp" \
  "${simple_source}" \
  -o "${guest_dir}/simple.wasm"
note "simple guest: ${guest_dir}/simple.wasm"

if [[ -n "${XTENSOR_INCLUDE_DIR:-}" ]]; then
  require_file "${XTENSOR_INCLUDE_DIR}/xtensor/containers/xarray.hpp"
  with_emscripten "${EMXX}" "${guest_flags[@]}" \
    -I"${XTENSOR_INCLUDE_DIR}" \
    "-fdebug-prefix-map=${xtensor_source}=/workspace/xtensor.cpp" \
    "${xtensor_source}" \
    -o "${guest_dir}/xtensor.wasm"
  note "xtensor guest: ${guest_dir}/xtensor.wasm"
else
  note 'XTENSOR_INCLUDE_DIR is unset; skipping the phase-2 xtensor guest'
fi
