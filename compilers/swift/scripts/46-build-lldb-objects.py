#!/usr/bin/env python3
"""Compile LLDB without waiting for its imported Swift/LLVM link archives."""
import argparse
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--ninja', required=True)
parser.add_argument('--build', type=pathlib.Path, required=True)
parser.add_argument('--jobs', default='2')
args = parser.parse_args()
lines = subprocess.check_output(
    [args.ninja, '-C', str(args.build), '-t', 'inputs', 'lldb-dap'],
    text=True).splitlines()
objects = [line for line in lines if line.startswith(('source/', 'tools/'))
           and '.dir/' in line and line.endswith('.cpp.o')]
if not objects:
    raise SystemExit('No LLDB object targets found.')
print(f'Compiling {len(objects)} LLDB C++ objects', flush=True)
result = subprocess.run(
    [args.ninja, '-C', str(args.build), '-j', args.jobs, *objects])
raise SystemExit(result.returncode)
