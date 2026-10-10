#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_executable "${CMAKE}"
require_file "${LLVM_PROJECT_ROOT}/llvm/CMakeLists.txt"

"${CMAKE}" -S "${LLVM_PROJECT_ROOT}/llvm" \
  -B "${LLVM_NATIVE_BUILD_DIR}" \
  -G 'Unix Makefiles' \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS='clang;lldb' \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DCLANG_BUILD_TOOLS=OFF \
  -DLLDB_ENABLE_PYTHON=OFF \
  -DLLDB_ENABLE_LUA=OFF \
  -DLLDB_ENABLE_CURSES=OFF \
  -DLLDB_ENABLE_LIBEDIT=OFF \
  -DLLDB_ENABLE_LZMA=OFF \
  -DLLDB_ENABLE_LIBXML2=OFF \
  -DLLDB_ENABLE_SWIG=OFF \
  -DLLDB_ENABLE_TREESITTER=OFF \
  -DLLDB_USE_SYSTEM_DEBUGSERVER=ON

"${CMAKE}" --build "${LLVM_NATIVE_BUILD_DIR}" \
  --target llvm-tblgen clang-tblgen lldb-tblgen \
  --parallel "${JOBS}"

for tool in llvm-tblgen clang-tblgen lldb-tblgen; do
  require_executable "${LLVM_NATIVE_BUILD_DIR}/bin/${tool}"
done

printf '%s\n' "$(llvm_revision)" \
  >"${LLVM_NATIVE_BUILD_DIR}/.wasmbolt-llvm-revision"
note "native TableGen tools match LLVM $(llvm_revision)"
