# Contributing

Read [AGENTS.md](AGENTS.md) before editing. Git staging, commits, and history
operations belong to the user. Keep handwritten source and prose within 80
columns, use strict types, and keep domain code independent of hosts.

## Environment

Install Pixi, then run from this repository on macOS arm64 or Linux x64:

```sh
pixi install --all --locked
pixi run --as-is jlpm install --immutable
```

`pixi.lock` covers Python, Node, JupyterLab, the extension builder, JupyterLite,
and packaging tools. `yarn.lock` covers all JavaScript code and tests. Use jlpm
throughout. `--as-is` uses the already installed Pixi environment without
synchronizing it on each invocation. After changing `pixi.toml`, run
`pixi install --all` to update the environments and lock.

The default environment runs native JupyterLab. The `lite` environment adds the
browser-only xeus integration, which must not be loaded by native JupyterLab.
Both environments share locked tool versions. The Lite build script selects its
environment automatically and includes our built extension directly.

The private `lite/brand` workspace bundles `src/jupyter/brand.ts` from the
shared TypeScript build. The Lite builder includes it only in the demo site,
where it replaces the JupyterLite logo with a WasmBolt link to `/`.

Pixi uses Node 24. GitHub Actions have their own JavaScript runtime, independent
of Pixi's Node version. Keep workflow actions on releases that use Node 24 too;
update their pinned revisions when upgrading them.

## First build

```sh
pixi run --as-is jlpm build:compiler
pixi run --as-is jlpm build:prod
pixi run --as-is python -m pip install --no-build-isolation --no-deps -e .
pixi run --as-is jupyter-builder develop . --overwrite
pixi run --as-is jlpm build:standalone
pixi run --as-is node scripts/lite.mjs
pixi run --as-is node scripts/site.mjs
```

The compiler build downloads pinned toolchain packages and version-matched LLVM
sources, validates their checksums and source adjustments, then builds and
stages the runtime. Allow several gigabytes of disk space and several minutes
for the first build. It does not use or modify a sibling WasmBolt checkout.
Later frontend builds use the staged assets without rebuilding LLVM. Imported or
incomplete assets do not pass production checks.

The Lite builder discovers the installed extension. Install and link it before
building Lite. Its output is `lite/_output`; the standalone output is
`dist/standalone`. Both include their own copy of the compiler assets.

The Lite builder also installs the browser C/C++ kernel from
`lite/xeus-cpp-lock.txt`. This explicit lock records every package URL and
SHA-256 hash resolved from `lite/environment.yml`. The builder recreates
`work/xeus-cpp`, keeping downloads in `.cache/lite-mamba`, and packages only the
C23 and C++23 kernels. This environment is separate from Pixi's native build
tools. No native C++ kernel is required.

When updating the kernel, edit `lite/environment.yml`, then solve into a fresh
temporary prefix and export the lock:

```sh
pixi run --as-is micromamba create --yes --no-rc \
  --platform emscripten-wasm32 --root-prefix .cache/lite-mamba \
  --prefix work/xeus-update --file lite/environment.yml
pixi run --as-is micromamba list --prefix work/xeus-update \
  --explicit --sha256 > lite/xeus-cpp-lock.txt
```

Rebuild the site and rerun both example notebooks through the browser suite.
Commit the environment specification and lock together. If channels change, also
update `XeusAddon.default_channels` in the Lite configuration. Do not replace
the lock with a floating solve in CI.

## GitHub Pages

After building and linking the extension, build the combined site:

```sh
pixi run --as-is jlpm build:site
pixi run --as-is jlpm serve:site
```

`dist/site` serves standalone at its root and JupyterLite under `lite/`. The
standalone navigation opens Lite in the current tab. The separate
`dist/standalone` build omits the site navigation and its assets. The site build
adds `standalone/navigation.html` and `src/standalone/site.ts` through Vite's
HTML hook; its version placeholder comes from `package.json`. All asset URLs
remain relative, including compiler and notebook kernel assets. The site build
checks required entry points and the 1 GB Pages size limit.

The same build stages `wasmbolt/site` for the Python launcher. Its URL manifest
maps identical assets to one stored file, sharing the compiler with the
JupyterLab extension. `wasmbolt --no-browser` serves this packaged site on
localhost; it never serves the current working directory. Both generated site
directories are ignored by Git. Lite omits source maps to keep the installation
within PyPI's archive size limit.

GitHub Pages uses **GitHub Actions** as its source. The Build workflow tests the
combined site on pull requests, main pushes, and release builds. Successful main
pushes deploy it after both the build and wheel installation checks pass. Pull
requests and package releases do not deploy Pages. The site therefore tracks
`main`, independently of npm and PyPI releases.

