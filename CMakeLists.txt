cmake_minimum_required(VERSION 3.20)
project(wasmbolt LANGUAGES CXX)

find_package(LLVM 23.1 REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)
find_package(LLD REQUIRED CONFIG)

set(EMSCRIPTEN_SYSROOT "" CACHE PATH "Emscripten sysroot to preload")
set(LLVM_WASM_PREFIX "" CACHE PATH "Installed emscripten-forge target packages")
set(CLANG_RESOURCE_TREE "${LLVM_WASM_PREFIX}/lib/clang/${LLVM_VERSION_MAJOR}"
    CACHE PATH "Packaged Clang resource headers")
set(WASMBOLT_RUNTIME_LIBRARIES "" CACHE STRING
    "Optional user libraries to preload (semicolon-separated absolute paths)")
foreach(PATH EMSCRIPTEN_SYSROOT LLVM_WASM_PREFIX CLANG_RESOURCE_TREE)
  if(NOT IS_DIRECTORY "${${PATH}}")
    message(FATAL_ERROR "Set ${PATH} to an existing directory")
  endif()
endforeach()

add_executable(Compiler
  runtime/CompilerModule.cpp
  compilers/clang/Clang.cpp
  linkers/wasm-ld/Linker.cpp)
target_compile_features(Compiler PRIVATE cxx_std_20)
target_compile_options(Compiler PRIVATE -O2 -fPIC -fwasm-exceptions -fno-rtti -mno-tail-call)
target_include_directories(Compiler PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
target_link_libraries(Compiler PRIVATE clangTooling clangFrontendTool lldWasm dl)

# Browser sysroot: SDK and user-package headers, not compiler development files.
set(RUNTIME_ROOT "${CMAKE_CURRENT_BINARY_DIR}/runtime-prefix")
file(REMOVE_RECURSE "${RUNTIME_ROOT}")
file(MAKE_DIRECTORY "${RUNTIME_ROOT}/include" "${RUNTIME_ROOT}/lib")
file(COPY "${EMSCRIPTEN_SYSROOT}/include/" "${LLVM_WASM_PREFIX}/include/"
  DESTINATION "${RUNTIME_ROOT}/include")
foreach(DIR llvm llvm-c clang clang-c lld mlir mlir-c)
  file(REMOVE_RECURSE "${RUNTIME_ROOT}/include/${DIR}")
endforeach()
foreach(LIBRARY IN LISTS WASMBOLT_RUNTIME_LIBRARIES)
  file(COPY "${LIBRARY}" DESTINATION "${RUNTIME_ROOT}/lib" FOLLOW_SYMLINK_CHAIN)
endforeach()

file(GLOB_RECURSE RUNTIME_FILES "${RUNTIME_ROOT}/*" "${CLANG_RESOURCE_TREE}/*")
set_property(TARGET Compiler APPEND PROPERTY LINK_DEPENDS "${RUNTIME_FILES}")

# Match the browser ABI while allowing large compilation jobs to grow the heap.
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(WASMBOLT_MAXIMUM_MEMORY "16GB")
else()
  set(WASMBOLT_MAXIMUM_MEMORY "4GB")
endif()

target_link_options(Compiler PRIVATE
  -O2 -fwasm-exceptions -mno-tail-call
  "-sMODULARIZE=1" "-sEXPORT_ES6=1"
  "-sALLOW_MEMORY_GROWTH=1" "-sMAXIMUM_MEMORY=${WASMBOLT_MAXIMUM_MEMORY}" "-sINITIAL_MEMORY=256MB" "-sSTACK_SIZE=32MB"
  "-sMAIN_MODULE=1" "-sEXIT_RUNTIME=0"
  "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,loadDynamicLibrary"
  "--preload-file=${RUNTIME_ROOT}/include@/include"
  "--preload-file=${RUNTIME_ROOT}/lib@/lib"
  "--preload-file=${CLANG_RESOURCE_TREE}@/lib/clang/${LLVM_VERSION_MAJOR}")
