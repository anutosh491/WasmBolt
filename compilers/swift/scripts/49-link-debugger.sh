#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

debugger="${WASMBOLT_DEBUGGER_SOURCE_DIR:-${REPOSITORY_DIR}/debugger/lldb}"
wamr_input="${WASMBOLT_WAMR_INPUT_DIR:-${REPOSITORY_DIR}/debugger/lldb/.work}"
"${PYTHON}" "${PROJECT_DIR}/scripts/49-link-debugger.py" \
  --ninja "${NINJA}" --build "${WORK_DIR}/lldb-wasm" \
  --bridge "${WORK_DIR}/debugger-bridge/dap_browser.cpp.o" \
  --wamr "${wamr_input}/wamr-build/libvmlib.a" \
  --swift-runtime "${WORK_DIR}/stdlib-host-wasm" \
  --worker "${debugger}/bridge/lldb-dap.worker.js" \
  --output "${WORK_DIR}/output"
