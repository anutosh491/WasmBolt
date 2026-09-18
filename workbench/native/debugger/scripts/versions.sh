#!/usr/bin/env bash

# The exact WAMR revision used by the working browser debugger prototype.
LLVM_REVISION='24572c2967f11f63f0d3bfd461ca59350e592349'
WAMR_REVISION='d7050d9fe672e2d0bc65c44c966cebc0a1aca14b'
WAMR_ARCHIVE_SHA256=
WAMR_ARCHIVE_SHA256+='005997ed140249d3d7dd6645c7d489c7'
WAMR_ARCHIVE_SHA256+='8560185cc4c2d6627996353fe9db7526'
WAMR_ARCHIVE_URL=
WAMR_ARCHIVE_URL+='https://github.com/bytecodealliance/wasm-micro-runtime/'
WAMR_ARCHIVE_URL+='archive/'
WAMR_ARCHIVE_URL+="${WAMR_REVISION}.tar.gz"

# The exact emscripten-forge package used by the working prototype.
EMSCRIPTEN_VERSION='6.0.8'
EMSCRIPTEN_BUILD='h53c7e63_1'
EMSCRIPTEN_ARCHIVE_SHA256=
EMSCRIPTEN_ARCHIVE_SHA256+='6608d7ab37d48db638bc2b1c927e62f0'
EMSCRIPTEN_ARCHIVE_SHA256+='b3cec2b1a4629ea56b0f76b142f71882'
EMSCRIPTEN_ARCHIVE_URL=
EMSCRIPTEN_ARCHIVE_URL+='https://repo.prefix.dev/emscripten-forge-bot/'
EMSCRIPTEN_ARCHIVE_URL+='emscripten-forge-6x/osx-arm64/'
EMSCRIPTEN_ARCHIVE_URL+='emscripten-core-6.0.8-h53c7e63_1.tar.bz2'

# Emscripten's bundled LLVM revision, recorded by the package.
EMSCRIPTEN_LLVM_REVISION='4bfd08c2d769736841ae4f5705d76fa6daa39027'
