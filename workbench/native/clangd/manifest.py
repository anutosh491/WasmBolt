#!/usr/bin/env python3
import hashlib
import json
import pathlib
import sys


stage = pathlib.Path(sys.argv[1])
llvm_version, revision, emscripten_version = sys.argv[2:]
files = {}
for path in sorted(stage.iterdir()):
    if path.name == "manifest.json" or not path.is_file():
        continue
    content = path.read_bytes()
    files[f"clangd/{path.name}"] = {
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }

manifest_path = stage.parent / "manifest.json"
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text())
else:
    manifest = {"format": 1, "files": {}}
manifest.setdefault("version", llvm_version)
manifest.setdefault("revision", revision)
manifest.setdefault("files", {})
for name in list(manifest["files"]):
    if name.startswith("clangd/"):
        del manifest["files"][name]
manifest.update(
    {
        "clangdOrigin": "source",
        "clangdVersion": llvm_version,
        "clangdRevision": revision,
        "clangdEmscripten": emscripten_version,
        "clangdThreaded": True,
        "llvmServices": {
            "revision": revision,
            "emscripten": emscripten_version,
        },
    }
)
manifest["files"].update(files)
manifest_path.write_text(
    json.dumps(manifest, indent=2, sort_keys=True) + "\n"
)
