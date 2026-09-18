#!/usr/bin/env bash
set -euo pipefail

LLVM_VERSION=23.1.0
LLVM_REVISION=ea7d852a70e8bdfaf601d6626a760f9771b2c4b4
EMSCRIPTEN_VERSION=4.0.9

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORKBENCH_DIR=$(cd "${ROOT_DIR}/../.." && pwd)
WORK_DIR=${WORK_DIR:-"${WORKBENCH_DIR}/work/clangd"}
SOURCE_DIR=${SOURCE_DIR:-"${LLVM_SOURCE_REPOSITORY:-}"}
SOURCE_DIR=${SOURCE_DIR:-"${WORK_DIR}/llvm-project"}
NATIVE_BUILD_DIR=${NATIVE_BUILD_DIR:-"${WORK_DIR}/native-build"}
WASM_BUILD_DIR=${WASM_BUILD_DIR:-"${WORK_DIR}/wasm-build"}
STAGE_DIR=${STAGE_DIR:-"${WORKBENCH_DIR}/compiler/clangd"}
EMSCRIPTEN_ENV=${EMSCRIPTEN_ENV:-}
# Keep this conservative: LLDB and core compiler builds commonly run beside it.
JOBS=${JOBS:-2}

fail() {
  echo "clangd build: $*" >&2
  exit 1
}

resolve_tool() {
  local name=$1
  local configured=$2
  local variable=$3
  local resolved

  resolved=$(command -v "${configured:-${name}}" 2>/dev/null || true)
  [[ -n "${resolved}" && -x "${resolved}" ]] ||
    fail "missing ${name}; put it on PATH or set ${variable}"
  printf '%s\n' "${resolved}"
}

resolve_path() {
  "${PYTHON_BIN}" - "$1" <<'PY'
import pathlib
import sys

print(pathlib.Path(sys.argv[1]).resolve())
PY
}

if [[ -n "${EMSCRIPTEN_ENV}" ]]; then
  [[ -d "${EMSCRIPTEN_ENV}/bin" ]] ||
    fail "missing Emscripten environment: ${EMSCRIPTEN_ENV}"
  export PATH="${EMSCRIPTEN_ENV}/bin:${PATH}"
fi

CMAKE_BIN=$(resolve_tool cmake "${CMAKE_BIN:-}" CMAKE_BIN)
NINJA_BIN=$(resolve_tool ninja "${NINJA_BIN:-}" NINJA_BIN)
GIT_BIN=$(resolve_tool git "${GIT_BIN:-}" GIT_BIN)
PYTHON_BIN=$(resolve_tool python3 "${PYTHON_BIN:-}" PYTHON_BIN)
GZIP_BIN=$(resolve_tool gzip "${GZIP_BIN:-}" GZIP_BIN)
EMCC_BIN=$(resolve_tool emcc "${EMCC_BIN:-}" EMCC_BIN)
EMXX_BIN=$(resolve_tool em++ "${EMXX_BIN:-}" EMXX_BIN)
EMCMAKE_BIN=$(resolve_tool emcmake "${EMCMAKE_BIN:-}" EMCMAKE_BIN)
EM_CONFIG_BIN=$(resolve_tool em-config "${EM_CONFIG_BIN:-}" EM_CONFIG_BIN)

case "${JOBS}" in
  1 | 2) ;;
  *) fail "JOBS must be 1 or 2" ;;
esac

export EM_CACHE=${EM_CACHE:-"${WORK_DIR}/em-cache-${EMSCRIPTEN_VERSION}"}

emcc_version=$("${EMCC_BIN}" --version | sed -n '1p')
[[ "${emcc_version}" == *" ${EMSCRIPTEN_VERSION} "* ]] ||
  fail "expected Emscripten ${EMSCRIPTEN_VERSION}: ${emcc_version}"

expected_stage=$(resolve_path "${WORKBENCH_DIR}/compiler/clangd")
STAGE_DIR=$(resolve_path "${STAGE_DIR}")
[[ "${STAGE_DIR}" == "${expected_stage}" ]] ||
  fail "STAGE_DIR must resolve to ${expected_stage}"

[[ -d "${SOURCE_DIR}/llvm" ]] || fail "missing LLVM source: ${SOURCE_DIR}"
[[ "$("${GIT_BIN}" -C "${SOURCE_DIR}" rev-parse HEAD)" == \
  "${LLVM_REVISION}" ]] ||
  fail "source is not llvmorg-${LLVM_VERSION} (${LLVM_REVISION})"

