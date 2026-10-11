#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

mode="${1:-wasm}"
case "${mode}" in
  wasm) llvm_build="${WASM_LLVM_DIR}"; swift_build="${WASM_SWIFT_DIR}"; sdk=EMSCRIPTEN; arch=wasm32 ;;
  native) llvm_build="${NATIVE_LLVM_DIR}"; swift_build="${NATIVE_SWIFT_DIR}"; sdk=OSX; arch=arm64 ;;
  *) printf 'Expected native or wasm, got %s\n' "${mode}" >&2; exit 1 ;;
esac
args=(-S "${SWIFT_SOURCE_DIR}" -B "${swift_build}" -G Ninja
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release
  -DLLVM_DIR="${llvm_build}/lib/cmake/llvm"
  -DClang_DIR="${llvm_build}/lib/cmake/clang"
  -DLLD_DIR="${llvm_build}/lib/cmake/lld"
  -DLLVM_TABLEGEN="${NATIVE_LLVM_DIR}/bin/llvm-tblgen"
  -DCLANG_TABLEGEN="${NATIVE_LLVM_DIR}/bin/clang-tblgen"
  -DSWIFT_PATH_TO_CMARK_SOURCE="${SWIFT_DEV_DIR}/cmark"
  -DSWIFT_PATH_TO_CMARK_BUILD="${WORK_DIR}/cmark-${mode}"
  -DSWIFT_INCLUDE_TOOLS=ON -DSWIFT_INCLUDE_TESTS=OFF -DSWIFT_INCLUDE_DOCS=OFF
  -DSWIFT_ENABLE_SWIFT_IN_SWIFT=ON -DBRIDGING_MODE=PURE
  -DSWIFT_BUILD_IMMEDIATE_MODE="${WASMBOLT_SWIFT_IMMEDIATE_MODE:-OFF}" -DSWIFT_BUILD_SWIFT_SYNTAX=OFF
  -DSWIFT_BUILD_REGEX_PARSER_IN_COMPILER=OFF -DSWIFT_ENABLE_LIBXML2=OFF
  -DSWIFT_BUILD_SOURCEKIT=OFF -DSWIFT_TOOL_LIBSWIFTSCAN_BUILD=OFF
  -DSWIFT_BUILD_REMOTE_MIRROR=OFF -DSWIFT_BUILD_STATIC_STDLIB=OFF
  -DSWIFT_BUILD_DYNAMIC_STDLIB=OFF -DSWIFT_BUILD_STATIC_SDK_OVERLAY=OFF
  -DSWIFT_BUILD_DYNAMIC_SDK_OVERLAY=OFF -DSWIFT_ENABLE_DISPATCH=OFF
  -DSWIFT_STDLIB_SUPPORT_BACK_DEPLOYMENT=OFF
  -DSWIFT_BUILD_RUNTIME_WITH_HOST_COMPILER=ON
  -DSWIFT_HOST_VARIANT_SDK="${sdk}" -DSWIFT_HOST_VARIANT_ARCH="${arch}"
  -DSWIFT_PRIMARY_VARIANT_SDK="${sdk}" -DSWIFT_PRIMARY_VARIANT_ARCH="${arch}"
  -DSWIFT_SDKS="${sdk}" -DSWIFT_PARALLEL_LINK_JOBS=1
  -DCMAKE_JOB_POOL_COMPILE=swift_compile
  -DSWIFT_EMSCRIPTEN_SYSROOT_PATH="${EMSCRIPTEN_ROOT}/cache/sysroot")
if [[ "${mode}" == wasm ]]; then
  # Optimized Wasm sibling calls mispass aggregate arguments in this toolchain.
  # The enum payload probe reproduces it at -O1/-O3; this preserves full
  # optimization while keeping the caller's aggregate storage alive.
  wasm_cmake "${args[@]}" -DSWIFT_THREADING_PACKAGE=pthreads \
    -DCMAKE_Swift_COMPILER="$(xcrun -f swiftc)" \
    -DCMAKE_Swift_FLAGS="-sdk $(xcrun --show-sdk-path) -target arm64-apple-macosx13.0" \
    -DCMAKE_JOB_POOLS="swift_compile=${JOBS}" \
    -DBOOTSTRAPPING_MODE=CROSSCOMPILE \
    -DSWIFT_EXEC_FOR_SWIFT_MODULES="${NATIVE_SWIFT_DIR}/bin/swiftc" \
    -DSWIFT_BUILD_RUNTIME_WITH_HOST_COMPILER=ON \
    -DSWIFT_NATIVE_SWIFT_TOOLS_PATH="${NATIVE_SWIFT_DIR}/bin" \
    -DSWIFT_PATH_TO_SWIFT_SDK="${WORK_DIR}/stdlib-host-wasm" \
    -DSWIFT_COMPILER_SOURCES_SDK_FLAGS="-sdk;${EMSCRIPTEN_ROOT}/cache/sysroot;-resource-dir;${WORK_DIR}/stdlib-host-wasm/lib/swift;-Xcc;-pthread;-Xcc;-fPIC;-Xcc;-isystem;-Xcc;${EMSCRIPTEN_ROOT}/cache/sysroot/include/compat" \
    -DSWIFT_NATIVE_CLANG_TOOLS_PATH="$(dirname -- "$(xcrun -f clang)")" \
    -DSWIFT_NATIVE_LLVM_TOOLS_PATH="${NATIVE_LLVM_DIR}/bin" \
    -DLLVM_TABLEGEN="${NATIVE_LLVM_DIR}/bin/llvm-tblgen" \
    -DCLANG_TABLEGEN="${NATIVE_LLVM_DIR}/bin/clang-tblgen" \
    -DUUID_INCLUDE_DIR="${EMSCRIPTEN_ROOT}/cache/sysroot/include" \
    -DCMAKE_C_FLAGS="${WASM_FLAGS}" \
    -DCMAKE_CXX_FLAGS="${WASM_CXX_FLAGS} -fno-optimize-sibling-calls" \
    -DCMAKE_EXE_LINKER_FLAGS='-pthread -sALLOW_MEMORY_GROWTH=1'
else
  "${CMAKE}" "${args[@]}" \
    -DCMAKE_JOB_POOLS=swift_compile=3 \
    -DBOOTSTRAPPING_MODE=HOSTTOOLS \
    -DCMAKE_Swift_COMPILER="$(xcrun -f swiftc)" \
    -DCMAKE_Swift_FLAGS="-sdk $(xcrun --show-sdk-path) -target arm64-apple-macosx13.0" \
    -DCMAKE_C_COMPILER="$(xcrun -f clang)" \
    -DCMAKE_CXX_COMPILER="$(xcrun -f clang++)"
fi
