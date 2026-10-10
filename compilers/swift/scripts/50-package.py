#!/usr/bin/env python3
"""Package the SDK and guest link inputs independently of the UI."""
import argparse
import filecmp
import gzip
import io
import os
import pathlib
import tarfile

project = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
sdk_root = os.environ.get('WASMBOLT_EMSDK_ROOT') or os.environ.get('EMSDK')
package_prefix = os.environ.get('WASMBOLT_EMSCRIPTEN_PACKAGE') or os.environ.get('CONDA_PREFIX')
if not sdk_root and package_prefix:
    sdk_root = str(pathlib.Path(package_prefix) / 'opt/emsdk')
emsdk = pathlib.Path(sdk_root) if sdk_root else None
parser.add_argument('--sysroot', type=pathlib.Path,
                    default=emsdk / 'upstream/emscripten/cache/sysroot' if emsdk else None)
args = parser.parse_args()
if args.sysroot is None:
    parser.error('set WASMBOLT_EMSDK_ROOT or pass --sysroot')
work = pathlib.Path(os.environ.get(
    'WASMBOLT_SWIFT_WORK_DIR', project / '.work'))
runtime = work / 'stdlib-wasm/lib/swift'
clang = work / 'llvm-wasm/lib/clang/23/include'
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
with (package / 'runtime.tar.gz').open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            entries = {}
            for root, prefix in [(runtime, 'swift/lib/swift'),
                                 (clang, 'swift/lib/swift/clang/include'),
                                 (args.sysroot / 'include', 'include')]:
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
                'crt1.o', 'libstandalonewasm-nocatch.a', 'libstubs-debug.a',
                'libc-debug.a', 'libdlmalloc-debug.a', 'libclang_rt.builtins.a',
                'libc++-debug-noexcept.a', 'libc++abi-debug-noexcept.a'
            ]:
                source = args.sysroot / 'lib/wasm32-emscripten' / name
                if not source.is_file():
                    raise SystemExit(f'Missing Emscripten link input: {source}')
                entries[f'lib/wasm32-emscripten/{name}'] = source
            for name, source in sorted(entries.items()):
                add_file(archive, source, name)
            add_file(archive, project / 'sdk/wasmbolt.cfg', 'swift/etc/wasmbolt.cfg')
            add_file(archive, project / 'sdk/static-executable-args.lnk',
                     'swift/lib/swift/emscripten/static-executable-args.lnk')
print(f'Packaged {package / "runtime.tar.gz"}', flush=True)
