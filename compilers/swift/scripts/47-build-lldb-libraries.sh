#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

mode="${1:-all}"
case "${mode}" in
  all|--swift-only) ;;
  *) printf 'Expected all or --swift-only.\n' >&2; exit 1 ;;
esac

targets_file="${WORK_DIR}/lldb-swift-targets.txt"
"${NINJA}" -C "${WORK_DIR}/lldb-wasm" -t inputs lldb-dap |
  "${PYTHON}" -c '
import pathlib, sys
prefix = pathlib.Path(sys.argv[1]).resolve() / "lib"
targets = sorted({pathlib.Path(s.strip()).stem[3:] for s in sys.stdin
                  if pathlib.Path(s.strip()).parent == prefix
                  and s.strip().endswith(".a")})
print("\n".join(targets))
' "${WASM_SWIFT_DIR}" >"${targets_file}"
targets=(swiftFrontendTool)
while IFS= read -r target; do
  [[ -n "${target}" ]] && targets+=("${target}")
done <"${targets_file}"
"${CMAKE}" --build "${WASM_SWIFT_DIR}" --parallel "${JOBS}" \
  --target "${targets[@]}"
[[ "${mode}" != --swift-only ]] || exit 0
"${PYTHON}" "${PROJECT_DIR}/scripts/build-llvm-dependencies.py" \
  --ninja "${NINJA}" --cmake "${CMAKE}" \
  --consumer "${WORK_DIR}/lldb-wasm" --llvm "${WASM_LLVM_DIR}" \
  --jobs "${JOBS}" lldb-dap
"${CMAKE}" --build "${WORK_DIR}/lldb-wasm" --parallel "${JOBS}" \
  --target liblldb lldbDAP
