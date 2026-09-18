#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

bridge="${BRIDGE_BUILD_DIR}/dap_browser.cpp.o"
wamr="${WAMR_BUILD_DIR}/libvmlib.a"
response="$(find_lldb_link_response)"

require_file "${bridge}"
require_file "${wamr}"
[[ -n "${response}" ]] || die 'lldb-dap linkLibs.rsp was not generated'
require_file "${response}"
mkdir -p "${OUTPUT_DIR}"

runtime_methods='ccall,UTF8ToString,FS,FS_createDataFile,'
runtime_methods+='FS_unlink,FS_createPath'
incoming_module_api='mainScriptUrlOrBlob,noInitialRun,locateFile,wasmBinary,'
incoming_module_api+='instantiateWasm,print,printErr,onAbort'
worker="${DEBUGGER_DIR}/bridge/lldb-dap.worker.js"
optimization="${WASMBOLT_LINK_OPTIMIZATION:--O2}"

require_file "${worker}"

# Entries in linkLibs.rsp are relative to lldb-dap's tool build directory.
response_dir="$(dirname -- "${response}")"
link_dir="$(dirname -- "$(dirname -- "${response_dir}")")"
response_rel="${response#"${link_dir}/"}"

(
  cd -- "${link_dir}"
  with_emscripten env BINARYEN_CORES="${JOBS}" "${EMXX}" \
    "${optimization}" -fwasm-exceptions -pthread -mtail-call -Wl,--gc-sections \
    "${bridge}" \
    "${wamr}" \
    @"${response_rel}" \
    -o "${OUTPUT_DIR}/lldb-dap.js" \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=createLLDBDAPModule \
    -sPTHREAD_POOL_SIZE=16 \
    -sPTHREAD_POOL_SIZE_STRICT=0 \
    -sINITIAL_MEMORY=512MB \
    -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=2GB \
    -sSTACK_SIZE=16MB \
    -sNO_EXIT_RUNTIME=1 \
    -sINCOMING_MODULE_JS_API="${incoming_module_api}" \
    -sEXPORTED_RUNTIME_METHODS="${runtime_methods}"
)

cp "${worker}" "${OUTPUT_DIR}/lldb-dap.worker.js"
require_file "${OUTPUT_DIR}/lldb-dap.js"
require_file "${OUTPUT_DIR}/lldb-dap.wasm"
require_file "${OUTPUT_DIR}/lldb-dap.worker.js"
note "JavaScript: $(sha256_file "${OUTPUT_DIR}/lldb-dap.js")"
note "WebAssembly: $(sha256_file "${OUTPUT_DIR}/lldb-dap.wasm")"
note "pthread Worker: $(sha256_file "${OUTPUT_DIR}/lldb-dap.worker.js")"
