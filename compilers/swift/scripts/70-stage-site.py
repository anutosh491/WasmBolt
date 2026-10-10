#!/usr/bin/env python3
"""Stage Swift and its matching debugger on top of the existing WasmBolt assets."""
import argparse
import json
import os
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[3]
recipe = root / 'compilers/swift'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--base-site', type=Path,
               help='Site produced by scripts/build.sh or the LLDB staging script')
p.add_argument('--work', type=Path, default=Path(os.environ.get(
    'WASMBOLT_SWIFT_WORK_DIR', recipe / '.work')))
p.add_argument('--site', type=Path, default=root / 'site')
p.add_argument('--swift-only', action='store_true',
               help='Stage only Swift compilation and debugging')
a = p.parse_args()
with_debugger = (root / 'debugger/lldb/worker.js').is_file()
site = a.site.resolve()
if site == root or site in root.parents or (a.base_site and site == a.base_site.resolve()):
    p.error('Choose a separate generated site directory')
if a.swift_only and (site / 'runtime/Compiler.js').exists():
    p.error('Choose a fresh directory for the Swift-only site')
if a.base_site and not a.swift_only:
    shutil.copytree(a.base_site, site, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('*.gz', 'tests', 'wasm64'))
elif not a.swift_only:
    p.error('--base-site is required unless --swift-only is selected')

def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)

copy(root / 'ui/index.html', site / 'index.html')
html = (site / 'index.html').read_text()
html = html.replace('<option value="swift" disabled>', '<option value="swift">')
if with_debugger:
    html = html.replace('<head>', '<head>\n    <meta name="wasmbolt-debugger" content="lldb" />')
(site / 'index.html').write_text(html)
for directory in ['ui', 'runtime', 'tools', 'language-services/clangd', 'compilers/swift', 'debugger/lldb']:
    for source in (root / directory).glob('*.js'):
        copy(source, site / directory / source.name)
for source in (root / 'language-services/clangd').glob('*.css'):
    copy(source, site / 'language-services/clangd' / source.name)
for name in ['coi-serviceworker.js', 'coi-serviceworker.LICENSE']:
    copy(root / 'ui/vendor' / name, site / name)
for source in (root / 'ui').glob('*.css'):
    copy(source, site / 'ui' / source.name)
for suffix in ['js', 'wasm']:
    copy(a.work / 'compiler' / f'wasmbolt-swift.{suffix}',
         site / 'compilers/swift' / f'wasmbolt-swift.{suffix}')
copy(a.work / 'swift-package/runtime.tar.gz',
     site / 'compilers/swift/runtime.tar.gz')
if with_debugger:
    for name in ['lldb-dap.js', 'lldb-dap.wasm', 'lldb-dap.worker.js']:
        copy(a.work / 'output' / name, site / 'debugger/lldb' / name)
examples = {} if a.swift_only or not with_debugger else {name: (root / 'debugger/lldb/tests' / name).read_text()
            for name in ['simple.cpp', 'simple.c', 'debug.ll', 'json.cpp']}
if with_debugger:
    (site / 'debugger/lldb/workspace-examples.json').write_text(json.dumps(examples) + '\n')
examples = {}
for name in ['fibonacci.swift', 'fizzbuzz.swift', 'math.swift', 'main.swift']:
    examples[name] = (recipe / 'tests' / name).read_text()
(site / 'compilers/swift/workspace-examples.json').write_text(
    json.dumps(examples) + '\n')
copy(recipe / 'tutorial_swift.md', site / 'tutorial_swift.md')
if a.swift_only:
    html = (site / 'index.html').read_text()
    html = html.replace('<head>', '<head>\n    <meta name="wasmbolt-compiler" content="swift" />')
    import re
    html = re.sub(r'\s*<option value="(?:cpp|c|mlir|llvm|x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu)">.*?</option>', '', html)
    html = re.sub(r'<button data-tab="(mlir|analysis|cfg)">',
                  r'<button class="hidden" data-tab="\1">', html)
    html = html.replace('Inspect, optimize, compile and run C, C++, MLIR and LLVM IR',
                        'Compile, run and debug Swift')
    html = html.replace('run clang, mlir-opt, mlir-translate, opt, llc, dot and wasm-ld',
                        'run swift and swiftc')
    html = html.replace('MLIR, Clang, LLVM, LLD and generated code',
                        'Swift, LLVM, LLD, LLDB and generated code')
    (site / 'index.html').write_text(html)
for path in ['compilers/swift/wasmbolt-swift.wasm', *(['debugger/lldb/lldb-dap.wasm'] if with_debugger else [])]:
    (site / (path + '.parts.json')).write_text(json.dumps([Path(path).name]) + '\n')
(site / '_headers').write_text('/*\n  Cross-Origin-Opener-Policy: same-origin\n'
    '  Cross-Origin-Embedder-Policy: require-corp\n'
    '  Cross-Origin-Resource-Policy: same-origin\n')
print('Staged Swift site:', site)