The deployed URLs are `https://anutosh491.github.io/WasmBolt/` and
`https://anutosh491.github.io/WasmBolt/lite/lab/index.html`. Generated site and
kernel assets are uploaded as an Actions artifact; they do not belong in Git.

## Development loop

For JupyterLab, run these in separate terminals:

```sh
pixi run --as-is jlpm watch
pixi run --as-is jupyter lab
```

Reload JupyterLab after changes. When editing worker code, also run
`pixi run --as-is jlpm build:worker` and rebuild the extension before reloading.
The heavyweight compiler build stays outside this loop.

For standalone development:

```sh
pixi run --as-is jlpm dev:standalone
```

Vite serves the existing compiler directory without bundling its loader. Rebuild
worker code explicitly when it changes. To test production assets, use
`build:standalone` followed by `serve:standalone`.

For the JupyterLite site:

```sh
pixi run --as-is jlpm build:lite
pixi run --as-is jlpm serve
```

## User guide and notebooks

Edit the feature guide between `guide:start` and `guide:end` in `README.md`.
`build:guide` generates the shared UI content in `src/generated/guide.ts` and
`lite/files/WasmBolt guide.md`. Both are ignored build outputs. Frontend and
Lite builds regenerate them; the main watch command also watches the README.
During standalone development, run `jlpm watch:guide` in a Pixi shell to update
the guide as you edit it.

The two notebooks in `lite/files` demonstrate the C23 and C++23 kernels. Keep
their source cells short, preserve kernel metadata, and save without execution
counts or outputs. Link to the generated guide for explorer instructions. Run
both notebooks through the browser suite after editing their code or links.

`lite/empack_config.yaml` excludes the shared interpreter libraries from kernel
package archives because xeus loads them through the kernelspec's `shared`
metadata. The libraries remain in the site; both kernels must run successfully
after changes to these filters.

The Lite build also defers jupyterlite-xeus 5.0's optional PyPI/conda name
lookup until use. The upstream eager fetch otherwise rejects during offline
notebook startup. This checked adaptation touches only generated bundles and
must be reviewed when updating jupyterlite-xeus. It preserves the lookup for
package commands.

## Checks

```sh
pixi run --as-is jlpm lint:check
pixi run --as-is jlpm typecheck
pixi run --as-is jlpm test
pixi run --as-is jlpm playwright install
pixi run --as-is jlpm test:browser
```

Build all three hosts and the combined site before browser tests. Linux CI
installs browser system dependencies with `jlpm playwright install --with-deps`.
Browser tests start local servers, exercise non-root paths, and cover actual
compiler behavior, asset failures, cancellation, recovery, persistence, and
offline compilation. See [ui-tests/README.md](ui-tests/README.md) for the
matrix.

Main, worker, unit-test, and browser-test TypeScript configurations are
separate. Worker code has worker globals rather than DOM globals. ESLint checks
Jupyter import boundaries and pure domain imports. Vite rejects Jupyter modules
in the standalone production build.

## Packaging

After building all hosts:

```sh
pixi run --as-is jlpm pack --out dist/wasmbolt.tgz
pixi run --as-is python -m build --no-isolation
pixi run --as-is jlpm test:packages
pixi run --as-is python scripts/release.py
pixi run --as-is actionlint
```

The checks read the npm archive, wheel, source distribution, extension,
standalone site, and Lite site. Every compiler file must match the generated
manifest; the worker and manifest must match the current build too. They also
verify every local site URL against the combined static site. Source archives
include the built local site, so installing one requires no frontend build.

Test the actual wheel in a clean environment without JupyterLab:

```sh
pixi run --as-is python -m venv work/wheel-env
work/wheel-env/bin/python -m pip install --no-index --no-deps \
  dist/wasmbolt-*.whl
work/wheel-env/bin/python -I -m unittest discover -s tests -v
WASMBOLT_LOCAL_COMMAND=work/wheel-env/bin/wasmbolt \
  pixi run --as-is jlpm test:browser ui-tests/tests/site.spec.ts
```

The browser tests launch the installed command and run the explorer and both
notebook kernels with external requests blocked. CI runs this alongside the
native JupyterLab extension installation check.

The release check validates package metadata, checks PyPI's file limit, runs
Twine and npm's offline pack dry run, and writes `dist/release.json` with
archive sizes and hashes. It validates local archives even when their version is
already published. See [RELEASE.md](RELEASE.md) for publishing from GitHub
releases and recovering failed uploads. Keep `package.json` as the version
source; staging, commits, and tags remain the user's responsibility.

If installing a release in Pixi fails on `labextensions/wasmbolt/package.json`,
run `unlink .pixi/envs/default/share/jupyter/labextensions/wasmbolt` from the
repository root to remove the broken development link, then retry with
`pixi run --as-is python -m pip install --force-reinstall wasmbolt`.
