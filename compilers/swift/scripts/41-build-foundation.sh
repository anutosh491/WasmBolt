#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

mode="${1:-guest}"
case "${mode}" in
  guest) runtime=stdlib-wasm; name=foundation; c_flags=-fPIC; swift_extra='' ;;
  host) runtime=stdlib-host-wasm; name=foundation-host
    c_flags='-fPIC -pthread'; swift_extra='-Xcc -pthread' ;;
  *) printf 'Expected guest or host, got %s\n' "${mode}" >&2; exit 1 ;;
esac
foundation="${WASMBOLT_FOUNDATION_WORK_DIR:-${WORK_DIR}/${name}}"
sources="${WASMBOLT_FOUNDATION_SOURCE_DIR:-${foundation}/foundation-sources}"
prefix="${foundation}/foundation-install"
mkdir -p "${sources}" "${foundation}/foundation-no-plugins"
# Separate pinned checkouts preserve any existing native Swift development tree.
"${PYTHON}" - "${PROJECT_DIR}" "${sources}" <<'PY'
import json, pathlib, subprocess, sys
project, sources = map(pathlib.Path, sys.argv[1:])
pins = json.loads((project / 'sources.json').read_text())
for name, directory in [('foundation', 'swift-foundation'),
                        ('corelibsFoundation', 'swift-corelibs-foundation'),
                        ('foundationICU', 'swift-foundation-icu'),
                        ('collections', 'swift-collections'), ('libxml2', 'libxml2')]:
    target, pin = sources / directory, pins[name]
    if not target.exists():
        subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout',
                        pin['url'], str(target)], check=True)
        subprocess.run(['git', '-C', str(target), 'fetch', '--depth=1',
                        'origin', pin['revision']], check=True)
        subprocess.run(['git', '-C', str(target), 'checkout', '--detach',
                        pin['revision']], check=True)
    actual = subprocess.check_output(['git', '-C', str(target), 'rev-parse',
                                     'HEAD'], text=True).strip()
    if actual != pin['revision']:
        raise SystemExit(f'Wrong revision at {target}: {actual}')
for directory, name in [('swift-foundation', 'foundation-emscripten.patch'),
                        ('swift-corelibs-foundation', 'corelibs-foundation-emscripten.patch'),
                        ('swift-corelibs-foundation', 'corelibs-foundation-without-dispatch.patch')]:
    command = ['git', '-C', str(sources / directory), 'apply']
    patch = str(project / 'patches' / name)
    if subprocess.run(command + ['--reverse', '--check', patch],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(command + ['--check', patch], check=True)
        subprocess.run(command + [patch], check=True)
PY

wasm_cmake -S "${sources}/libxml2" -B "${foundation}/libxml-wasm" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${prefix}" -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_C_FLAGS="${c_flags}" -DLIBXML2_WITH_THREADS=OFF \
  -DLIBXML2_WITH_LZMA=OFF -DLIBXML2_WITH_ZLIB=OFF -DLIBXML2_WITH_ICONV=OFF \
  -DLIBXML2_WITH_HTTP=OFF -DLIBXML2_WITH_MODULES=OFF \
  -DLIBXML2_WITH_TESTS=OFF -DLIBXML2_WITH_PROGRAMS=OFF -DLIBXML2_WITH_PYTHON=OFF
"${CMAKE}" --build "${foundation}/libxml-wasm" --parallel "${JOBS}" --target install

sdk="${EM_CACHE}/sysroot"
flags="-target wasm32-unknown-emscripten -module-cache-path ${foundation}/foundation-module-cache -sdk ${sdk} -resource-dir ${WORK_DIR}/${runtime}/lib/swift -Xcc -resource-dir=${WASM_LLVM_DIR}/lib/clang/23 -Xcc -isystem -Xcc ${sdk}/include/compat -Xcc -fPIC -Xcc -mno-reference-types ${swift_extra}"
build="${foundation}/foundation-wasm"
# Corelibs' existing FetchContent hooks build Essentials, Internationalization,
# ICU and Collections once, from the matching sources above.
wasm_cmake -S "${sources}/swift-corelibs-foundation" -B "${build}" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${prefix}" -DBUILD_SHARED_LIBS=OFF \
  -DFOUNDATION_BUILD_NETWORKING=OFF -DSWIFT_SYSTEM_NAME=emscripten \
  -DCMAKE_Swift_COMPILER="${NATIVE_SWIFT_DIR}/bin/swiftc" \
  -DCMAKE_Swift_COMPILER_TARGET=wasm32-unknown-emscripten \
  -DCMAKE_Swift_COMPILER_WORKS=TRUE -DCMAKE_Swift_COMPILER_FORCED=TRUE \
  -DCMAKE_Swift_FLAGS="${flags}" \
  '-DCMAKE_Swift_CREATE_STATIC_LIBRARY=<CMAKE_AR> crs <TARGET> <OBJECTS>' \
  -DCMAKE_C_FLAGS="${c_flags}" -DCMAKE_CXX_FLAGS="${c_flags}" \
  -D_SwiftFoundation_SourceDIR="${sources}/swift-foundation" \
  -D_SwiftFoundationICU_SourceDIR="${sources}/swift-foundation-icu" \
  -D_SwiftCollections_SourceDIR="${sources}/swift-collections" \
  -DSwiftFoundation_MACRO="${foundation}/foundation-no-plugins" \
  -DLIBXML2_LIBRARY="${prefix}/lib/libxml2.a" \
  -DLIBXML2_INCLUDE_DIR="${prefix}/include/libxml2"
"${CMAKE}" --build "${build}" --parallel "${JOBS}" --target Foundation

"${PYTHON}" - "${build}" "${WORK_DIR}/${name}-sdk" "${prefix}" <<'PY'
import pathlib, shutil, sys
build, sdk, prefix = map(pathlib.Path, sys.argv[1:])
runtime = sdk / 'lib/swift'
libraries = runtime / 'emscripten/wasm32'
libraries.mkdir(parents=True, exist_ok=True)
for name in ['Foundation', 'CoreFoundation', 'FoundationEssentials',
             'FoundationInternationalization', '_FoundationCollections',
             '_FoundationCShims', '_FoundationICU']:
    shutil.copy2(build / 'lib' / f'lib{name}.a', libraries)
    for suffix in ['swiftmodule', 'swiftdoc']:
        source = build / 'swift' / f'{name}.{suffix}'
        if source.is_file():
            target = runtime / 'emscripten' / f'{name}.swiftmodule'
            target.mkdir(exist_ok=True)
            shutil.copy2(source, target / f'wasm32-unknown-emscripten.{suffix}')
for source in (build / '_CModulesForClients').iterdir():
    if source.is_dir():
        shutil.copytree(source, runtime / source.name, dirs_exist_ok=True)
shutil.copy2(prefix / 'lib/libxml2.a', libraries)
print(f'Foundation SDK: {sdk}')
PY
