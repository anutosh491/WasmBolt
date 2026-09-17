cmake_minimum_required(VERSION 3.20)
project(wasmbolt LANGUAGES CXX)

find_package(LLVM REQUIRED CONFIG)
find_package(LLD REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)
find_package(MLIR REQUIRED CONFIG)
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
foreach(PATTERN "int main(int argc, char **argv) {" "  InitLLVM X(argc, argv);")
  string(FIND "${LLC_DRIVER_SOURCE}" "${PATTERN}" OFFSET)
  if(OFFSET EQUAL -1)
    message(FATAL_ERROR "The llc source does not match the pinned version")
  endif()
endforeach()
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

add_executable(WasmBoltMlirOpt src/MlirOptDriver.cpp)
target_compile_features(WasmBoltMlirOpt PRIVATE cxx_std_20)
target_compile_options(WasmBoltMlirOpt PRIVATE -fPIC -fwasm-exceptions -fno-rtti)
target_include_directories(WasmBoltMlirOpt PRIVATE
  ${LLVM_INCLUDE_DIRS}
  ${MLIR_INCLUDE_DIRS}
)
target_link_libraries(WasmBoltMlirOpt PRIVATE MLIRMlirOptMain)
target_link_options(WasmBoltMlirOpt PRIVATE
  "SHELL:-Oz"
  "SHELL:-fwasm-exceptions"
  "SHELL:-sSIDE_MODULE=2"
  "SHELL:-Wl,-Bsymbolic"
  "SHELL:-Wl,--export=wasmbolt_mlir_opt_main"
)
set_target_properties(WasmBoltMlirOpt PROPERTIES
  PREFIX ""
  OUTPUT_NAME "WasmBoltMlirOpt"
  SUFFIX ".so"
)

add_executable(Compiler src/CompilerModule.cpp)
add_dependencies(Compiler WasmBoltMlirOpt)
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
  "${RUNTIME_ROOT}/include/lld"
  # mlir-opt is provided as a compiled side module. Its development headers
  # are not required by the driver and add more than 100 MB to the preload.
  "${RUNTIME_ROOT}/include/mlir"
  "${RUNTIME_ROOT}/include/mlir-c")

file(GLOB RUNTIME_LIBRARY_CANDIDATES
  "${CMAKE_PREFIX_PATH}/lib/*.so*"
  "${CMAKE_PREFIX_PATH}/lib/*.wasm"
  "${CMAKE_PREFIX_PATH}/lib/libfmt*.a")
set(RUNTIME_LIBRARY_LINKS "")
foreach(LIBRARY_PATH IN LISTS RUNTIME_LIBRARY_CANDIDATES)
  if(IS_SYMLINK "${LIBRARY_PATH}")
    file(REAL_PATH "${LIBRARY_PATH}" LIBRARY_TARGET)
    if(NOT LIBRARY_TARGET IN_LIST RUNTIME_LIBRARY_CANDIDATES)
      message(FATAL_ERROR
        "Runtime library target is not packaged: ${LIBRARY_PATH}")
    endif()
    get_filename_component(LIBRARY_NAME "${LIBRARY_PATH}" NAME)
    get_filename_component(LIBRARY_TARGET "${LIBRARY_TARGET}" NAME)
    string(APPEND RUNTIME_LIBRARY_LINKS
      "  FS.symlink('/lib/${LIBRARY_TARGET}', '/lib/${LIBRARY_NAME}');\n")
  else()
    file(COPY "${LIBRARY_PATH}" DESTINATION "${RUNTIME_ROOT}/lib")
  endif()
endforeach()

# Emscripten's file packager dereferences symlinks. Recreate library aliases
# in the browser filesystem instead of preloading their contents repeatedly.
set(RUNTIME_LINKS_SCRIPT "${CMAKE_CURRENT_BINARY_DIR}/library-links.js")
file(WRITE "${RUNTIME_LINKS_SCRIPT}"
  "(Module['preRun'] ??= []).push(() => {\n"
  "  FS.mkdirTree('/lib');\n"
  "${RUNTIME_LIBRARY_LINKS}"
  "});\n")
set_property(TARGET Compiler APPEND PROPERTY LINK_DEPENDS
  "${RUNTIME_LINKS_SCRIPT}")

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
  "SHELL:-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,loadDynamicLibrary"
  "SHELL:--pre-js=${RUNTIME_LINKS_SCRIPT}"
  "SHELL:--preload-file=${RUNTIME_ROOT}/include@/include"
  "SHELL:--preload-file=${RUNTIME_ROOT}/lib@/lib"
  "SHELL:--preload-file=${CLANG_RESOURCE_TREE}@${CLANG_RESOURCE_DIR}"
)
