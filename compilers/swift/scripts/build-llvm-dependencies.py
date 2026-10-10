#!/usr/bin/env python3
"""Build the LLVM archives actually referenced by a configured Ninja target."""
import argparse
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--ninja', required=True)
parser.add_argument('--cmake', required=True)
parser.add_argument('--consumer', type=pathlib.Path, required=True)
parser.add_argument('--llvm', type=pathlib.Path, required=True)
parser.add_argument('--graph-llvm', type=pathlib.Path)
parser.add_argument('--jobs', default='6')
parser.add_argument('--label', default='LLVM/Clang')
parser.add_argument('targets', nargs='+')
args = parser.parse_args()

inputs = subprocess.check_output(
    [args.ninja, '-C', str(args.consumer), '-t', 'inputs', *args.targets],
    text=True).splitlines()
graph_llvm = args.graph_llvm or args.llvm
available = subprocess.check_output(
    [args.ninja, '-C', str(args.llvm), '-t', 'targets', 'all'],
    text=True).splitlines()
available = {line.split(':', 1)[0] for line in available}
libraries = sorted({pathlib.Path(item).stem[3:] for item in inputs
                    if pathlib.Path(item).parent == graph_llvm / 'lib'
                    and item.endswith('.a')
                    and pathlib.Path(item).name.startswith('lib')
                    and pathlib.Path(item).stem[3:] in available})
if not libraries:
    raise SystemExit('No LLVM archive dependencies found; check the build graph.')
print(f'Building {len(libraries)} {args.label} archive targets', flush=True)
subprocess.run([args.cmake, '--build', str(args.llvm), '--parallel', args.jobs,
                '--target', *libraries], check=True)
