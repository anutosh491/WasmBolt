#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${LLVM_WASM_PREFIX:?Set LLVM_WASM_PREFIX to the installed target package prefix}"
: "${EMSCRIPTEN_SYSROOT:?Set EMSCRIPTEN_SYSROOT to the Emscripten SDK sysroot}"
arch="${WASMBOLT_ARCH:-wasm32}"
case "$arch" in
  wasm32) bits=32 ;;
  wasm64) bits=64 ;;
  *) echo 'WASMBOLT_ARCH must be wasm32 or wasm64' >&2; exit 2 ;;
esac
# One SDK supports both architectures. Select the ABI for compilation AND linking.
export EMCC_CFLAGS="${EMCC_CFLAGS:-} -m${bits}"
build_dir="build/${arch}"
site_dir="${WASMBOLT_SITE_DIR:-site}"
case "$site_dir" in
  site|site/wasm32|site/wasm64) ;;
  *) echo 'WASMBOLT_SITE_DIR must be site, site/wasm32 or site/wasm64' >&2; exit 2 ;;
esac

emcmake cmake --fresh -S . -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="-m${bits}" \
  -DCMAKE_CXX_FLAGS="-m${bits}" \
  -DCMAKE_PREFIX_PATH="${LLVM_WASM_PREFIX}" \
  -DLLVM_WASM_PREFIX="${LLVM_WASM_PREFIX}" \
  -DLLVM_DIR="${LLVM_WASM_PREFIX}/lib/cmake/llvm" \
  -DClang_DIR="${LLVM_WASM_PREFIX}/lib/cmake/clang" \
  -DLLD_DIR="${LLVM_WASM_PREFIX}/lib/cmake/lld" \
  -DEMSCRIPTEN_SYSROOT="${EMSCRIPTEN_SYSROOT}" \
  -DWASMBOLT_RUNTIME_LIBRARIES="${WASMBOLT_RUNTIME_LIBRARIES:-}"
cmake --build "$build_dir" --parallel "${CMAKE_BUILD_PARALLEL_LEVEL:-4}"

# Replace only the validated generated output; do not retain old driver assets.
rm -rf "$site_dir"
mkdir -p "$site_dir"/{ui,runtime,tools,language-services/clangd/runtime}
cp ui/index.html "$site_dir/"
cp ui/*.js ui/styles.css "$site_dir/ui/"
cp runtime/*.js "$site_dir/runtime/"
cp tools/*.js "$site_dir/tools/"
cp language-services/clangd/*.{js,css} "$site_dir/language-services/clangd/"
cp "${LLVM_WASM_PREFIX}"/bin/clangd.{js,wasm} "$site_dir/language-services/clangd/runtime/"
cp ui/vendor/coi-serviceworker.js "$site_dir/"
cp ui/vendor/coi-serviceworker.LICENSE "$site_dir/"
for directory in compilers/swift; do
  [[ -d "$directory" ]] || continue
  mkdir -p "$site_dir/$directory"
  cp "$directory"/*.js "$site_dir/$directory/"
done
cp tutorials.md tutorial_*.md "$site_dir/"
cp "$build_dir"/Compiler.{js,wasm,data} "$site_dir/runtime/"
for tool in opt llc llvm-ar llvm-cxxfilt llvm-nm llvm-objcopy llvm-objdump \
            llvm-readobj llvm-size mlir-opt mlir-translate dot; do
  cp "${LLVM_WASM_PREFIX}/bin/${tool}."{js,wasm} "$site_dir/tools/"
done
printf 'Built %s: %s\n' "$arch" "$site_dir"
