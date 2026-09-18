cmake_minimum_required(VERSION 3.20)
project(wasmbolt_pipeline_tools LANGUAGES CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "The pipeline tools must be built with Emscripten")
endif()

set(WASMBOLT_LLVM_VERSION "23.1.0")
set(WASMBOLT_LLVM_REVISION
    "ea7d852a70e8bdfaf601d6626a760f9771b2c4b4")

find_package(Git REQUIRED)
find_package(LLVM ${WASMBOLT_LLVM_VERSION} EXACT REQUIRED CONFIG)

include_directories(SYSTEM ${LLVM_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})

set(LLVM_SOURCE_REPOSITORY "" CACHE PATH
    "llvm-project repository containing the pinned LLVM revision")
if(NOT LLVM_SOURCE_REPOSITORY)
  message(FATAL_ERROR "Set LLVM_SOURCE_REPOSITORY")
endif()

execute_process(
  COMMAND "${GIT_EXECUTABLE}" -C "${LLVM_SOURCE_REPOSITORY}" rev-parse
          "${WASMBOLT_LLVM_REVISION}^{commit}"
  OUTPUT_VARIABLE source_revision
  OUTPUT_STRIP_TRAILING_WHITESPACE
  RESULT_VARIABLE source_result
  ERROR_VARIABLE source_error
)
if(NOT source_result EQUAL 0)
  message(FATAL_ERROR
          "Unable to find the pinned LLVM revision: ${source_error}")
endif()
if(NOT "${source_revision}" STREQUAL "${WASMBOLT_LLVM_REVISION}")
  message(FATAL_ERROR "The LLVM source revision does not match the recipe")
endif()

set(GENERATED_SOURCE_DIR "${CMAKE_CURRENT_BINARY_DIR}/llvm-source")
file(MAKE_DIRECTORY
  "${GENERATED_SOURCE_DIR}/opt"
  "${GENERATED_SOURCE_DIR}/llc"
)

function(materialize_llvm_source source output)
  execute_process(
    COMMAND "${GIT_EXECUTABLE}" -C "${LLVM_SOURCE_REPOSITORY}" show
            "${WASMBOLT_LLVM_REVISION}:${source}"
    OUTPUT_FILE "${output}"
    RESULT_VARIABLE result
    ERROR_VARIABLE error
  )
  if(NOT result EQUAL 0)
    message(FATAL_ERROR "Unable to read ${source}: ${error}")
  endif()
endfunction()

materialize_llvm_source(
  llvm/tools/opt/opt.cpp
  "${GENERATED_SOURCE_DIR}/opt/opt.cpp"
)
materialize_llvm_source(
  llvm/tools/llc/llc.cpp
  "${GENERATED_SOURCE_DIR}/llc/llc.cpp"
)
materialize_llvm_source(
  llvm/tools/llc/NewPMDriver.cpp
  "${GENERATED_SOURCE_DIR}/llc/NewPMDriver.cpp"
)
materialize_llvm_source(
  llvm/tools/llc/NewPMDriver.h
  "${GENERATED_SOURCE_DIR}/llc/NewPMDriver.h"
)

function(configure_browser_tool target)
  target_compile_features(${target} PRIVATE cxx_std_20)
  target_compile_options(${target} PRIVATE
    -Oz
    -g0
    -msimd128
    -fwasm-exceptions
    -fno-rtti
    "-sSUPPORT_LONGJMP=wasm"
  )
  target_link_options(${target} PRIVATE
    "SHELL:-Oz"
    "SHELL:-g0"
    "SHELL:-msimd128"
    "SHELL:-fwasm-exceptions"
    "SHELL:-sSUPPORT_LONGJMP=wasm"
    "SHELL:-sMODULARIZE=1"
    "SHELL:-sEXPORT_ES6=1"
    "SHELL:-sALLOW_MEMORY_GROWTH=1"
    "SHELL:-sINITIAL_MEMORY=64MB"
    "SHELL:-sTOTAL_STACK=8MB"
    "SHELL:-sNO_EXIT_RUNTIME=1"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=FS,callMain"
  )
  set_target_properties(${target} PROPERTIES SUFFIX ".js")
endfunction()

add_executable(opt "${GENERATED_SOURCE_DIR}/opt/opt.cpp")
target_link_libraries(opt PRIVATE LLVMOptDriver)
configure_browser_tool(opt)

add_executable(llc
  "${GENERATED_SOURCE_DIR}/llc/llc.cpp"
  "${GENERATED_SOURCE_DIR}/llc/NewPMDriver.cpp"
)
target_include_directories(llc PRIVATE "${GENERATED_SOURCE_DIR}/llc")
llvm_map_components_to_libnames(llc_libraries
  AllTargetsAsmParsers
  AllTargetsCodeGens
  AllTargetsDescs
  AllTargetsInfos
  Analysis
  AsmPrinter
  CodeGen
  CodeGenTypes
  Core
  IPO
  IRPrinter
  IRReader
  MC
  MIRParser
  Passes
  Plugins
  Remarks
  ScalarOpts
  SelectionDAG
  Support
  Target
  TargetParser
  TransformUtils
  Vectorize
)
target_link_libraries(llc PRIVATE ${llc_libraries})
configure_browser_tool(llc)