for patch in "${ROOT_DIR}"/patches/*.patch; do
  if "${GIT_BIN}" -C "${SOURCE_DIR}" apply --check \
    "${patch}" 2>/dev/null; then
    "${GIT_BIN}" -C "${SOURCE_DIR}" apply "${patch}"
  elif ! "${GIT_BIN}" -C "${SOURCE_DIR}" apply --reverse --check \
    "${patch}" 2>/dev/null; then
    fail "$(basename "${patch}") neither applies nor is already present"
  fi
done

"${CMAKE_BIN}" -G Ninja \
  -S "${SOURCE_DIR}/llvm" \
  -B "${NATIVE_BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_MAKE_PROGRAM="${NINJA_BIN}" \
  -DLLVM_ENABLE_PROJECTS=clang \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_ENABLE_ZSTD=OFF
"${CMAKE_BIN}" --build "${NATIVE_BUILD_DIR}" \
  --target llvm-tblgen clang-tblgen -- -j"${JOBS}"

EMSCRIPTEN_ROOT=$("${EM_CONFIG_BIN}" EMSCRIPTEN_ROOT)
SYSROOT_INCLUDE="${EMSCRIPTEN_ROOT}/cache/sysroot/include"
RESOURCE_INCLUDE="${WASM_BUILD_DIR}/lib/clang/23/include"
[[ -d "${SYSROOT_INCLUDE}" ]] ||
  fail "missing Emscripten sysroot headers: ${SYSROOT_INCLUDE}"

COMMON_FLAGS="-Oz -g0 -pthread -Dwait4=__syscall_wait4"
COMMON_FLAGS+=" -DCLANG_INTERP_DISABLE_TAILCALLS"
RUNTIME_LINK_FLAGS="-Oz -pthread"
RUNTIME_LINK_FLAGS+=" -sENVIRONMENT=worker -sNO_INVOKE_RUN=1"
RUNTIME_LINK_FLAGS+=" -sNO_EXIT_RUNTIME=1 -sMODULARIZE=1 -sEXPORT_ES6=1"
RUNTIME_LINK_FLAGS+=" -sEXPORT_NAME=createClangdModule"
RUNTIME_LINK_FLAGS+=" -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=512MB"
RUNTIME_LINK_FLAGS+=" -sMAXIMUM_MEMORY=2GB -sSTACK_SIZE=8MB"
RUNTIME_LINK_FLAGS+=" -sPTHREAD_POOL_SIZE=8 -sPTHREAD_POOL_SIZE_STRICT=0"
RUNTIME_LINK_FLAGS+=" -sASYNCIFY=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
LINK_FLAGS="${RUNTIME_LINK_FLAGS}"
LINK_FLAGS+=" --embed-file=${SYSROOT_INCLUDE}@/include"
LINK_FLAGS+=" --embed-file=${RESOURCE_INCLUDE}@/lib/clang/23/include"

CROSS_CMAKE_ARGS=(
  -G Ninja
  -S "${SOURCE_DIR}/llvm"
  -B "${WASM_BUILD_DIR}"
  -DCMAKE_BUILD_TYPE=MinSizeRel
  "-DCMAKE_MAKE_PROGRAM=${NINJA_BIN}"
  "-DCMAKE_C_FLAGS=${COMMON_FLAGS}"
  "-DCMAKE_CXX_FLAGS=${COMMON_FLAGS}"
  "-DLLVM_ENABLE_PROJECTS=clang;clang-tools-extra"
  "-DLLVM_TABLEGEN=${NATIVE_BUILD_DIR}/bin/llvm-tblgen"
  "-DCLANG_TABLEGEN=${NATIVE_BUILD_DIR}/bin/clang-tblgen"
  -DLLVM_TARGET_ARCH=wasm32-emscripten
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten
  -DLLVM_TARGETS_TO_BUILD=WebAssembly
  -DLLVM_ENABLE_THREADS=ON
  -DLLVM_BUILD_STATIC=ON
  -DLLVM_INCLUDE_BENCHMARKS=OFF
  -DLLVM_INCLUDE_EXAMPLES=OFF
  -DLLVM_INCLUDE_TESTS=OFF
  -DLLVM_INCLUDE_DOCS=OFF
  -DLLVM_ENABLE_BACKTRACES=OFF
  -DLLVM_ENABLE_UNWIND_TABLES=OFF
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF
  -DLLVM_ENABLE_TERMINFO=OFF
  -DLLVM_ENABLE_LIBEDIT=OFF
  -DLLVM_ENABLE_PIC=OFF
  -DLLVM_ENABLE_ZLIB=OFF
  -DLLVM_ENABLE_ZSTD=OFF
  -DLLVM_ENABLE_LIBXML2=OFF
  -DLLVM_ENABLE_CURL=OFF
  -DCLANG_ENABLE_ARCMT=OFF
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF
  -DCLANGD_BUILD_XPC=OFF
  -DCLANGD_BUILD_DEXP=OFF
  -DCLANGD_DECISION_FOREST=OFF
  -DCLANGD_TIDY_CHECKS=OFF
  -DCLANG_TIDY_ENABLE_STATIC_ANALYZER=OFF
  -DCLANG_TIDY_ENABLE_QUERY_BASED_CUSTOM_CHECKS=OFF
)

# Configure without embedded directories first: compiler checks must not pack
# 20+ MiB of headers, and generated Clang resource headers do not exist yet.
"${EMCMAKE_BIN}" "${CMAKE_BIN}" "${CROSS_CMAKE_ARGS[@]}" \
  "-DCMAKE_EXE_LINKER_FLAGS=${RUNTIME_LINK_FLAGS}"

"${CMAKE_BIN}" --build "${WASM_BUILD_DIR}" \
  --target clang-resource-headers -- -j"${JOBS}"
"${EMCMAKE_BIN}" "${CMAKE_BIN}" "${CROSS_CMAKE_ARGS[@]}" \
  "-DCMAKE_EXE_LINKER_FLAGS=${LINK_FLAGS}"
"${CMAKE_BIN}" --build "${WASM_BUILD_DIR}" --target clangd -- -j"${JOBS}"

rm -rf -- "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"
cp "${WASM_BUILD_DIR}/bin/clangd.js" "${STAGE_DIR}/clangd.js"
for optional in clangd.data clangd.worker.js; do
  if [[ -f "${WASM_BUILD_DIR}/bin/${optional}" ]]; then
    cp "${WASM_BUILD_DIR}/bin/${optional}" "${STAGE_DIR}/${optional}"
  fi
done
"${GZIP_BIN}" -9 -c "${WASM_BUILD_DIR}/bin/clangd.wasm" \
  >"${STAGE_DIR}/clangd.wasm.gz"

"${PYTHON_BIN}" "${ROOT_DIR}/manifest.py" "${STAGE_DIR}" \
  "${LLVM_VERSION}" "${LLVM_REVISION}" "${EMSCRIPTEN_VERSION}"

echo "clangd staged in ${STAGE_DIR}"
