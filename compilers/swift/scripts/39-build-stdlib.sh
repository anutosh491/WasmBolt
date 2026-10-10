#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

[[ -x "${NATIVE_SWIFT_DIR}/bin/swift-frontend" ]] || {
  printf 'Build the native Swift frontend first.\n' >&2
  exit 1
}
mode="${1:-guest}"
case "${mode}" in
  guest) build=stdlib-wasm ;;
  host) build=stdlib-host-wasm ;;
  *) printf 'Expected guest or host, got %s\n' "${mode}" >&2; exit 1 ;;
esac
"${CMAKE}" --build "${WORK_DIR}/${build}" --parallel 2 \
  --target swift-stdlib-emscripten-wasm32
