cmake_minimum_required(VERSION 3.20)
project(WasmBoltSwift LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(LLVM REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
find_package(LLD REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
find_package(Clang REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
find_package(Swift REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
set(SWIFT_HOST_RUNTIME "" CACHE PATH "Threaded Swift runtime build")
set(SWIFT_SOURCE_DIR "" CACHE PATH "Swift source tree")

add_executable(wasmbolt-swift compiler.cpp driver.cpp
  "${SWIFT_SOURCE_DIR}/lib/DriverTool/autolink_extract_main.cpp"
  "${SWIFT_SOURCE_DIR}/lib/DriverTool/modulewrap_main.cpp")
target_include_directories(wasmbolt-swift PRIVATE
  ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS} ${LLD_INCLUDE_DIRS}
  ${SWIFT_INCLUDE_DIRS})
target_compile_options(wasmbolt-swift PRIVATE -fno-exceptions -fno-rtti)
target_link_libraries(wasmbolt-swift PRIVATE
  swiftDriver swiftFrontendTool swiftCompilerModules clangDriver lldWasm lldCommon)
target_link_libraries(wasmbolt-swift PRIVATE
  "${SWIFT_HOST_RUNTIME}/lib/swift/emscripten/wasm32/swiftrt.o"
  "${SWIFT_HOST_RUNTIME}/lib/swift/emscripten/wasm32/libswiftCore.a")

if(EMSCRIPTEN)
  target_link_libraries(wasmbolt-swift PRIVATE uuid)
  target_compile_options(wasmbolt-swift PRIVATE -pthread -fwasm-exceptions)
  target_link_options(wasmbolt-swift PRIVATE
    --emit-symbol-map
    --no-entry -pthread -fwasm-exceptions -O1 -sERROR_ON_UNDEFINED_SYMBOLS=1
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createWasmBoltSwift
    -sENVIRONMENT=web,worker,node -sFILESYSTEM=1 -sFORCE_FILESYSTEM=1
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=536870912
    -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=16777216
    -sPTHREAD_POOL_SIZE=4 -sEXIT_RUNTIME=0 -sASSERTIONS=1
    "-sEXPORTED_FUNCTIONS=['_wb_swift_run','_wb_swift_can_run_again','_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['FS','PThread','ccall','cwrap','UTF8ToString']"
    "-sINCOMING_MODULE_JS_API=['locateFile','print','printErr','noInitialRun','noExitRuntime','wasmBinary']")
endif()
