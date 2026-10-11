#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

foundation="${WORK_DIR}/foundation-host-sdk/lib/swift"
runtime="${WORK_DIR}/stdlib-host-wasm/lib/swift"
repl="${WASMBOLT_SWIFT_REPL_WORK_DIR:-${WORK_DIR}/repl}"
[[ -f "${foundation}/emscripten/wasm32/libFoundation.a" ]] || {
  printf 'Run 41-build-foundation.sh host first.\n' >&2; exit 1;
}
# Emscripten's linker needs the recorded location-relative relocation fix too.
linker="${WASMBOLT_SWIFT_NATIVE_WASM_LD:-${NATIVE_LLVM_DIR}/bin/wasm-ld}"
if [[ ! -x "${linker}" ]]; then
  "${CMAKE}" --build "${NATIVE_LLVM_DIR}" --parallel "${JOBS}" --target lld
fi
tools="${repl}/link-tools"
mkdir -p "${tools}" "${repl}/foundation"
for tool in "${EMSDK_ROOT}/upstream/bin/"*; do
  [[ -f "${tool}" && "$(basename -- "${tool}")" != wasm-ld ]] || continue
  ln -sf "${tool}" "${tools}/$(basename -- "${tool}")"
done
ln -sf "${linker}" "${tools}/wasm-ld"
libraries=("${foundation}/emscripten/wasm32/"*.a)
for name in Synchronization _Concurrency _StringProcessing _RegexParser EmscriptenLibc; do
  libraries+=("${runtime}/emscripten/wasm32/libswift${name}.a")
done
EM_LLVM_ROOT="${tools}" EM_CACHE="${repl}/link-cache" \
  "${EMSCRIPTEN_ROOT}/em++" -shared -sSIDE_MODULE=2 \
  -pthread -fwasm-exceptions -O2 -Wl,-Bsymbolic,--export-dynamic \
  "${runtime}/emscripten/wasm32/swiftrt.o" \
  -Wl,--whole-archive "${libraries[@]}" -Wl,--no-whole-archive \
  -o "${repl}/foundation/libFoundation.so"

"${PYTHON}" - "${foundation}" "${runtime}" "${repl}" "${libraries[@]}" <<'PY'
import gzip, io, json, pathlib, sys, tarfile
foundation, runtime, repl = map(pathlib.Path, sys.argv[1:4])
entries = {}
for root in [foundation]:
    for source in root.rglob('*'):
        if source.is_file() and source.suffix not in ['.a', '.o']:
            entries[f'swift/lib/swift/{source.relative_to(root)}'] = source.read_bytes()
entries['swift/lib/swift/emscripten/libFoundation.so'] = (
    repl / 'foundation/libFoundation.so').read_bytes()
entries['swift/lib/swift/emscripten/repl-libraries.json'] = json.dumps(
    [pathlib.Path(name).stem.removeprefix('lib') for name in sys.argv[4:]]).encode()
with (repl / 'repl-foundation.tar.gz').open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for name, data in sorted(entries.items()):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
                archive.addfile(entry, io.BytesIO(data))
print('Packaged', repl / 'repl-foundation.tar.gz')
PY

# MAIN_MODULE=2 retains only requested runtime functions. Keep the actual
# side-module imports available without preloading Foundation at REPL startup.
"${NODE}" --input-type=module - "${repl}" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = join(process.argv[2], 'foundation');
const module = await WebAssembly.compile(readFileSync(join(directory, 'libFoundation.so')));
const defined = new Set(WebAssembly.Module.exports(module).map(entry => entry.name));
const names = WebAssembly.Module.imports(module)
  .filter(entry => entry.module === 'GOT.func' || entry.kind === 'function')
  .map(entry => entry.name)
  .filter(name => !defined.has(name) && !name.startsWith('invoke_'));
names.push('wb_swift_repl_initialize', 'wb_swift_repl_execute',
  'wb_swift_repl_is_complete', 'wb_swift_repl_input_number', 'malloc', 'free');
writeFileSync(join(directory, 'repl-exports.json'),
  JSON.stringify([...new Set(names.map(name => '_' + name))].sort()) + '\n');
JS
"${CMAKE}" -S "${PROJECT_DIR}/bridge/repl" -B "${repl}/output" \
  -DSWIFT_REPL_RUNTIME_EXPORTS="${repl}/foundation/repl-exports.json"
"${CMAKE}" --build "${repl}/output" --parallel 1 --target wasmbolt-swift-repl
