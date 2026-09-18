cmake_minimum_required(VERSION 3.20)
project(wasmbolt LANGUAGES CXX)

find_package(LLVM REQUIRED CONFIG)
find_package(LLD REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)
find_package(Graphviz REQUIRED CONFIG)

# Keep the pinned toolchain's ABI flags explicit. Its EMCC_CFLAGS also appends
# -O2, which would override the size optimization selected at link time.
add_compile_options(-O2 -g0 -msimd128 "-sSUPPORT_LONGJMP=wasm")
add_link_options(-g0 -msimd128 "-sSUPPORT_LONGJMP=wasm")

set(EMSCRIPTEN_SYSROOT "" CACHE PATH
    "Emscripten sysroot to preload into the browser filesystem")
set(CLANG_RESOURCE_TREE "" CACHE PATH
    "Versioned Clang resource directory to preload")
set(CLANG_RESOURCE_DIR "/lib/clang/${LLVM_VERSION_MAJOR}" CACHE STRING
    "Clang resource directory visible inside the browser filesystem")
set(EXPORTED_RUNTIME_METHODS
    "ccall,cwrap,FS,loadDynamicLibrary,getWasmTableEntry")

if(NOT EMSCRIPTEN_SYSROOT)
  message(FATAL_ERROR "Set EMSCRIPTEN_SYSROOT to the Emscripten sysroot")
endif()
if(NOT CLANG_RESOURCE_TREE)
  message(FATAL_ERROR "Set CLANG_RESOURCE_TREE to Clang's resource directory")
endif()
add_executable(Compiler src/CompilerModule.cpp)
target_compile_features(Compiler PRIVATE cxx_std_20)
target_compile_options(Compiler PRIVATE -fPIC -fwasm-exceptions -fno-rtti)
target_include_directories(Compiler PRIVATE
  ${LLVM_INCLUDE_DIRS}
  ${CLANG_INCLUDE_DIRS}
)
target_link_libraries(Compiler PRIVATE
  clangTooling
  clangFrontendTool
  lldWasm
  Graphviz::graphviz
  dl
)

# Keep only the Emscripten sysroot in the core preload. Emscripten-forge
# packages are produced independently by empack and restored by the worker, so
# adding a library does not inflate Compiler.data.
set(RUNTIME_ROOT "${CMAKE_CURRENT_BINARY_DIR}/runtime-prefix")
file(REMOVE_RECURSE "${RUNTIME_ROOT}")
file(MAKE_DIRECTORY "${RUNTIME_ROOT}/include" "${RUNTIME_ROOT}/lib")
file(COPY "${EMSCRIPTEN_SYSROOT}/include/"
  DESTINATION "${RUNTIME_ROOT}/include")

# Favor download size while retaining exports for arbitrary user side modules.
target_link_options(Compiler PRIVATE
  "SHELL:-Oz"
  "SHELL:-fwasm-exceptions"
  "SHELL:-sMODULARIZE=1"
  "SHELL:-sEXPORT_ES6=1"
  "SHELL:-sALLOW_MEMORY_GROWTH=1"
  "SHELL:-sINITIAL_MEMORY=256MB"
  "SHELL:-sTOTAL_STACK=32MB"
  "SHELL:-sMAIN_MODULE=1"
  "SHELL:-sNO_EXIT_RUNTIME=1"
  "SHELL:-sEXPORTED_RUNTIME_METHODS=${EXPORTED_RUNTIME_METHODS}"
  "SHELL:--preload-file=${RUNTIME_ROOT}/include@/include"
  "SHELL:--preload-file=${RUNTIME_ROOT}/lib@/lib"
  "SHELL:--preload-file=${CLANG_RESOURCE_TREE}@${CLANG_RESOURCE_DIR}"
)
