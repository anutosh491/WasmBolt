#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../scripts/common.sh"

sample="${1:-scalar}"
case "${sample}" in
  scalar|arrays) ;;
  *) printf 'Unknown sample: %s\n' "${sample}" >&2; exit 1 ;;
esac
output="${WORK_DIR}/native-tests/${sample}"
mkdir -p "${output}"
cp "${PROJECT_DIR}/tests/${sample}.swift" "${output}/main.swift"
frontend=("${NATIVE_SWIFT_DIR}/bin/swift-frontend"
  -target wasm32-unknown-emscripten
  -sdk "${EMSCRIPTEN_ROOT}/cache/sysroot"
  -resource-dir "${WORK_DIR}/stdlib-wasm/lib/swift"
  -module-name WasmBolt -num-threads 1
  -disable-implicit-concurrency-module-import
  -disable-implicit-string-processing-module-import
  -Xcc -isystem -Xcc "${EMSCRIPTEN_ROOT}/cache/sysroot/include/compat"
  -Xcc -fPIC -Xcc -mno-reference-types
  -Xcc "-resource-dir=${WASM_LLVM_DIR}/lib/clang/23"
  -Onone -gdwarf-types -dwarf-version=4
  -debug-prefix-map "${output}=/workspace")
"${frontend[@]}" -dump-ast "${output}/main.swift" > "${output}/ast.txt"
"${frontend[@]}" -emit-ir "${output}/main.swift" -o "${output}/output.ll"
"${frontend[@]}" -S "${output}/main.swift" -o "${output}/output.s"
"${frontend[@]}" -emit-object "${output}/main.swift" -o "${output}/output.o"
printf 'Native Swift frontend produced AST, IR, assembly and a Wasm object.\n'

runtime="${WORK_DIR}/stdlib-wasm/lib/swift/emscripten/wasm32"
"${EMSCRIPTEN_ROOT}/em++" -O0 -g -fno-exceptions -mno-reference-types \
  -sSTANDALONE_WASM=1 -sSTACK_SIZE=16777216 -sENVIRONMENT=node \
  -sMODULARIZE=1 -sEXPORT_ES6=1 "${output}/output.o" \
  -Wl,--export-if-defined=add,--export=__wasm_call_ctors \
  -Wl,--export-if-defined=__main_argc_argv \
  "${runtime}/swiftrt.o" -L"${runtime}" \
  -lswiftSwiftOnoneSupport -lswiftCore -lswiftCommandLineSupport \
  -o "${output}/program.mjs"
"${NODE}" --input-type=module -e \
  'const { default: create } = await import(process.argv[1]); await create();' \
  "${output}/program.mjs"
