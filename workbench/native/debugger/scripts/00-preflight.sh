#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_executable "${EMXX}"
require_executable "${EMCC}"
require_executable "${EMCMAKE}"
require_executable "${NODE_JS}"
require_executable "${PYTHON}"
require_executable "${CMAKE}"
command -v make >/dev/null 2>&1 || die 'make is not available'

version="$(with_emscripten "${EMXX}" --version | head -n 1)"
[[ "${version}" == *"${EMSCRIPTEN_VERSION}"* ]] || {
  die "expected Emscripten ${EMSCRIPTEN_VERSION}, got: ${version}"
}
checkout_revision="$(llvm_revision)"
[[ "${checkout_revision}" == "${LLVM_REVISION}" ]] || {
  die "expected LLVM ${LLVM_REVISION}, got: ${checkout_revision}"
}

note "Emscripten: ${version}"
note "package: ${EMSCRIPTEN_PACKAGE}"
note "LLVM checkout: ${LLVM_PROJECT_ROOT} (${checkout_revision})"
note "persistent work directory: ${WORK_DIR}"

if [[ -f "${CACHE_DIR}/wamr-${WAMR_REVISION}.tar.gz" ]]; then
  verify_sha256 \
    "${CACHE_DIR}/wamr-${WAMR_REVISION}.tar.gz" \
    "${WAMR_ARCHIVE_SHA256}"
  note 'the pinned WAMR archive is cached and verified'
else
  note 'the pinned WAMR archive is not cached; run 10-fetch-wamr.sh'
fi

if [[ -x "${LLVM_NATIVE_BUILD_DIR}/bin/llvm-tblgen" && \
      -x "${LLVM_NATIVE_BUILD_DIR}/bin/clang-tblgen" && \
      -x "${LLVM_NATIVE_BUILD_DIR}/bin/lldb-tblgen" ]]; then
  note 'matching native TableGen tools are present'
else
  note 'native TableGen tools are absent; run 25-build-native-tools.sh'
fi

if [[ -z "${LIBXML2_PREFIX:-}" ]]; then
  note 'LIBXML2_PREFIX is unset; optional LLDB libxml2 support is disabled'
elif [[ ! -f "${LIBXML2_PREFIX}/lib/libxml2.a" ]]; then
  note "libxml2.a is missing below LIBXML2_PREFIX=${LIBXML2_PREFIX}"
else
  note "libxml2 prefix: ${LIBXML2_PREFIX}"
fi

note 'browser execution requires COOP/COEP and SharedArrayBuffer support'
