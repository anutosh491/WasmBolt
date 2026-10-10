#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
DEBUGGER_DIR="$({ cd -- "${SCRIPT_DIR}/.." && pwd; })"
REPOSITORY_DIR="$({ cd -- "${DEBUGGER_DIR}/../.." && pwd; })"

# shellcheck source=versions.sh
source "${SCRIPT_DIR}/versions.sh"

WORK_DIR="${WASMBOLT_DEBUGGER_WORK_DIR:-${DEBUGGER_DIR}/.work}"
INPUT_DIR="${WASMBOLT_DEBUGGER_INPUT_DIR:-${WORK_DIR}}"
CACHE_DIR="${WORK_DIR}/cache"
WAMR_SOURCE_DIR="${INPUT_DIR}/wamr-${WAMR_REVISION}"
WAMR_BUILD_DIR="${INPUT_DIR}/wamr-build"
LLVM_BUILD_DIR="${INPUT_DIR}/llvm-lldb-build"
LLVM_NATIVE_BUILD_DIR="${INPUT_DIR}/llvm-native-tools"
BRIDGE_BUILD_DIR="${WORK_DIR}/bridge"
OUTPUT_DIR="${WORK_DIR}/output"
EM_CACHE_DIR="${WORK_DIR}/em-cache"
EM_CONFIG_FILE="${WORK_DIR}/emscripten-config.py"

LLVM_PROJECT_ROOT="${LLVM_PROJECT_ROOT:-${INPUT_DIR}/llvm-project}"

# Explicit SDK or activated conda environment; no developer-specific paths.
EMSCRIPTEN_PACKAGE="${WASMBOLT_EMSCRIPTEN_PACKAGE:-${CONDA_PREFIX:-}}"
EMSDK_ROOT="${WASMBOLT_EMSDK_ROOT:-${EMSDK:-${EMSCRIPTEN_PACKAGE:+${EMSCRIPTEN_PACKAGE}/opt/emsdk}}}"
[[ -d "${EMSDK_ROOT}/upstream/emscripten" ]] || {
  printf '%s\n' 'Set WASMBOLT_EMSDK_ROOT to the Emscripten 6.0.8 opt/emsdk directory.' >&2
  exit 1
}
EMSCRIPTEN_ROOT="${EMSDK_ROOT}/upstream/emscripten"
EMSCRIPTEN_BIN="${EMSDK_ROOT}/upstream/bin"
EMXX="${EMSCRIPTEN_ROOT}/em++"
EMCC="${EMSCRIPTEN_ROOT}/emcc"
EMCMAKE="${EMSCRIPTEN_ROOT}/emcmake"
TOOL_ENV_BIN="${WASMBOLT_TOOL_ENV_BIN:-${CONDA_PREFIX:+${CONDA_PREFIX}/bin}}"
export PATH="${TOOL_ENV_BIN:+${TOOL_ENV_BIN}:}${PATH}"
NODE_JS="${WASMBOLT_NODE:-$(command -v node || true)}"
PYTHON="${WASMBOLT_PYTHON:-$(command -v python3 || true)}"
CMAKE="${WASMBOLT_CMAKE:-$(command -v cmake || true)}"

JOBS="${WASMBOLT_BUILD_JOBS:-2}"

note() {
  printf '%s\n' "[debugger] $*"
}

die() {
  printf '%s\n' "[debugger] error: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || die "required file is missing: $1"
}

require_executable() {
  [[ -x "$1" ]] || die "required executable is missing: $1"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die 'neither shasum nor sha256sum is available'
  fi
}

verify_sha256() {
  local path="$1"
  local expected="$2"
  local actual

  actual="$(sha256_file "${path}")"
  [[ "${actual}" == "${expected}" ]] || {
    die "SHA-256 mismatch for ${path}: ${actual}"
  }
}

write_em_config() {
  mkdir -p "${WORK_DIR}" "${EM_CACHE_DIR}"
  require_executable "${NODE_JS}"
  require_executable "${PYTHON}"
  require_executable "${EMXX}"

  cat >"${EM_CONFIG_FILE}" <<EOF
NODE_JS = ['${NODE_JS}']
PYTHON = '${PYTHON}'
LLVM_ROOT = '${EMSCRIPTEN_BIN}'
BINARYEN_ROOT = '${EMSDK_ROOT}/upstream'
EMSCRIPTEN_ROOT = '${EMSCRIPTEN_ROOT}'
CACHE = '${EM_CACHE_DIR}'
EOF
}

with_emscripten() {
  write_em_config
  env \
    EMSDK_PYTHON="${PYTHON}" \
    EM_CONFIG="${EM_CONFIG_FILE}" \
    PATH="$(dirname -- "${PYTHON}"):${TOOL_ENV_BIN:+${TOOL_ENV_BIN}:}${EMSCRIPTEN_ROOT}:${PATH}" \
    "$@"
}

find_lldb_link_response() {
  find -H "${LLVM_BUILD_DIR}" -type f \
    -path '*/lldb-dap.dir/linkLibs.rsp' -print -quit
}

llvm_revision() {
  if [[ -n "${WASMBOLT_LLVM_REVISION:-}" ]]; then
    printf '%s\n' "${WASMBOLT_LLVM_REVISION}"
  else
    git -C "${LLVM_PROJECT_ROOT}" rev-parse HEAD
  fi
}
