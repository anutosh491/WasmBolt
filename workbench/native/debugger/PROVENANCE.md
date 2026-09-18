# Debugger build provenance

## Pinned inputs

| Input               | Identity                                                           |
| ------------------- | ------------------------------------------------------------------ |
| WAMR repository     | `bytecodealliance/wasm-micro-runtime`                              |
| WAMR commit         | `d7050d9fe672e2d0bc65c44c966cebc0a1aca14b`                         |
| WAMR tar SHA-256    | `005997ed140249d3d7dd6645c7d489c78560185cc4c2d6627996353fe9db7526` |
| Emscripten          | `6.0.8-h53c7e63_1`, emscripten-forge 6x, macOS arm64               |
| Package SHA-256     | `6608d7ab37d48db638bc2b1c927e62f0b3cec2b1a4629ea56b0f76b142f71882` |
| Emscripten commit   | `aeb67926e7de656da38bc807d83050af93578758`                         |
| Bundled LLVM commit | `4bfd08c2d769736841ae4f5705d76fa6daa39027`                         |

The working prototype reported itself as LLVM 23.1.0, but its extracted LLVM
tree contained local/stacked LLDB Emscripten changes and its exact Git commit
was not preserved. A new build must record the current checkout commit in
`.work/llvm-lldb-build/.wasmbolt-llvm-revision`. At recovery time the checkout
was `24572c2967f11f63f0d3bfd461ca59350e592349`.

The relevant merged LLDB changes were:

- HostInfoEmscripten: `78bbf2229d2a`
- PlatformEmscripten: `862885765ac2`
- Emscripten lldbHost support: `1c1edc2d34e1`
- static liblldb support: `c9c1ed7e41b2`

## Why this WAMR revision

This is the commit used by the known-working prototype. WAMR 2.4.5 commit
`25bd7eb63e828e4bd242cc9b38d260b4b31c6605` is newer, but changing the runtime
and reconstructing the lost LLDB build simultaneously would make failures hard
to attribute. Upgrade only after this pin passes the simple E2E gate.

The recovery build produced a 422,526-byte `libvmlib.a` with SHA-256
`5e6ee6c6f35d7b0bce0bafbedbb22e65ba089f1a2c53239b3db4bc8d2c795408`. The required
embedded-debug symbols were verified with `nm`.

WAMR is built as a library for the classic debug interpreter. AOT, JIT, fast
interpreter, and bundled libc variants are disabled. `WAMR_BUILD_PLATFORM` is
currently `linux` and the target is `X86_32`: this reuses WAMR's POSIX platform
layer while Emscripten supplies pthreads. It is a proven experimental build
choice, not a claim that the browser is Linux or x86.

## Recovered successful link

This is the exact successful final command from the previous experiment. Its
`/private/tmp` paths are historical; `scripts/50-link-debugger.sh` maps the same
operation to persistent paths.

```bash
cd /private/tmp/llvm-lldb-pthread-build6/tools/lldb/tools/lldb-dap/tool

EM_CONFIG=/private/tmp/wasmbolt-emscripten-config.py \
/private/tmp/lldb-emscripten6-build/opt/emsdk/upstream/emscripten/em++ \
  -O2 -fwasm-exceptions -pthread -mtail-call -Wl,--gc-sections \
  /private/tmp/wasmbolt-lldb-dap-probe/dap_parameterized.cpp.o \
  /private/tmp/wamr-browser-probe/build-xtensor-debug/libvmlib.a \
  @CMakeFiles/lldb-dap.dir/linkLibs.rsp \
  -o /private/tmp/xtensor-live-debug-test/lldb-dap.js \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createLLDBDAPModule \
  -sPTHREAD_POOL_SIZE=16 \
  -sPTHREAD_POOL_SIZE_STRICT=0 \
  -sINITIAL_MEMORY=512MB \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY=2GB \
  -sSTACK_SIZE=16MB \
  -sNO_EXIT_RUNTIME=1 \
  -sEXPORTED_RUNTIME_METHODS=ccall,UTF8ToString,FS,FS_createDataFile,FS_unlink,FS_createPath
```

The bridge object and response file in that command were generated inputs, not
checked-in source artifacts. They must be regenerated against one LLVM checkout;
mixing them across revisions is unsupported.

## Current source rebuild

The completed recovery used LLVM `24572c2967f11f63f0d3bfd461ca59350e592349`, the
WAMR and Emscripten inputs listed above, 223 LLDB archive dependencies, and an
`-O2` final link. The link-response SHA-256 is
`06ac25479f77bba36f55ffc702b96a256c076d1889c16d1235efde2409a3c31f`.

Two small LLVM changes required for this embedded pthread transport are captured
in `patches/lldb-embedded-wasm-thread-selection.patch`. They skip redundant
selected-thread/frame changes for Wasm targets during DAP `scopes` and SBThread
stepping. Without them, those calls wait indefinitely on the WAMR event pthread.
`scripts/30-configure-lldb.sh` applies the patch idempotently and fails if it
does not match the selected LLVM checkout.

| File                 |             Size | SHA-256                                                            |
| -------------------- | ---------------: | ------------------------------------------------------------------ |
| `lldb-dap.js`        |    125,559 bytes | `feb5e4ab02ddbb27940c86987e3ef781afdce371726ea436c27be4dbdb3ce86e` |
| `lldb-dap.wasm`      | 66,898,487 bytes | `5fa7e7dd599dc281c88160169a95de562a4a978473b2d899756253f4fd586ede` |
| `lldb-dap.worker.js` |         24 bytes | `f205167738aa5cca162f248ac4c916f7f14ad061cf6064493da58eb766549bc2` |
| `simple.wasm`        |    159,545 bytes | `9dedb045f18140cd65f904b3102330ef1e9730f438e35d65525fe9daf7d0a22b` |

The Worker entry imports the one modularized LLDB-DAP script. No standalone
`lldb.js` or `lldb.wasm` is part of this build or runtime design.

## Historical output checksums

These prove what the prior run produced. A current-source rebuild is not
expected to be byte-identical.

| File            |             Size | SHA-256                                                            |
| --------------- | ---------------: | ------------------------------------------------------------------ |
| `lldb-dap.js`   |    126,580 bytes | `29796741aabd222b7f665317fef4f121ccc965d930d4abcb59a081edd9406823` |
| `lldb-dap.wasm` | 65,856,121 bytes | `5e8cc4d90770d06d019311375e801eac8c853184a6983d8dffa6f99ac7487221` |
| bridge object   |          unknown | `d15a37447deb5b7229078c090b8cde6f808ea812c3192dde84a1adb445bb4ab7` |
| `libvmlib.a`    |          unknown | `4e06219f879979c80a84c13c5a2929fffdc75d5c99fb6a8743b8af0352ef0aa8` |
| `linkLibs.rsp`  |          unknown | `232e5c00192321c11f1a431cb9c0e9839e8dd516146b20c44119877586297bf7` |

## Browser requirements

The module uses Emscripten pthreads. It must be served with COOP/COEP headers so
`SharedArrayBuffer` is available. The pool size is a fixed reserve of 16
workers; memory growth does not dynamically create pthread workers. The module
starts with 512 MiB linear memory, may grow up to 2 GiB, and reserves a 16 MiB
stack.
