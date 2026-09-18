#!/usr/bin/env python3
import hashlib
import json
import pathlib
import sys


stage = pathlib.Path(sys.argv[1])
llvm_version, revision, emscripten_version = sys.argv[2:]
manifest_path = stage.parent / "manifest.json"
manifest = json.loads(manifest_path.read_text())

if manifest.get("version") != llvm_version:
    raise SystemExit("compiler and MLIR versions differ")

services = manifest.get("llvmServices")
expected = {
    "revision": revision,
    "emscripten": emscripten_version,
}
if services is not None and services != expected:
    raise SystemExit("compiler and MLIR service revisions differ")

names = (
    "mlir-opt.js",
    "mlir-opt.wasm",
    "mlir-translate.js",
    "mlir-translate.wasm",
)
for key in tuple(manifest["files"]):
    if key.startswith("mlir/"):
        del manifest["files"][key]
for name in names:
    path = stage / name
    if not path.is_file():
        raise SystemExit(f"missing staged MLIR asset: {name}")
    content = path.read_bytes()
    manifest["files"][f"mlir/{path.name}"] = {
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }

manifest["mlirOrigin"] = "source"
manifest["llvmServices"] = expected
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
