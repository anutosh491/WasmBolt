#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

while IFS=$'\t' read -r url revision destination; do
  if [[ ! -e "${destination}" ]]; then
    git clone --filter=blob:none --no-checkout "${url}" "${destination}"
    git -C "${destination}" fetch --depth=1 origin "${revision}"
    git -C "${destination}" checkout --detach "${revision}"
  fi
  actual="$(git -C "${destination}" rev-parse HEAD)"
  if [[ "${actual}" != "${revision}" ]]; then
    printf 'Wrong revision at %s: %s\n' "${destination}" "${actual}" >&2
    exit 1
  fi
done < <("${PYTHON}" - "${PROJECT_DIR}/sources.json" \
  "${SWIFT_DEV_DIR}" "${LLVM_SOURCE_DIR}" <<'PY'
import json
from pathlib import Path
import sys
sources = json.loads(Path(sys.argv[1]).read_text())
for name, directory in [('swift', 'swift'), ('cmark', 'cmark'),
                        ('stringProcessing',
                         'swift-experimental-string-processing'),
                        ('llvm', None)]:
    target = Path(sys.argv[2]) / directory if directory else Path(sys.argv[3])
    entry = sources[name]
    print(entry['url'], entry['revision'], target, sep='\t')
PY
)

apply_patch() {
  if git -C "$1" apply --reverse --check "$2"; then
    printf 'Already applied: %s\n' "$2"
  else
    git -C "$1" apply --check "$2"
    git -C "$1" apply "$2"
  fi
}
apply_patch "${SWIFT_SOURCE_DIR}" \
  "${PROJECT_DIR}/patches/swift-browser-host.patch"
apply_patch "${SWIFT_SOURCE_DIR}" \
  "${PROJECT_DIR}/patches/swift-driver-executor.patch"
