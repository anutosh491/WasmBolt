#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

archive="${CACHE_DIR}/wamr-${WAMR_REVISION}.tar.gz"
stamp="${WAMR_SOURCE_DIR}/.wasmbolt-wamr-revision"
patch_file="${DEBUGGER_DIR}/patches/wamr-embedded-debug.patch"
ctors_patch="${DEBUGGER_DIR}/patches/wamr-wasi-command-ctors.patch"

mkdir -p "${CACHE_DIR}" "${WORK_DIR}"
require_file "${patch_file}"
require_file "${ctors_patch}"

apply_ctors_patch() {
  if ! patch --directory="$1" --strip=1 --reverse --dry-run \
      <"${ctors_patch}" >/dev/null 2>&1; then
    patch --directory="$1" --strip=1 --dry-run <"${ctors_patch}"
    patch --directory="$1" --strip=1 <"${ctors_patch}"
  fi
}

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
  apply_ctors_patch "${WAMR_SOURCE_DIR}"
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
apply_ctors_patch "${extract_dir}"
printf '%s\n' "${WAMR_REVISION}" \
  >"${extract_dir}/.wasmbolt-wamr-revision"
mv "${extract_dir}" "${WAMR_SOURCE_DIR}"
trap - EXIT

note "prepared WAMR source: ${WAMR_SOURCE_DIR}"

