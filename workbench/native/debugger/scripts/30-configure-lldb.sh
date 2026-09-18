#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

for tool in llvm-tblgen clang-tblgen lldb-tblgen; do
  require_executable "${LLVM_NATIVE_BUILD_DIR}/bin/${tool}"
done

embedded_wasm_patch=
embedded_wasm_patch+="${DEBUGGER_DIR}/patches/"
embedded_wasm_patch+='lldb-embedded-wasm-thread-selection.patch'
require_file "${embedded_wasm_patch}"
if git -C "${LLVM_PROJECT_ROOT}" apply --check "${embedded_wasm_patch}"; then
  git -C "${LLVM_PROJECT_ROOT}" apply "${embedded_wasm_patch}"
  note 'applied LLDB embedded-Wasm thread-selection patch'
elif git -C "${LLVM_PROJECT_ROOT}" apply --reverse --check \
  "${embedded_wasm_patch}"; then
  note 'LLDB embedded-Wasm thread-selection patch is already applied'
else
  die 'LLDB embedded-Wasm thread-selection patch does not match this checkout'
fi

c_flags='-O2 -fPIC -fwasm-exceptions -pthread -mtail-call'
cxx_flags="${c_flags} -Dwait4=__syscall_wait4"
link_flags='-pthread -sPTHREAD_POOL_SIZE=4 -sALLOW_MEMORY_GROWTH=1'
libxml_args=(
  -DLLVM_ENABLE_LIBXML2=OFF
  -DLLDB_ENABLE_LIBXML2=OFF
)
if [[ -n "${LIBXML2_PREFIX:-}" ]]; then
  require_file "${LIBXML2_PREFIX}/lib/libxml2.a"
  require_file "${LIBXML2_PREFIX}/include/libxml2/libxml/parser.h"
  libxml_args=(
    -DCMAKE_PREFIX_PATH="${LIBXML2_PREFIX}"
    -DLLVM_ENABLE_LIBXML2=FORCE_ON
    -DLLDB_ENABLE_LIBXML2=ON
    -DLIBXML2_LIBRARY="${LIBXML2_PREFIX}/lib/libxml2.a"
    -DLIBXML2_INCLUDE_DIR="${LIBXML2_PREFIX}/include/libxml2"
  )
fi

with_emscripten "${EMCMAKE}" "${CMAKE}" \
  -S "${LLVM_PROJECT_ROOT}/llvm" \
  -B "${LLVM_BUILD_DIR}" \
  -G 'Unix Makefiles' \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${WORK_DIR}/llvm-lldb-prefix" \
  -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_ENABLE_PROJECTS='clang;lldb' \
  -DLLVM_ENABLE_THREADS=ON \
  -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_PLUGINS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_BUILD_UTILS=OFF \
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DCLANG_ENABLE_OBJC_REWRITER=OFF \
  -DCLANG_ENABLE_BOOTSTRAP=OFF \
  -DCLANG_PLUGIN_SUPPORT=OFF \
  -DCLANG_ENABLE_LIBXML2=OFF \
  -DCLANG_BUILD_TOOLS=OFF \
  -DLLDB_BUILD_STATIC_LIBLLDB=ON \
  -DLLDB_ENABLE_PYTHON=OFF \
  -DLLDB_ENABLE_LUA=OFF \
  -DLLDB_ENABLE_CURSES=OFF \
  -DLLDB_ENABLE_LIBEDIT=OFF \
  -DLLDB_ENABLE_LZMA=OFF \
  -DLLDB_ENABLE_SWIG=OFF \
  -DLLDB_ENABLE_TREESITTER=OFF \
  -DLLDB_INCLUDE_TESTS=OFF \
  -DLLDB_USE_SYSTEM_DEBUGSERVER=OFF \
  -DLLDB_EXPORT_ALL_SYMBOLS=OFF \
  "${libxml_args[@]}" \
  -DLLVM_NATIVE_TOOL_DIR="${LLVM_NATIVE_BUILD_DIR}/bin" \
  -DLLVM_TABLEGEN="${LLVM_NATIVE_BUILD_DIR}/bin/llvm-tblgen" \
  -DCLANG_TABLEGEN="${LLVM_NATIVE_BUILD_DIR}/bin/clang-tblgen" \
  -DLLDB_TABLEGEN_EXE="${LLVM_NATIVE_BUILD_DIR}/bin/lldb-tblgen" \
  -DCMAKE_C_FLAGS="${c_flags}" \
  -DCMAKE_CXX_FLAGS="${cxx_flags}" \
  -DCMAKE_EXE_LINKER_FLAGS="${link_flags}"

printf '%s\n' "$(llvm_revision)" \
  >"${LLVM_BUILD_DIR}/.wasmbolt-llvm-revision"
note "configured LLDB for Emscripten ${EMSCRIPTEN_VERSION}"
