# Shared browser debugger transport

Swift reuses this LLDB-DAP bridge and WAMR classic interpreter. These sources
match the LLDB reproduction branch; Swift builds LLDB from its own pinned LLVM
fork rather than linking LLVM-main LLDB archives.

From the repository root:

```sh
micromamba create -f debugger/lldb/environment-build.yml
micromamba activate wasmbolt-browser-build
export WASMBOLT_EMSDK_ROOT="$CONDA_PREFIX/opt/emsdk"
cd debugger/lldb
bash scripts/10-fetch-wamr.sh
bash scripts/20-build-wamr.sh
```

The WAMR archive is `.work/wamr-build/libvmlib.a`. Continue with
[`compilers/swift/README.md`](../../compilers/swift/README.md) for the matching
compiler, debugger, source fixes and browser validation.
