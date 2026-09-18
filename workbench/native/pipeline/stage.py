#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import tempfile


LLVM_VERSION = "23.1.0"
LLVM_REVISION = "ea7d852a70e8bdfaf601d6626a760f9771b2c4b4"
EMSCRIPTEN_VERSION = "4.0.9"
ASSETS = {
    "opt": ("opt.js", "opt.wasm"),
    "llc": ("llc.js", "llc.wasm"),
}

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES_PATH = ROOT / "runtime" / "sources.json"


def digest(path: pathlib.Path) -> tuple[int, str]:
    hasher = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            hasher.update(chunk)
    return size, hasher.hexdigest()


def load_json(path: pathlib.Path) -> dict:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def validate_sources(sources: dict) -> None:
    expected = {
        "llvm": LLVM_VERSION,
        "llvmRevision": LLVM_REVISION,
        "emscripten": EMSCRIPTEN_VERSION,
    }
    for name, value in expected.items():
        if sources.get(name) != value:
            raise ValueError(f"runtime/sources.json has an unexpected {name}")
    targets = sources.get("pipelineTargets")
    if not isinstance(targets, list) or not targets:
        raise ValueError("runtime/sources.json has no pipeline targets")
    if not all(isinstance(target, str) for target in targets):
        raise ValueError("runtime/sources.json has invalid pipeline targets")


def validate_manifest(manifest: dict, sources: dict) -> None:
    if manifest.get("format") != 1:
        raise ValueError("compiler/manifest.json has an unsupported format")
    if manifest.get("version") != LLVM_VERSION:
        raise ValueError("the compiler and pipeline LLVM versions differ")
    if manifest.get("revision") != sources.get("revision"):
        raise ValueError("the compiler manifest has an unexpected revision")
    if manifest.get("origin") != "source":
        raise ValueError("the compiler runtime has unverified provenance")
    services = manifest.get("llvmServices")
    if services is not None and services != {
        "revision": LLVM_REVISION,
        "emscripten": EMSCRIPTEN_VERSION,
    }:
        raise ValueError("the LLVM service builds use different inputs")


def copy_asset(source: pathlib.Path, destination: pathlib.Path) -> dict:
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError(f"missing pipeline asset: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=f".{destination.name}.",
            delete=False,
        ) as temporary:
            temporary_path = pathlib.Path(temporary.name)
            with source.open("rb") as stream:
                shutil.copyfileobj(stream, temporary)
        os.replace(temporary_path, destination)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    size, sha256 = digest(destination)
    return {"bytes": size, "sha256": sha256}


def stage(build: pathlib.Path, output: pathlib.Path) -> None:
    sources = load_json(SOURCES_PATH)
    validate_sources(sources)
    manifest_path = output / "manifest.json"
    manifest = load_json(manifest_path)
    validate_manifest(manifest, sources)

    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("compiler/manifest.json has no file table")

    records = {}
    for group, names in ASSETS.items():
        for name in names:
            key = f"{group}/{name}"
            records[key] = copy_asset(build / name, output / key)

    for name in tuple(files):
        if name.startswith(("opt/", "llc/")):
            del files[name]
    files.update(records)
    manifest.update(
        {
            "pipelineOrigin": "source",
            "pipelineTargets": sources["pipelineTargets"],
            "llvmServices": {
                "revision": LLVM_REVISION,
                "emscripten": EMSCRIPTEN_VERSION,
            },
        }
    )

    with tempfile.NamedTemporaryFile(
        mode="w",
        dir=output,
        prefix=".manifest.",
        delete=False,
    ) as temporary:
        temporary_path = pathlib.Path(temporary.name)
        json.dump(manifest, temporary, indent=2)
        temporary.write("\n")
    try:
        os.replace(temporary_path, manifest_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def check(output: pathlib.Path) -> None:
    sources = load_json(SOURCES_PATH)
    validate_sources(sources)
    manifest = load_json(output / "manifest.json")
    validate_manifest(manifest, sources)
    if manifest.get("pipelineOrigin") != "source":
        raise ValueError("the pipeline assets have unverified provenance")
    if manifest.get("pipelineTargets") != sources["pipelineTargets"]:
        raise ValueError("the staged pipeline targets do not match the recipe")

    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("compiler/manifest.json has no file table")
    for group, names in ASSETS.items():
        directory = output / group
        if not directory.is_dir():
            raise ValueError(f"missing pipeline directory: {directory}")
        if {path.name for path in directory.iterdir()} != set(names):
            raise ValueError(f"{group} contains unexpected pipeline assets")
        for name in names:
            key = f"{group}/{name}"
            size, sha256 = digest(output / key)
            if files.get(key) != {"bytes": size, "sha256": sha256}:
                raise ValueError(f"{key} does not match compiler/manifest.json")
    print("LLVM pipeline assets verified.")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="action", required=True)
    stage_parser = subparsers.add_parser("stage")
    stage_parser.add_argument("build", type=pathlib.Path)
    stage_parser.add_argument("output", type=pathlib.Path)
    check_parser = subparsers.add_parser("check")
    check_parser.add_argument("output", type=pathlib.Path)
    arguments = parser.parse_args()

    if arguments.action == "stage":
        stage(arguments.build.resolve(), arguments.output.resolve())
    else:
        check(arguments.output.resolve())


if __name__ == "__main__":
    main()
