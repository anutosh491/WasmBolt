#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

archive="${CACHE_DIR}/wamr-${WAMR_REVISION}.tar.gz"
stamp="${WAMR_SOURCE_DIR}/.wasmbolt-wamr-revision"
patch_file="${DEBUGGER_DIR}/patches/wamr-embedded-debug.patch"

mkdir -p "${CACHE_DIR}" "${WORK_DIR}"
require_file "${patch_file}"

if [[ ! -f "${archive}" ]]; then
  note "downloading WAMR ${WAMR_REVISION}"
  curl --fail --location --retry 3 \
    --output "${archive}" "${WAMR_ARCHIVE_URL}"
fi
verify_sha256 "${archive}" "${WAMR_ARCHIVE_SHA256}"

if [[ -f "${stamp}" ]]; then
  [[ "$(<"${stamp}")" == "${WAMR_REVISION}" ]] || {
    die "unexpected WAMR revision in ${stamp}"
  }
  note "WAMR source is already prepared: ${WAMR_SOURCE_DIR}"
  exit 0
fi

[[ ! -e "${WAMR_SOURCE_DIR}" ]] || {
  die "unverified source directory exists: ${WAMR_SOURCE_DIR}"
}

extract_dir="$(mktemp -d "${WORK_DIR}/wamr-extract.XXXXXX")"
cleanup() {
  rm -rf -- "${extract_dir}"
}
trap cleanup EXIT

tar -xzf "${archive}" --strip-components=1 -C "${extract_dir}"
patch --directory="${extract_dir}" --strip=1 \
  --dry-run <"${patch_file}"
patch --directory="${extract_dir}" --strip=1 <"${patch_file}"
printf '%s\n' "${WAMR_REVISION}" \
  >"${extract_dir}/.wasmbolt-wamr-revision"
mv "${extract_dir}" "${WAMR_SOURCE_DIR}"
trap - EXIT

note "prepared WAMR source: ${WAMR_SOURCE_DIR}"

