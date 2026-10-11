#!/usr/bin/env python3
"""Package the SDK and guest link inputs independently of the UI."""
import argparse
import contextlib
import filecmp
import gzip
import io
import os
import pathlib
import tarfile

project = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--sysroot', type=pathlib.Path,
                    help='Generated Emscripten sysroot; defaults to the build cache')
parser.add_argument('--foundation-sdk', type=pathlib.Path,
                    help='Optional Foundation SDK produced by 41-build-foundation.sh')
args = parser.parse_args()
work = pathlib.Path(os.environ.get(
    'WASMBOLT_SWIFT_WORK_DIR', project / '.work'))
if args.sysroot is None:
    args.sysroot = work / 'em-cache/sysroot'
if args.foundation_sdk is None and (work / 'foundation-sdk').is_dir():
    args.foundation_sdk = work / 'foundation-sdk'
runtime = work / 'stdlib-wasm/lib/swift'
host_runtime = work / 'stdlib-host-wasm/lib/swift'
clang = work / 'llvm-wasm/lib/clang/23/include'
headers = args.sysroot / 'include'
if not (runtime / 'emscripten/wasm32/libswiftCore.a').is_file():
    raise SystemExit('Build the guest standard library before packaging.')
package = work / 'swift-package'
package.mkdir(exist_ok=True)

def add_file(archive, source, name):
    data = source.read_bytes()
    entry = tarfile.TarInfo(name)
    entry.size = len(data)
    entry.mode = 0o644
    entry.mtime = 0
    archive.addfile(entry, io.BytesIO(data))

# Dereference only known SDK build files. Browser extraction deliberately
# excludes archive symlinks, so every resource is a regular file here.
with contextlib.ExitStack() as stack:
    archives = {}
    names = ['runtime.tar.gz', 'modules.tar.gz']
    if args.foundation_sdk:
        names.append('foundation.tar.gz')
    if host_runtime.is_dir():
        names.append('repl-modules.tar.gz')
    for name in names:
        raw = stack.enter_context((package / name).open('wb'))
        compressed = stack.enter_context(gzip.GzipFile(fileobj=raw, mode='wb', mtime=0))
        archives[name] = stack.enter_context(tarfile.open(fileobj=compressed, mode='w'))
    entries = {}
    for root, prefix in [(runtime, 'swift/lib/swift'),
                         (clang, 'swift/lib/swift/clang/include'),
                         (headers, 'include')]:
        for directory, _, names in os.walk(root, followlinks=True):
            for name in names:
                source = pathlib.Path(directory) / name
                if source.is_file():
                    # Linking uses wasm32/. The root archive symlinks
                    # otherwise duplicate every runtime in the tarball.
                    if (source.parent == runtime / 'emscripten' and
                            source.suffix in ['.a', '.o'] and
                            (source.parent / 'wasm32' / name).is_file() and
                            filecmp.cmp(source, source.parent / 'wasm32' / name,
                                        shallow=False)):
                        continue
                    target = f'{prefix}/{source.relative_to(root)}'
                    entries[target] = source
    for name in [
        'crt1.o', 'libstandalonewasm-nocatch-memgrow-pure.a', 'libstubs-debug.a',
        'libc-debug.a', 'libdlmalloc-debug.a', 'libclang_rt.builtins.a',
        'libc++-debug-noexcept.a', 'libc++abi-debug-noexcept.a'
    ]:
        source = args.sysroot / 'lib/wasm32-emscripten' / name
        if not source.is_file():
            raise SystemExit(f'Missing Emscripten link input: {source}')
        entries[f'lib/wasm32-emscripten/{name}'] = source
    source = args.sysroot / 'lib/wasm32-emscripten/libwasmfs-debug.a'
    if not source.is_file():
        raise SystemExit('Build the guest WasmFS runtime before packaging.')
    entries['lib/wasm32-emscripten/libwasmfs-debug.a'] = source
    foundation_entries = set()
    if args.foundation_sdk:
        for source in args.foundation_sdk.rglob('*'):
            if source.is_file():
                name = f'swift/{source.relative_to(args.foundation_sdk)}'
                entries[name] = source
                foundation_entries.add(name)
    for name, source in sorted(entries.items()):
        target = 'foundation.tar.gz' if name in foundation_entries else 'runtime.tar.gz'
        add_file(archives[target], source, name)
        if source.suffix not in ['.a', '.o']:
            add_file(archives['modules.tar.gz'], source, name)
            if 'repl-modules.tar.gz' in archives:
                relative = name.removeprefix('swift/lib/swift/')
                host_source = host_runtime / relative
                add_file(archives['repl-modules.tar.gz'], host_source if host_source.is_file() else source, name)
    if 'repl-modules.tar.gz' in archives:
        for source in sorted(host_runtime.rglob('*')):
            name = f'swift/lib/swift/{source.relative_to(host_runtime)}'
            if source.is_file() and source.suffix not in ['.a', '.o'] and name not in entries:
                add_file(archives['repl-modules.tar.gz'], source, name)
    add_file(archives['runtime.tar.gz'], project / 'sdk/wasmbolt.cfg', 'swift/etc/wasmbolt.cfg')
    add_file(archives['runtime.tar.gz'], project / 'sdk/static-executable-args.lnk',
             'swift/lib/swift/emscripten/static-executable-args.lnk')
print(f'Packaged {package / "runtime.tar.gz"}', flush=True)
