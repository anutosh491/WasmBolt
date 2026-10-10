#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

# Build the interpreter separately so compiler/debugger binaries remain usable.
llvm_patch="${PROJECT_DIR}/patches/lld-relative-data.patch"
if ! git -C "${LLVM_SOURCE_DIR}" apply --reverse --check "${llvm_patch}" >/dev/null 2>&1; then
  git -C "${LLVM_SOURCE_DIR}" apply --check "${llvm_patch}"
  git -C "${LLVM_SOURCE_DIR}" apply "${llvm_patch}"
fi
"${CMAKE}" --build "${WASM_LLVM_DIR}" --parallel "${JOBS}" --target lldWasm

repl_dir="${WASMBOLT_SWIFT_REPL_WORK_DIR:-${WORK_DIR}/repl}"
repl_sources="${repl_dir}/sources"
repl_swift="${repl_sources}/swift"
repl_inputs="${repl_dir}/build-inputs"
revision="$("${PYTHON}" -c 'import json,sys; print(json.load(open(sys.argv[1]))["swift"]["revision"])' "${PROJECT_DIR}/sources.json")"
mkdir -p "${repl_sources}" "${repl_inputs}"
if [[ ! -d "${repl_swift}/.git" ]]; then
  git clone --shared --no-checkout "${SWIFT_SOURCE_DIR}" "${repl_swift}"
  git -C "${repl_swift}" checkout --detach "${revision}"
fi
[[ "$(git -C "${repl_swift}" rev-parse HEAD)" == "${revision}" ]] || {
  printf 'Wrong Swift revision in %s\n' "${repl_swift}" >&2; exit 1;
}
for name in swift-browser-host swift-driver-executor swift-repl-browser; do
  patch="${PROJECT_DIR}/patches/${name}.patch"
  if ! git -C "${repl_swift}" apply --reverse --check "${patch}" >/dev/null 2>&1; then
    git -C "${repl_swift}" apply --check "${patch}"
    git -C "${repl_swift}" apply "${patch}"
  fi
done
for name in llvm-native llvm-wasm swift-native stdlib-wasm stdlib-host-wasm cmark-native cmark-wasm; do
  [[ -d "${WORK_DIR}/${name}" ]] || { printf 'Missing compiler build input: %s\n' "${name}" >&2; exit 1; }
  [[ -e "${repl_inputs}/${name}" ]] || ln -s "${WORK_DIR}/${name}" "${repl_inputs}/${name}"
done
for name in cmark swift-experimental-string-processing; do
  [[ -e "${repl_sources}/${name}" ]] || ln -s "${SWIFT_DEV_DIR}/${name}" "${repl_sources}/${name}"
done

WASMBOLT_SWIFT_WORK_DIR="${repl_inputs}" \
WASMBOLT_SWIFT_SOURCE_ROOT="${repl_sources}" \
WASMBOLT_SWIFT_LLVM_SOURCE="${LLVM_SOURCE_DIR}" \
WASMBOLT_SWIFT_IMMEDIATE_MODE=ON \
  bash "${PROJECT_DIR}/scripts/30-configure-swift.sh" wasm
"${CMAKE}" --build "${repl_inputs}/swift-wasm" --parallel "${JOBS}" \
  --target swiftImmediate swiftCompilerModules

"${EMSCRIPTEN_ROOT}/embuilder" --pic build crtbegin-mt

wasm_cmake -S "${PROJECT_DIR}/bridge/repl" -B "${repl_dir}/output" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_DIR="${WASM_LLVM_DIR}/lib/cmake/llvm" \
  -DClang_DIR="${WASM_LLVM_DIR}/lib/cmake/clang" \
  -DLLD_DIR="${WASM_LLVM_DIR}/lib/cmake/lld" \
  -DSwift_DIR="${repl_inputs}/swift-wasm/lib/cmake/swift" \
  -DSWIFT_HOST_RUNTIME="${WORK_DIR}/stdlib-host-wasm" \
  -DSWIFT_REPL_TLS_OBJECT="${EM_CACHE}/sysroot/lib/wasm32-emscripten/pic/crtbegin-mt.o" \
  -DCMAKE_C_FLAGS="${WASM_FLAGS}" -DCMAKE_CXX_FLAGS="${WASM_CXX_FLAGS}"
"${PYTHON}" "${PROJECT_DIR}/scripts/build-llvm-dependencies.py" \
  --ninja "${NINJA}" --cmake "${CMAKE}" --consumer "${repl_dir}/output" \
  --llvm "${WASM_LLVM_DIR}" --jobs "${JOBS}" wasmbolt-swift-repl
"${CMAKE}" --build "${repl_dir}/output" --parallel 1 --target wasmbolt-swift-repl
