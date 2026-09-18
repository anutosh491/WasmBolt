#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
DEBUGGER_DIR="$({ cd -- "${SCRIPT_DIR}/.." && pwd; })"
REPOSITORY_DIR="$({ cd -- "${DEBUGGER_DIR}/../.." && pwd; })"

# shellcheck source=versions.sh
source "${SCRIPT_DIR}/versions.sh"

WORK_DIR="${WASMBOLT_DEBUGGER_WORK_DIR:-${DEBUGGER_DIR}/.work}"
CACHE_DIR="${WORK_DIR}/cache"
WAMR_SOURCE_DIR="${WORK_DIR}/wamr-${WAMR_REVISION}"
WAMR_BUILD_DIR="${WORK_DIR}/wamr-build"
LLVM_BUILD_DIR="${WORK_DIR}/llvm-lldb-build"
LLVM_NATIVE_BUILD_DIR="${WORK_DIR}/llvm-native-tools"
BRIDGE_BUILD_DIR="${WORK_DIR}/bridge"
OUTPUT_DIR="${WORK_DIR}/output"
EM_CACHE_DIR="${WORK_DIR}/em-cache"
EM_CONFIG_FILE="${WORK_DIR}/emscripten-config.py"

if [[ -z "${LLVM_PROJECT_ROOT:-}" ]]; then
  for candidate in "${REPOSITORY_DIR}/.." "${REPOSITORY_DIR}/../.."; do
    if [[ -f "${candidate}/llvm/CMakeLists.txt" ]]; then
      LLVM_PROJECT_ROOT="$({ cd -- "${candidate}" && pwd; })"
      break
    fi
  done
  if [[ -z "${LLVM_PROJECT_ROOT:-}" ]]; then
    printf '%s\n' \
      '[debugger] error: set LLVM_PROJECT_ROOT to an llvm-project checkout' \
      >&2
    exit 1
  fi
fi

EMSCRIPTEN_PACKAGE_DEFAULT=
EMSCRIPTEN_PACKAGE_DEFAULT+="${HOME}/micromamba/pkgs/https/"
EMSCRIPTEN_PACKAGE_DEFAULT+='repo.prefix.dev/emscripten-forge-bot/'
EMSCRIPTEN_PACKAGE_DEFAULT+='emscripten-forge-6x/osx-arm64/'
EMSCRIPTEN_PACKAGE_DEFAULT+='emscripten-core-6.0.8-h53c7e63_1'
EMSCRIPTEN_PACKAGE="${WASMBOLT_EMSCRIPTEN_PACKAGE:-}"
if [[ -z "${EMSCRIPTEN_PACKAGE}" ]]; then
  EMSCRIPTEN_PACKAGE="${EMSCRIPTEN_PACKAGE_DEFAULT}"
fi

EMSDK_ROOT="${EMSCRIPTEN_PACKAGE}/opt/emsdk"
EMSCRIPTEN_ROOT="${EMSDK_ROOT}/upstream/emscripten"
EMSCRIPTEN_BIN="${EMSDK_ROOT}/upstream/bin"
EMXX="${EMSCRIPTEN_ROOT}/em++"
EMCC="${EMSCRIPTEN_ROOT}/emcc"
EMCMAKE="${EMSCRIPTEN_ROOT}/emcmake"

TOOL_ENV_BIN_DEFAULT="${HOME}/micromamba/envs/xeus-python-wasm-build/bin"
TOOL_ENV_BIN=
TOOL_ENV_BIN+="${WASMBOLT_TOOL_ENV_BIN:-${TOOL_ENV_BIN_DEFAULT}}"
NODE_JS="${WASMBOLT_NODE:-${TOOL_ENV_BIN}/node}"
PYTHON="${WASMBOLT_PYTHON:-${TOOL_ENV_BIN}/python3}"
CMAKE="${WASMBOLT_CMAKE:-${TOOL_ENV_BIN}/cmake}"

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
    EM_CONFIG="${EM_CONFIG_FILE}" \
    PATH="${TOOL_ENV_BIN}:${EMSCRIPTEN_ROOT}:${PATH}" \
    "$@"
}

find_lldb_link_response() {
  find "${LLVM_BUILD_DIR}" -type f \
    -path '*/lldb-dap.dir/linkLibs.rsp' -print -quit
}

llvm_revision() {
  git -C "${LLVM_PROJECT_ROOT}" rev-parse HEAD
}
