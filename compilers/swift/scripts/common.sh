#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REPOSITORY_DIR="$(cd -- "${PROJECT_DIR}/../.." && pwd)"
WORK_DIR="${WASMBOLT_SWIFT_WORK_DIR:-${PROJECT_DIR}/.work}"
SWIFT_DEV_DIR="${WASMBOLT_SWIFT_SOURCE_ROOT:-${WORK_DIR}/sources}"
LLVM_SOURCE_DIR="${WASMBOLT_SWIFT_LLVM_SOURCE:-${WORK_DIR}/llvm-project}"
SWIFT_SOURCE_DIR="${SWIFT_DEV_DIR}/swift"
NATIVE_LLVM_DIR="${WORK_DIR}/llvm-native"
WASM_LLVM_DIR="${WORK_DIR}/llvm-wasm"
NATIVE_SWIFT_DIR="${WORK_DIR}/swift-native"
WASM_SWIFT_DIR="${WORK_DIR}/swift-wasm"

EMSCRIPTEN_PACKAGE="${WASMBOLT_EMSCRIPTEN_PACKAGE:-${CONDA_PREFIX:-}}"
EMSDK_ROOT="${WASMBOLT_EMSDK_ROOT:-${EMSDK:-${EMSCRIPTEN_PACKAGE:+${EMSCRIPTEN_PACKAGE}/opt/emsdk}}}"
[[ -d "${EMSDK_ROOT}/upstream/emscripten" ]] || {
  printf '%s\n' 'Set WASMBOLT_EMSDK_ROOT to the Emscripten 6.0.8 opt/emsdk directory.' >&2
  exit 1
}
EMSCRIPTEN_ROOT="${EMSDK_ROOT}/upstream/emscripten"
TOOL_ENV_BIN="${WASMBOLT_TOOL_ENV_BIN:-${CONDA_PREFIX:+${CONDA_PREFIX}/bin}}"
export PATH="${TOOL_ENV_BIN:+${TOOL_ENV_BIN}:}${PATH}"
CMAKE="${WASMBOLT_CMAKE:-$(command -v cmake || true)}"
NINJA="${WASMBOLT_NINJA:-$(command -v ninja || true)}"
PYTHON="${WASMBOLT_PYTHON:-$(command -v python3 || true)}"
NODE="${WASMBOLT_NODE:-$(command -v node || true)}"
for tool in "${CMAKE}" "${NINJA}" "${PYTHON}" "${NODE}"; do
  [[ -x "${tool}" ]] || { printf 'Missing build tool: %s\n' "${tool}" >&2; exit 1; }
done
export EMSDK_PYTHON="${PYTHON}"
JOBS="${WASMBOLT_SWIFT_JOBS:-6}"
export PATH="${TOOL_ENV_BIN:+${TOOL_ENV_BIN}:}${EMSCRIPTEN_ROOT}:$(dirname -- "${NINJA}"):${PATH}"
export EM_CONFIG="${WORK_DIR}/emscripten-config.py"
export EM_LLVM_ROOT="${EMSDK_ROOT}/upstream/bin"
export EM_BINARYEN_ROOT="${EMSDK_ROOT}/upstream"
export EM_CACHE="${WORK_DIR}/em-cache"
mkdir -p "${WORK_DIR}" "${WORK_DIR}/logs" "${WORK_DIR}/em-cache"
config_file="$(mktemp "${WORK_DIR}/.emscripten-config.XXXXXX")"
cat >"${config_file}" <<EOF
NODE_JS = ['${NODE}']
PYTHON = '${PYTHON}'
LLVM_ROOT = '${EMSDK_ROOT}/upstream/bin'
BINARYEN_ROOT = '${EMSDK_ROOT}/upstream'
EMSCRIPTEN_ROOT = '${EMSCRIPTEN_ROOT}'
CACHE = '${WORK_DIR}/em-cache'
EOF
if [[ -f "${EM_CONFIG}" ]] && cmp -s "${config_file}" "${EM_CONFIG}"; then
  rm -- "${config_file}"
else
  mv -- "${config_file}" "${EM_CONFIG}"
fi

WASM_FLAGS='-pthread -fwasm-exceptions -mtail-call'
WASM_CXX_FLAGS="${WASM_FLAGS} -Dwait4=__syscall_wait4"
wasm_cmake() {
  "${EMSCRIPTEN_ROOT}/emcmake" "${CMAKE}" "$@"
}
