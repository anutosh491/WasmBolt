#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

guest_dir="${WORK_DIR}/guests"
simple_c_source="${DEBUGGER_DIR}/tests/simple.c"
simple_source="${DEBUGGER_DIR}/tests/simple.cpp"
iostream_source="${DEBUGGER_DIR}/tests/iostream.cpp"
json_source="${DEBUGGER_DIR}/tests/json.cpp"
pause_source="${DEBUGGER_DIR}/tests/pause.cpp"
ir_source="${DEBUGGER_DIR}/tests/debug.ll"
ir_main_source="${DEBUGGER_DIR}/tests/debug-main.c"
xtl_source="${DEBUGGER_DIR}/tests/xtl.cpp"
xtensor_source="${DEBUGGER_DIR}/tests/xtensor.cpp"
mkdir -p "${guest_dir}"

guest_flags=(
  -g
  -O0
  -mno-reference-types
  -sSTANDALONE_WASM=1
)

cpp_guest_flags=(-std=c++23 "${guest_flags[@]}")

with_emscripten "${EMCC}" "${guest_flags[@]}" \
  "-fdebug-prefix-map=${simple_c_source}=/workspace/simple.c" \
  "${simple_c_source}" \
  -o "${guest_dir}/simple-c.wasm"
note "simple C guest: ${guest_dir}/simple-c.wasm"

with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
  "-fdebug-prefix-map=${simple_source}=/workspace/simple.cpp" \
  "${simple_source}" \
  -o "${guest_dir}/simple.wasm"
note "simple guest: ${guest_dir}/simple.wasm"

with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
  "-fdebug-prefix-map=${iostream_source}=/workspace/iostream.cpp" \
  "${iostream_source}" \
  -o "${guest_dir}/iostream.wasm"
note "iostream guest: ${guest_dir}/iostream.wasm"

with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
  "-fdebug-prefix-map=${pause_source}=/workspace/pause.cpp" \
  "${pause_source}" \
  -o "${guest_dir}/pause.wasm"
note "pause guest: ${guest_dir}/pause.wasm"

with_emscripten "${EMCC}" "${guest_flags[@]}" \
  "${ir_source}" "${ir_main_source}" \
  -o "${guest_dir}/debug-ir.wasm"
note "LLVM IR guest: ${guest_dir}/debug-ir.wasm"

if [[ -n "${XTL_INCLUDE_DIR:-${XTENSOR_INCLUDE_DIR:-}}" ]]; then
  xtl_include_dir="${XTL_INCLUDE_DIR:-${XTENSOR_INCLUDE_DIR}}"
  require_file "${xtl_include_dir}/xtl/xoptional.hpp"
  with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
    -I"${xtl_include_dir}" \
    "-fdebug-prefix-map=${xtl_source}=/workspace/xtl.cpp" \
    "${xtl_source}" \
    -o "${guest_dir}/xtl.wasm"
  note "xtl guest: ${guest_dir}/xtl.wasm"
else
  note 'XTL_INCLUDE_DIR and XTENSOR_INCLUDE_DIR are unset; skipping xtl'
fi

if [[ -n "${XTENSOR_INCLUDE_DIR:-}" ]]; then
  require_file "${XTENSOR_INCLUDE_DIR}/xtensor/containers/xarray.hpp"
  with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
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
  with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
    -I"${NLOHMANN_JSON_INCLUDE_DIR}" \
    "-fdebug-prefix-map=${json_source}=/workspace/json.cpp" \
    "${json_source}" \
    -o "${guest_dir}/json.wasm"
  note "nlohmann_json guest: ${guest_dir}/json.wasm"
  with_emscripten "${EMXX}" "${cpp_guest_flags[@]}" \
    -I"${NLOHMANN_JSON_INCLUDE_DIR}" \
    "-fdebug-prefix-map=${json_source}=/workspace/nlohmann_json.cpp" \
    "${json_source}" \
    -o "${guest_dir}/nlohmann_json.wasm"
  note "playground nlohmann_json guest: ${guest_dir}/nlohmann_json.wasm"
else
  note 'NLOHMANN_JSON_INCLUDE_DIR is unset; skipping the JSON guest'
fi
