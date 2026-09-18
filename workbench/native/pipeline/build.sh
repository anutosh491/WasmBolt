#!/usr/bin/env bash
set -euo pipefail

LLVM_VERSION=23.1.0
LLVM_TAG=llvmorg-23.1.0
LLVM_REVISION=ea7d852a70e8bdfaf601d6626a760f9771b2c4b4
EMSCRIPTEN_VERSION=4.0.9

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORKBENCH_DIR=$(cd "${ROOT_DIR}/../.." && pwd)
WORK_DIR=${WORK_DIR:-"${WORKBENCH_DIR}/work/pipeline"}
BUILD_DIR=${BUILD_DIR:-"${WORK_DIR}/build"}
STAGE_DIR=${STAGE_DIR:-"${WORKBENCH_DIR}/compiler"}
MAMBA_ROOT_PREFIX=${MAMBA_ROOT_PREFIX:-"${WORK_DIR}/mamba"}
MAMBA_EXE=${MAMBA_EXE:-micromamba}
JOBS=${JOBS:-2}
BINARYEN_CORES=${BINARYEN_CORES:-2}
ACTION=${1:-all}

fail() {
  echo "pipeline build: $*" >&2
  exit 1
}

environment_matches_lock() {
  python3 - "$1" "$2" <<'PY'
import json
import pathlib
import sys

lock = pathlib.Path(sys.argv[1])
prefix = pathlib.Path(sys.argv[2])
expected = sorted(
    line for line in lock.read_text().splitlines()
    if line.startswith("https://")
)
installed = []
try:
    metadata_paths = (prefix / "conda-meta").glob("*.json")
    for metadata_path in metadata_paths:
        metadata = json.loads(metadata_path.read_text())
        installed.append(f"{metadata['url']}#{metadata['md5']}")
except (FileNotFoundError, KeyError, json.JSONDecodeError):
    raise SystemExit(1)
raise SystemExit(sorted(installed) != expected)
PY
}

ensure_environment() {
  local lock=$1
  local prefix=$2

  if environment_matches_lock "${lock}" "${prefix}"; then
    return
  fi
  if [[ -e "${prefix}" ]]; then
    fail "${prefix} exists but does not match ${lock}"
  fi

  mkdir -p "$(dirname "${prefix}")"
  "${MAMBA_EXE}" --no-rc create --yes \
    --root-prefix "${MAMBA_ROOT_PREFIX}" \
    --prefix "${prefix}" \
    --file "${lock}"
  environment_matches_lock "${lock}" "${prefix}" ||
    fail "micromamba did not reproduce ${lock}"
}

ensure_source() {
  local revision
  if ! git -C "${SOURCE_DIR}" rev-parse --is-inside-work-tree \
    >/dev/null 2>&1; then
    if [[ -n "${LLVM_SOURCE_REPOSITORY:-}" ]]; then
      fail "LLVM_SOURCE_REPOSITORY is not a Git repository"
    fi
    mkdir -p "$(dirname "${SOURCE_DIR}")"
    git clone --filter=blob:none --depth 1 \
      --branch "${LLVM_TAG}" \
      https://github.com/llvm/llvm-project.git "${SOURCE_DIR}"
  fi

  revision=$(
    git -C "${SOURCE_DIR}" rev-parse "${LLVM_REVISION}^{commit}" 2>/dev/null
  ) || fail "${SOURCE_DIR} does not contain ${LLVM_TAG}"
  [[ "${revision}" == "${LLVM_REVISION}" ]] ||
    fail "${SOURCE_DIR} does not contain the pinned LLVM revision"
}

run_in_build_environment() {
  "${MAMBA_EXE}" --no-rc run --prefix "${BUILD_PREFIX}" \
    env EMCC_CFLAGS= BINARYEN_CORES="${BINARYEN_CORES}" "$@"
}

build_tools() {
  local build_lock host_lock emcc_version
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64)
      build_lock="${WORKBENCH_DIR}/runtime/locks/build-osx-arm64.txt"
      ;;
    Linux:x86_64)
      build_lock="${WORKBENCH_DIR}/runtime/locks/build-linux-64.txt"
      ;;
    *)
      fail "the source build supports macOS arm64 and Linux x86_64"
      ;;
  esac
  host_lock="${WORKBENCH_DIR}/runtime/locks/host-emscripten-wasm32.txt"

  command -v "${MAMBA_EXE}" >/dev/null 2>&1 ||
    fail "micromamba is required"
  ensure_environment "${build_lock}" "${BUILD_PREFIX}"
  ensure_environment "${host_lock}" "${HOST_PREFIX}"
  ensure_source

  emcc_version=$(
    run_in_build_environment emcc --version | sed -n '1p'
  )
  [[ "${emcc_version}" == *" ${EMSCRIPTEN_VERSION}"* ]] ||
    fail "expected Emscripten ${EMSCRIPTEN_VERSION}: ${emcc_version}"
  compgen -G \
    "${HOST_PREFIX}/conda-meta/llvm-${LLVM_VERSION}-*.json" >/dev/null ||
    fail "the host prefix does not contain LLVM ${LLVM_VERSION}"

  run_in_build_environment emcmake cmake \
    -S "${ROOT_DIR}" \
    -B "${BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="${HOST_PREFIX}" \
    -DLLVM_DIR="${HOST_PREFIX}/lib/cmake/llvm" \
    -DLLVM_SOURCE_REPOSITORY="${SOURCE_DIR}"

  # Linking either all-targets driver is memory-intensive. Build and link one
  # final executable at a time, while limiting Binaryen's own worker pool.
  run_in_build_environment cmake --build "${BUILD_DIR}" \
    --target opt --parallel "${JOBS}"
  run_in_build_environment cmake --build "${BUILD_DIR}" \
    --target llc --parallel "${JOBS}"
}

stage_tools() {
  python3 "${ROOT_DIR}/stage.py" stage "${BUILD_DIR}" "${STAGE_DIR}"
}

SOURCE_DIR=${LLVM_SOURCE_REPOSITORY:-"${WORK_DIR}/llvm-project"}
BUILD_PREFIX=${BUILD_PREFIX:-"${WORK_DIR}/env/build"}
HOST_PREFIX=${HOST_PREFIX:-"${WORK_DIR}/env/host"}

case "${ACTION}" in
  all)
    build_tools
    stage_tools
    ;;
  build)
    build_tools
    ;;
  stage)
    stage_tools
    ;;
  check)
    python3 "${ROOT_DIR}/stage.py" check "${STAGE_DIR}"
    ;;
  *)
    fail "use build.sh [all|build|stage|check]"
    ;;
esac
