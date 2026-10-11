cmake_minimum_required(VERSION 3.20)
project(WasmBoltSwiftREPL LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
find_package(LLVM REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
find_package(LLD REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
find_package(Clang REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
find_package(Swift REQUIRED CONFIG NO_CMAKE_FIND_ROOT_PATH)
add_executable(wasmbolt-swift-repl repl.cpp)
target_include_directories(wasmbolt-swift-repl PRIVATE ${LLVM_INCLUDE_DIRS}
  ${CLANG_INCLUDE_DIRS} ${LLD_INCLUDE_DIRS} ${SWIFT_INCLUDE_DIRS})
target_compile_options(wasmbolt-swift-repl PRIVATE -fno-rtti -fno-exceptions -pthread -fwasm-exceptions -fno-optimize-sibling-calls)
target_link_libraries(wasmbolt-swift-repl PRIVATE swiftImmediate swiftCompilerModules lldWasm lldCommon
  "${SWIFT_HOST_RUNTIME}/lib/swift/emscripten/wasm32/swiftrt.o"
  "-Wl,--whole-archive"
  "${SWIFT_HOST_RUNTIME}/lib/swift/emscripten/wasm32/libswiftCore.a"
  "${SWIFT_HOST_RUNTIME}/lib/swift/emscripten/wasm32/libswiftSwiftOnoneSupport.a"
  "-Wl,--no-whole-archive" uuid)
set(repl_exports "['_wb_swift_repl_initialize','_wb_swift_repl_execute','_wb_swift_repl_is_complete','_wb_swift_repl_input_number','_malloc','_free']")
if(SWIFT_REPL_RUNTIME_EXPORTS)
  set(repl_exports "@${SWIFT_REPL_RUNTIME_EXPORTS}")
  set_property(TARGET wasmbolt-swift-repl APPEND PROPERTY LINK_DEPENDS "${SWIFT_REPL_RUNTIME_EXPORTS}")
endif()
target_link_options(wasmbolt-swift-repl PRIVATE
  "--embed-file=${SWIFT_REPL_TLS_OBJECT}@/swift/lib/swift/emscripten/wasm32/crtbegin-mt.o"
  "--embed-file=${SWIFT_HOST_RUNTIME}/lib/swift/emscripten/wasm32/swiftrt.o@/swift/lib/swift/emscripten/wasm32/swiftrt.o"
  --no-entry -pthread -fwasm-exceptions -O1 -sMAIN_MODULE=2 -Wl,--export-dynamic
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createSwiftREPL
  -sENVIRONMENT=web,worker,node -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=536870912 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=16777216
  -sPTHREAD_POOL_SIZE=4 -sEXIT_RUNTIME=0 -sASSERTIONS=1
  "-sEXPORTED_FUNCTIONS=${repl_exports}"
  "-sEXPORTED_RUNTIME_METHODS=['FS','PThread','ccall','cwrap','UTF8ToString']"
  "-sINCOMING_MODULE_JS_API=['locateFile','print','printErr','noInitialRun','noExitRuntime','wasmBinary','instantiateWasm']")
