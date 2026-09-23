#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

guest_dir="${WORK_DIR}/guests"
simple_source="${DEBUGGER_DIR}/tests/simple.cpp"
iostream_source="${DEBUGGER_DIR}/tests/iostream.cpp"
json_source="${DEBUGGER_DIR}/tests/json.cpp"
pause_source="${DEBUGGER_DIR}/tests/pause.cpp"
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

with_emscripten "${EMXX}" "${guest_flags[@]}" \
  "-fdebug-prefix-map=${iostream_source}=/workspace/iostream.cpp" \
  "${iostream_source}" \
  -o "${guest_dir}/iostream.wasm"
note "iostream guest: ${guest_dir}/iostream.wasm"

with_emscripten "${EMXX}" "${guest_flags[@]}" \
  "-fdebug-prefix-map=${pause_source}=/workspace/pause.cpp" \
  "${pause_source}" \
  -o "${guest_dir}/pause.wasm"
note "pause guest: ${guest_dir}/pause.wasm"

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

if [[ -n "${NLOHMANN_JSON_INCLUDE_DIR:-}" ]]; then
  require_file "${NLOHMANN_JSON_INCLUDE_DIR}/nlohmann/json.hpp"
  with_emscripten "${EMXX}" "${guest_flags[@]}" \
    -I"${NLOHMANN_JSON_INCLUDE_DIR}" \
    "-fdebug-prefix-map=${json_source}=/workspace/json.cpp" \
    "${json_source}" \
    -o "${guest_dir}/json.wasm"
  note "nlohmann_json guest: ${guest_dir}/json.wasm"
else
  note 'NLOHMANN_JSON_INCLUDE_DIR is unset; skipping the JSON guest'
fi
