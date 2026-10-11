cmake_minimum_required(VERSION 3.20)
project(wasmbolt_wamr_runtime C)

if(NOT WAMR_ROOT_DIR)
  message(FATAL_ERROR "Set WAMR_ROOT_DIR to the WAMR source directory")
endif()

# The browser debugger interprets a guest Wasm module. AOT and both JITs are
# unrelated. WAMR's debug interpreter requires the classic interpreter and
# internally enables the thread manager.
set(WAMR_BUILD_PLATFORM "linux")
set(WAMR_BUILD_TARGET "X86_32")
set(WAMR_BUILD_INTERP 1)
set(WAMR_BUILD_FAST_INTERP 0)
set(WAMR_BUILD_AOT 0)
set(WAMR_BUILD_JIT 0)
set(WAMR_BUILD_FAST_JIT 0)
set(WAMR_BUILD_LIBC_BUILTIN 0)
set(WAMR_BUILD_LIBC_WASI 0)
set(WAMR_BUILD_LIBC_EMCC 0)
set(WAMR_BUILD_DEBUG_INTERP 1)
set(WAMR_BUILD_THREAD_MGR 0)
set(WAMR_BUILD_INVOKE_NATIVE_GENERAL 1)
set(WAMR_DISABLE_HW_BOUND_CHECK 1)

include("${WAMR_ROOT_DIR}/build-scripts/runtime_lib.cmake")

add_library(vmlib STATIC ${WAMR_RUNTIME_LIB_SOURCE})
target_compile_options(vmlib PRIVATE
  -O2
  -pthread
  -include "${CMAKE_CURRENT_SOURCE_DIR}/wamr_emscripten_wasi_compat.h"
)

