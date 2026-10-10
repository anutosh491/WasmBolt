#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

patch="${PROJECT_DIR}/patches/swift-reflection-heap-layout.patch"
if ! git -C "${SWIFT_SOURCE_DIR}" apply --reverse --check "${patch}"; then
  git -C "${SWIFT_SOURCE_DIR}" apply --check "${patch}"
  git -C "${SWIFT_SOURCE_DIR}" apply "${patch}"
fi

for name in lldb-swift-browser lldb-swift-wasm-reflection; do
  patch="${PROJECT_DIR}/patches/${name}.patch"
  if ! git -C "${LLVM_SOURCE_DIR}" apply --reverse --check "${patch}"; then
    git -C "${LLVM_SOURCE_DIR}" apply --check "${patch}"
    git -C "${LLVM_SOURCE_DIR}" apply "${patch}"
  fi
done

wasm_cmake -S "${LLVM_SOURCE_DIR}/lldb" -B "${WORK_DIR}/lldb-wasm" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_DIR="${WASM_LLVM_DIR}/lib/cmake/llvm" \
  -DClang_DIR="${WASM_LLVM_DIR}/lib/cmake/clang" \
  -DLLD_DIR="${WASM_LLVM_DIR}/lib/cmake/lld" \
  -DSwift_DIR="${WASM_SWIFT_DIR}/lib/cmake/swift" \
  -DSWIFT_PATH_TO_SWIFT_SDK="${WORK_DIR}/stdlib-host-wasm" \
  -DLLDB_SWIFT_LIBS="${WORK_DIR}/stdlib-host-wasm/lib/swift" \
  -DLLVM_EXTERNAL_SWIFT_SOURCE_DIR="${SWIFT_SOURCE_DIR}" \
  -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten \
  -DLLVM_ENABLE_THREADS=ON -DLLVM_ENABLE_ASSERTIONS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF -DLLVM_ENABLE_PLUGINS=OFF \
  -DLLDB_ENABLE_SWIFT_SUPPORT=ON -DLLDB_BUILD_STATIC_LIBLLDB=ON \
  -DLLDB_ENABLE_PYTHON=OFF -DLLDB_ENABLE_LUA=OFF -DLLDB_ENABLE_CURSES=OFF \
  -DLLDB_ENABLE_LIBEDIT=OFF -DLLDB_ENABLE_LZMA=OFF -DLLDB_ENABLE_LIBXML2=OFF \
  -DLLDB_ENABLE_SWIG=OFF -DLLDB_ENABLE_TREESITTER=OFF \
  -DLLDB_INCLUDE_TESTS=OFF -DLLDB_USE_SYSTEM_DEBUGSERVER=OFF \
  -DLLDB_EXPORT_ALL_SYMBOLS=OFF -DLLDB_INCLUDE_DOCS=OFF \
  -DLLDB_EXTERNAL_CLANG_RESOURCE_DIR="${WASM_LLVM_DIR}/lib/clang/23" \
  -DLLVM_TABLEGEN="${NATIVE_LLVM_DIR}/bin/llvm-tblgen" \
  -DCLANG_TABLEGEN="${NATIVE_LLVM_DIR}/bin/clang-tblgen" \
  -DLLDB_TABLEGEN_EXE="${NATIVE_LLVM_DIR}/bin/lldb-tblgen" \
  -DLLVM_NM="${EMSDK_ROOT}/upstream/bin/llvm-nm" \
  -DCMAKE_C_FLAGS="${WASM_FLAGS}" -DCMAKE_CXX_FLAGS="${WASM_CXX_FLAGS} -fno-optimize-sibling-calls" \
  -DCMAKE_EXE_LINKER_FLAGS='-pthread -sALLOW_MEMORY_GROWTH=1' \
  -DLLVM_PARALLEL_LINK_JOBS=1
