cmake_minimum_required(VERSION 3.20)
project(wasmbolt LANGUAGES CXX)

find_package(LLVM REQUIRED CONFIG)
find_package(LLD REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)
find_package(Graphviz REQUIRED CONFIG)

set(EMSCRIPTEN_SYSROOT "" CACHE PATH
    "Emscripten sysroot to preload into the browser filesystem")
set(CLANG_RESOURCE_TREE "" CACHE PATH
    "Versioned Clang resource directory to preload")
set(CLANG_RESOURCE_DIR "/lib/clang/${LLVM_VERSION_MAJOR}" CACHE STRING
    "Clang resource directory visible inside the browser filesystem")
set(LLVM_SOURCE_TREE "" CACHE PATH
    "LLVM source tree matching the packaged LLVM libraries")

if(NOT EMSCRIPTEN_SYSROOT)
  message(FATAL_ERROR "Set EMSCRIPTEN_SYSROOT to the Emscripten sysroot")
endif()
if(NOT CLANG_RESOURCE_TREE)
  message(FATAL_ERROR "Set CLANG_RESOURCE_TREE to Clang's resource directory")
endif()
if(NOT LLVM_SOURCE_TREE)
  message(FATAL_ERROR "Set LLVM_SOURCE_TREE to the matching llvm-project checkout")
endif()

# Build the version-matched llc sources into this browser module and turn its
# main() into a callable entry point. The only source adjustment removes
# InitLLVM: its destructor calls llvm_shutdown(), which is invalid for a
# long-lived browser process that invokes llc more than once.
set(LLC_SOURCE_DIR "${LLVM_SOURCE_TREE}/llvm/tools/llc")
file(READ "${LLC_SOURCE_DIR}/llc.cpp" LLC_DRIVER_SOURCE)
string(REPLACE
  "int main(int argc, char **argv) {"
  "extern \"C\" int wasmbolt_llc_main(int argc, char **argv) {"
  LLC_DRIVER_SOURCE "${LLC_DRIVER_SOURCE}")
string(REPLACE
  "  InitLLVM X(argc, argv);\n"
  ""
  LLC_DRIVER_SOURCE "${LLC_DRIVER_SOURCE}")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/generated/llc-driver.cpp"
  "${LLC_DRIVER_SOURCE}")

add_library(LLVMLlcDriver STATIC
  "${CMAKE_CURRENT_BINARY_DIR}/generated/llc-driver.cpp"
  "${LLC_SOURCE_DIR}/NewPMDriver.cpp"
)
target_compile_features(LLVMLlcDriver PRIVATE cxx_std_20)
target_compile_options(LLVMLlcDriver PRIVATE -fPIC -fwasm-exceptions -fno-rtti)
target_include_directories(LLVMLlcDriver PRIVATE
  ${LLVM_INCLUDE_DIRS}
  "${LLC_SOURCE_DIR}"
)
target_link_libraries(LLVMLlcDriver PUBLIC LLVMMIRParser)

add_executable(Compiler CompilerModule.cpp)
target_compile_features(Compiler PRIVATE cxx_std_20)
target_compile_options(Compiler PRIVATE -fPIC -fwasm-exceptions -fno-rtti)
target_include_directories(Compiler PRIVATE
  ${LLVM_INCLUDE_DIRS}
  ${CLANG_INCLUDE_DIRS}
)
target_link_libraries(Compiler PRIVATE
  LLVMLlcDriver
  clangTooling
  clangFrontendTool
  lldWasm
  Graphviz::graphviz
  dl
)

# Reproduce the single Emscripten/conda prefix in the browser. Toolchain
# archives are already linked into Compiler.wasm, so do not duplicate those
# hundreds of megabytes in Compiler.data. Public package headers, side modules,
# and the small compiled libraries used by examples retain normal prefix paths.
set(RUNTIME_ROOT "${CMAKE_CURRENT_BINARY_DIR}/runtime-prefix")
file(REMOVE_RECURSE "${RUNTIME_ROOT}")
file(MAKE_DIRECTORY "${RUNTIME_ROOT}/include" "${RUNTIME_ROOT}/lib")
file(COPY "${EMSCRIPTEN_SYSROOT}/include/"
  DESTINATION "${RUNTIME_ROOT}/include")
file(COPY "${CMAKE_PREFIX_PATH}/include/"
  DESTINATION "${RUNTIME_ROOT}/include")
# Keep user-facing package headers while avoiding a second copy of LLVM's
# development headers. Recursive PATTERN exclusions are intentionally avoided:
# they also match valid package paths such as boost/config/compiler/clang.hpp.
file(REMOVE_RECURSE
  "${RUNTIME_ROOT}/include/llvm"
  "${RUNTIME_ROOT}/include/llvm-c"
  "${RUNTIME_ROOT}/include/clang"
  "${RUNTIME_ROOT}/include/clang-c"
  "${RUNTIME_ROOT}/include/lld")

file(GLOB RUNTIME_LIBRARY_CANDIDATES
  "${CMAKE_PREFIX_PATH}/lib/*.so*"
  "${CMAKE_PREFIX_PATH}/lib/*.wasm"
  "${CMAKE_PREFIX_PATH}/lib/libfmt*.a")
foreach(LIBRARY_PATH IN LISTS RUNTIME_LIBRARY_CANDIDATES)
  file(COPY "${LIBRARY_PATH}" DESTINATION "${RUNTIME_ROOT}/lib"
       FOLLOW_SYMLINK_CHAIN)
endforeach()

target_link_options(Compiler PRIVATE
  "SHELL:-O2"
  "SHELL:-fwasm-exceptions"
  "SHELL:-sMODULARIZE=1"
  "SHELL:-sEXPORT_ES6=1"
  "SHELL:-sALLOW_MEMORY_GROWTH=1"
  "SHELL:-sINITIAL_MEMORY=256MB"
  "SHELL:-sTOTAL_STACK=32MB"
  "SHELL:-sMAIN_MODULE=1"
  "SHELL:-sNO_EXIT_RUNTIME=1"
  "SHELL:-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS"
  "SHELL:--preload-file=${RUNTIME_ROOT}/include@/include"
  "SHELL:--preload-file=${RUNTIME_ROOT}/lib@/lib"
  "SHELL:--preload-file=${CLANG_RESOURCE_TREE}@${CLANG_RESOURCE_DIR}"
)

foreach(FILE index.html app.js styles.css)
  configure_file(${FILE} ${FILE} COPYONLY)
endforeach()
