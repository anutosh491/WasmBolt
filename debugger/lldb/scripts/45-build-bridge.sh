#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

default_source="${DEBUGGER_DIR}/bridge/dap_browser.cpp"
source_file="${WASMBOLT_DAP_BRIDGE_SOURCE:-${default_source}}"
require_file "${source_file}"
require_file "${WAMR_BUILD_DIR}/libvmlib.a"

libxml_include=()
if [[ -n "${LIBXML2_PREFIX:-}" ]]; then
  libxml_include=(-isystem "${LIBXML2_PREFIX}/include/libxml2")
fi

mkdir -p "${BRIDGE_BUILD_DIR}"

wamr_defines=(
  -DBH_FREE=wasm_runtime_free
  -DBH_MALLOC=wasm_runtime_malloc
  -DBH_PLATFORM_LINUX
  -DBUILD_TARGET_X86_32
  -DWASM_DISABLE_HW_BOUND_CHECK=1
  -DWASM_DISABLE_STACK_HW_BOUND_CHECK=1
  -DWASM_DISABLE_WAKEUP_BLOCKING_OP=0
  -DWASM_ENABLE_AOT_INTRINSICS=0
  -DWASM_ENABLE_BULK_MEMORY=1
  -DWASM_ENABLE_BULK_MEMORY_OPT=1
  -DWASM_ENABLE_CALL_INDIRECT_OVERLONG=1
  -DWASM_ENABLE_DEBUG_INTERP=1
  -DWASM_ENABLE_EXTENDED_CONST_EXPR=0
  -DWASM_ENABLE_FAST_INTERP=0
  -DWASM_ENABLE_INTERP=1
  -DWASM_ENABLE_MINI_LOADER=0
  -DWASM_ENABLE_MULTI_MODULE=0
  -DWASM_ENABLE_QUICK_AOT_ENTRY=0
  -DWASM_ENABLE_REF_TYPES=1
  -DWASM_ENABLE_SHARED_MEMORY=0
  -DWASM_ENABLE_SHRUNK_MEMORY=1
  -DWASM_ENABLE_THREAD_MGR=1
  -DWASM_GLOBAL_HEAP_SIZE=10485760
  -DWASM_HAVE_MREMAP=1
  -D_GNU_SOURCE
)

with_emscripten "${EMXX}" \
  -std=c++17 -O2 -fPIC -fwasm-exceptions -pthread -mtail-call \
  -Dwait4=__syscall_wait4 \
  -DLLVM_BUILD_STATIC \
  -DHAVE_ROUND \
  -D_FILE_OFFSET_BITS=64 \
  -D_LARGEFILE_SOURCE \
  -D__STDC_CONSTANT_MACROS \
  -D__STDC_FORMAT_MACROS \
  -D__STDC_LIMIT_MACROS \
  "${wamr_defines[@]}" \
  -fno-exceptions -funwind-tables -fno-rtti \
  -I"${LLVM_PROJECT_ROOT}/lldb/tools/lldb-dap" \
  -I"${LLVM_PROJECT_ROOT}/lldb/include" \
  -I"${LLVM_PROJECT_ROOT}/lldb/source" \
  -I"${LLVM_PROJECT_ROOT}/lldb/source/Plugins/Process/gdb-remote" \
  -I"${LLVM_BUILD_DIR}/tools/lldb/include" \
  -I"${LLVM_BUILD_DIR}/include" \
  -I"${LLVM_PROJECT_ROOT}/llvm/include" \
  -I"${LLVM_PROJECT_ROOT}/clang/include" \
  -I"${LLVM_BUILD_DIR}/tools/clang/include" \
  -I"${WAMR_SOURCE_DIR}/core/iwasm/include" \
  -I"${WAMR_SOURCE_DIR}/core/iwasm/libraries/debug-engine" \
  -I"${WAMR_SOURCE_DIR}/core/iwasm/libraries/thread-mgr" \
  -I"${WAMR_SOURCE_DIR}/core/shared/utils" \
  -I"${WAMR_SOURCE_DIR}/core/shared/platform/linux" \
  -I"${WAMR_SOURCE_DIR}/core/shared/platform/include" \
  -I"${WAMR_SOURCE_DIR}/core/shared/platform/common/posix" \
  ${libxml_include[@]+"${libxml_include[@]}"} \
  -c "${source_file}" \
  -o "${BRIDGE_BUILD_DIR}/dap_browser.cpp.o"

note "bridge object: ${BRIDGE_BUILD_DIR}/dap_browser.cpp.o"
