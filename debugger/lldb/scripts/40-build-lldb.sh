#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$({ cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; })"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_file "${LLVM_BUILD_DIR}/CMakeCache.txt"
response="$(find_lldb_link_response)"
[[ -n "${response}" ]] || die 'lldb-dap linkLibs.rsp was not generated'
require_file "${response}"

# The final browser module is linked by 50-link-debugger.sh. Building CMake's
# lldb-dap target here would perform an unnecessary executable link first.
# Convert the archive paths into their logical CMake targets so dependency
# tracking remains effective on incremental rebuilds. lib/liblldb.a is the one
# exceptional spelling: its target is "liblldb" because "lldb" names the
# standalone driver.
dependency_make="$(dirname -- "${response}")/build.make"
require_file "${dependency_make}"
# Archive paths contain no whitespace in this pinned build tree.
# shellcheck disable=SC2207
archives=($(awk '/^bin\/lldb-dap\.js: lib\/.*\.a$/ {print $2}' \
  "${dependency_make}" | sort -u))
[[ "${#archives[@]}" -gt 0 ]] || die 'no lldb-dap archive dependencies found'

archive_targets=()
for archive in "${archives[@]}"; do
  target="$(basename -- "${archive}" .a)"
  target="${target#lib}"
  if [[ "${target}" == lldb ]]; then
    target=liblldb
  fi
  archive_targets+=("${target}")
done

with_emscripten "${CMAKE}" --build "${LLVM_BUILD_DIR}" \
  --target "${archive_targets[@]}" --parallel "${JOBS}"

for archive in "${archives[@]}"; do
  require_file "${LLVM_BUILD_DIR}/${archive}"
done

note "LLDB link response: ${response}"
note "LLDB archive dependencies: ${#archives[@]}"
note "SHA-256: $(sha256_file "${response}")"
