cmake_minimum_required(VERSION 3.20)
project(wasmbolt_mlir_tools LANGUAGES CXX)

find_package(MLIR 23.1.0 EXACT REQUIRED CONFIG)

file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/mlir-opt-entry.cpp"
  "// MLIRMlirOptMain supplies the upstream main entry point.\n")

get_property(DIALECT_LIBS GLOBAL PROPERTY MLIR_DIALECT_LIBS)
get_property(TRANSLATION_LIBS GLOBAL PROPERTY MLIR_TRANSLATION_LIBS)

add_executable(mlir-opt
  "${CMAKE_CURRENT_BINARY_DIR}/mlir-opt-entry.cpp")
target_link_libraries(mlir-opt PRIVATE MLIRMlirOptMain)

add_executable(mlir-translate mlir-translate.cpp)
target_include_directories(mlir-translate PRIVATE
  ${LLVM_INCLUDE_DIRS}
  ${MLIR_INCLUDE_DIRS}
)
target_link_libraries(mlir-translate PRIVATE
  ${DIALECT_LIBS}
  MLIRIR
  MLIRParser
  MLIRPass
  MLIRSPIRVDialect
  MLIRTranslateLib
  MLIRSupport
  ${TRANSLATION_LIBS}
)

foreach(TOOL mlir-opt mlir-translate)
  target_compile_features(${TOOL} PRIVATE cxx_std_20)
  target_compile_options(${TOOL} PRIVATE
    -O2
    -g0
    -msimd128
    -fwasm-exceptions
    -fno-rtti
    "-sSUPPORT_LONGJMP=wasm"
  )
  target_link_options(${TOOL} PRIVATE
    "SHELL:-Oz"
    "SHELL:-g0"
    "SHELL:-msimd128"
    "SHELL:-fwasm-exceptions"
    "SHELL:-sSUPPORT_LONGJMP=wasm"
    "SHELL:-sMODULARIZE=1"
    "SHELL:-sEXPORT_ES6=1"
    "SHELL:-sALLOW_MEMORY_GROWTH=1"
    "SHELL:-sINITIAL_MEMORY=256MB"
    "SHELL:-sTOTAL_STACK=32MB"
    "SHELL:-sNO_EXIT_RUNTIME=1"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=FS,callMain"
  )
  set_target_properties(${TOOL} PROPERTIES SUFFIX ".js")
endforeach()
