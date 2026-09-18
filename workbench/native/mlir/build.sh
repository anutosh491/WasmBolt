#!/usr/bin/env bash
set -euo pipefail

LLVM_VERSION=23.1.0
LLVM_REVISION=ea7d852a70e8bdfaf601d6626a760f9771b2c4b4
EMSCRIPTEN_VERSION=4.0.9

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd "${ROOT_DIR}/../.." && pwd)
WORK_DIR=${WORK_DIR:-"${ROOT_DIR}/.work"}
BUILD_PREFIX=${BUILD_PREFIX:-"${PROJECT_DIR}/runtime/.cache/build"}
HOST_PREFIX=${HOST_PREFIX:-"${PROJECT_DIR}/runtime/.cache/host"}
MLIR_PREFIX=${MLIR_PREFIX:-"${WORK_DIR}/mlir-prefix"}
BUILD_DIR=${BUILD_DIR:-"${WORK_DIR}/build"}
MAMBA_ROOT=${MAMBA_ROOT:-"${WORK_DIR}/mamba"}
STAGE_DIR=${STAGE_DIR:-"${PROJECT_DIR}/compiler/mlir"}
JOBS=${JOBS:-2}

fail() {
  echo "MLIR build: $*" >&2
  exit 1
}

[[ -x "${BUILD_PREFIX}/bin/em++" ]] ||
  fail "build the core compiler environment first"
[[ -f "${HOST_PREFIX}/lib/cmake/llvm/LLVMConfig.cmake" ]] ||
  fail "missing LLVM ${LLVM_VERSION} host package"
[[ "${JOBS}" == "1" || "${JOBS}" == "2" ]] ||
  fail "JOBS must be 1 or 2"

micromamba --no-rc create --yes \
  --prefix "${MLIR_PREFIX}" \
  --root-prefix "${MAMBA_ROOT}" \
  --file "${ROOT_DIR}/package-lock.txt"

[[ -f "${MLIR_PREFIX}/lib/libMLIRMlirOptMain.a" ]] ||
  fail "the pinned package lacks MLIRMlirOptMain"
[[ -f "${MLIR_PREFIX}/lib/libMLIRTranslateLib.a" ]] ||
  fail "the pinned package lacks MLIRTranslateLib"

RUN=(
  micromamba --no-rc run --prefix "${BUILD_PREFIX}"
  env EMCC_CFLAGS= "BINARYEN_CORES=${JOBS}"
)
PREFIX_PATH="${MLIR_PREFIX};${HOST_PREFIX}"
"${RUN[@]}" emcmake cmake \
  -S "${ROOT_DIR}" \
  -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=Release \
  "-DCMAKE_PREFIX_PATH=${PREFIX_PATH}" \
  "-DMLIR_DIR=${MLIR_PREFIX}/lib/cmake/mlir" \
  "-DLLVM_DIR=${HOST_PREFIX}/lib/cmake/llvm"

# Serialize both large links. Binaryen may use at most JOBS worker threads.
"${RUN[@]}" cmake --build "${BUILD_DIR}" \
  --target mlir-opt --parallel 1
"${RUN[@]}" cmake --build "${BUILD_DIR}" \
  --target mlir-translate --parallel 1
"${BUILD_PREFIX}/bin/node" "${ROOT_DIR}/smoke.mjs" "${BUILD_DIR}"

mkdir -p "${STAGE_DIR}"
for name in mlir-opt.js mlir-opt.wasm \
  mlir-translate.js mlir-translate.wasm; do
  cp "${BUILD_DIR}/${name}" "${STAGE_DIR}/${name}"
done
python3 "${ROOT_DIR}/manifest.py" "${STAGE_DIR}" \
  "${LLVM_VERSION}" "${LLVM_REVISION}" "${EMSCRIPTEN_VERSION}"

echo "MLIR tools staged in ${STAGE_DIR}"
