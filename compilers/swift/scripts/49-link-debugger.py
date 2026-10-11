#!/usr/bin/env python3
"""Reuse the configured LLDB-DAP link graph with the in-memory WAMR bridge."""
import argparse
import json
import pathlib
import shlex
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--ninja', required=True)
parser.add_argument('--build', type=pathlib.Path, required=True)
parser.add_argument('--bridge', type=pathlib.Path, required=True)
parser.add_argument('--wamr', type=pathlib.Path, required=True)
parser.add_argument('--swift-runtime', type=pathlib.Path, required=True)
parser.add_argument('--worker', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
args.build = args.build.resolve()
args.output = args.output.resolve()
args.output.mkdir(parents=True, exist_ok=True)

commands = subprocess.check_output(
    [args.ninja, '-C', str(args.build), '-t', 'commands', 'lldb-dap'],
    text=True).splitlines()
tokens = shlex.split(commands[-1])
start = next(i for i, value in enumerate(tokens) if value.endswith('/em++'))
tokens = tokens[start:]
if '&&' in tokens:
    tokens = tokens[:tokens.index('&&')]

# Keep the real archive order and flags from CMake, replacing only CLI main.
main = [i for i, value in enumerate(tokens)
        if value.endswith('/lldb-dap.cpp.o')]
if len(main) != 1:
    raise SystemExit('Expected exactly one LLDB-DAP CLI entry object.')
tokens[main[0]] = str(args.bridge.resolve())
output_index = tokens.index('-o') + 1
tokens[output_index] = str(args.output / 'lldb-dap.js')
runtime = args.swift_runtime.resolve() / 'lib/swift/emscripten/wasm32'
tokens += [str(runtime / 'swiftrt.o'), str(runtime / 'libswiftCore.a')]
tokens += [str(args.wamr.resolve()), '-luuid', '-O1', '-Wl,--gc-sections',
           '-sMODULARIZE=1', '-sEXPORT_ES6=1',
           '-sEXPORT_NAME=createLLDBDAPModule', '-sPTHREAD_POOL_SIZE=16',
           '-sPTHREAD_POOL_SIZE_STRICT=0', '-sINITIAL_MEMORY=536870912',
           '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=2147483648',
           '-sSTACK_SIZE=16777216', '-sEXIT_RUNTIME=0',
           '-sINCOMING_MODULE_JS_API=mainScriptUrlOrBlob,noInitialRun,'
           'noExitRuntime,locateFile,wasmBinary,instantiateWasm,print,printErr,onAbort',
           '-sEXPORTED_RUNTIME_METHODS=ccall,UTF8ToString,FS,FS_createDataFile,'
           'FS_unlink,FS_createPath,PThread']
(args.output / 'link-arguments.json').write_text(json.dumps(tokens, indent=2)+'\n')
result = subprocess.run(tokens, cwd=args.build)
if result.returncode:
    raise SystemExit(result.returncode)
shutil.copyfile(args.worker, args.output / 'lldb-dap.worker.js')
