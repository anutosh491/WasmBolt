#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

debugger="${WASMBOLT_DEBUGGER_SOURCE_DIR:-${REPOSITORY_DIR}/debugger/lldb}"
wamr_input="${WASMBOLT_WAMR_INPUT_DIR:-${REPOSITORY_DIR}/debugger/lldb/.work}"
wamr="${wamr_input}/wamr-d7050d9fe672e2d0bc65c44c966cebc0a1aca14b"
mkdir -p "${WORK_DIR}/debugger-bridge"

"${EMSCRIPTEN_ROOT}/em++" -std=c++17 -O2 -pthread -fwasm-exceptions \
  -mtail-call -fno-exceptions -funwind-tables -fno-rtti \
  -Dwait4=__syscall_wait4 -DLLVM_BUILD_STATIC -DLLDB_ENABLE_SWIFT -DHAVE_ROUND \
  -D_FILE_OFFSET_BITS=64 -D_LARGEFILE_SOURCE \
  -D__STDC_CONSTANT_MACROS -D__STDC_FORMAT_MACROS -D__STDC_LIMIT_MACROS \
  -DBH_FREE=wasm_runtime_free -DBH_MALLOC=wasm_runtime_malloc \
  -DBH_PLATFORM_LINUX -DBUILD_TARGET_X86_32 \
  -DWASM_DISABLE_HW_BOUND_CHECK=1 -DWASM_DISABLE_STACK_HW_BOUND_CHECK=1 \
  -DWASM_DISABLE_WAKEUP_BLOCKING_OP=0 -DWASM_ENABLE_AOT_INTRINSICS=0 \
  -DWASM_ENABLE_BULK_MEMORY=1 -DWASM_ENABLE_BULK_MEMORY_OPT=1 \
  -DWASM_ENABLE_CALL_INDIRECT_OVERLONG=1 -DWASM_ENABLE_DEBUG_INTERP=1 \
  -DWASM_ENABLE_EXTENDED_CONST_EXPR=0 -DWASM_ENABLE_FAST_INTERP=0 \
  -DWASM_ENABLE_INTERP=1 -DWASM_ENABLE_MINI_LOADER=0 \
  -DWASM_ENABLE_MULTI_MODULE=0 -DWASM_ENABLE_QUICK_AOT_ENTRY=0 \
  -DWASM_ENABLE_REF_TYPES=1 -DWASM_ENABLE_SHARED_MEMORY=0 \
  -DWASM_ENABLE_SHRUNK_MEMORY=1 -DWASM_ENABLE_THREAD_MGR=1 \
  -DWASM_GLOBAL_HEAP_SIZE=10485760 -DWASM_HAVE_MREMAP=1 -D_GNU_SOURCE \
  -I"${LLVM_SOURCE_DIR}/lldb/tools/lldb-dap" \
  -I"${LLVM_SOURCE_DIR}/lldb/include" -I"${LLVM_SOURCE_DIR}/lldb/source" \
  -I"${LLVM_SOURCE_DIR}/lldb/source/Plugins/Process/gdb-remote" \
  -I"${WORK_DIR}/lldb-wasm/include" -I"${WASM_LLVM_DIR}/include" \
  -I"${LLVM_SOURCE_DIR}/llvm/include" -I"${LLVM_SOURCE_DIR}/clang/include" \
  -I"${WASM_LLVM_DIR}/tools/clang/include" \
  -I"${wamr}/core/iwasm/include" \
  -I"${wamr}/core/iwasm/libraries/debug-engine" \
  -I"${wamr}/core/iwasm/libraries/thread-mgr" \
  -I"${wamr}/core/shared/utils" -I"${wamr}/core/shared/platform/linux" \
  -I"${wamr}/core/shared/platform/include" \
  -I"${wamr}/core/shared/platform/common/posix" \
  -c "${debugger}/bridge/dap_browser.cpp" \
  -o "${WORK_DIR}/debugger-bridge/dap_browser.cpp.o"
