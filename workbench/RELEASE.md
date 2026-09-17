# Releasing Fortitudo

Publishing a stable GitHub release runs `publish-release.yml`, which builds,
checks, and publishes Fortitudo to npm and PyPI using trusted publishing.
`package.json` is the version source. Staging, commits, pushing, and tags remain
the maintainer's responsibility.

## Publish a release

1. Set a new stable version in `package.json` that has not been published to
   either registry.
2. Commit and push the changes. Wait for the main branch checks to pass.
3. Create a matching `v<version>` tag at that commit. The tagged commit must
   include the release workflow.
4. Publish a stable GitHub release for that tag. This starts **Publish Release**
   automatically; no manual Actions run is needed.
5. Confirm that the workflow succeeds and the expected version appears on
   [npm](https://www.npmjs.com/package/fortitudo) and
   [PyPI](https://pypi.org/project/fortitudo/). Install that exact Python
   version in a fresh Python environment. Run `fortitudo`, compile a function,
   and run both example notebooks through **Try in Jupyter**. Also check the
   extension in a JupyterLab environment.

The workflow requires the tag to match the package version. Drafts wait until
publication, and prereleases are skipped. Ordinary pushes, pull requests, and
release-note edits do not publish packages. The npm `latest` tag follows each
successful stable release.

## Checks and artifacts

The release workflow rebuilds the pinned compiler without using cached compiler
output, builds all hosts, validates package contents and metadata, runs the
browser suite, and tests installation of the wheel. Both publishing jobs wait
for these checks to pass.

The Actions run provides these artifacts:

| Artifact               | Contents                                     |
| ---------------------- | -------------------------------------------- |
| `npm-distribution`     | The npm archive, `fortitudo.tgz`             |
| `python-distributions` | The wheel and source archive                 |
| `distributions`        | Packages, static sites, and release metadata |
| `browser-results`      | Browser reports and compiler measurements    |

Review `dist/release.json` in `distributions` for archive sizes, SHA-256 hashes,
and the source revision. Keep the compiler manifest and measurements with the
release. See [CONTRIBUTING.md](CONTRIBUTING.md#packaging) for local package
checks.

## Manual runs and recovery

In **Actions → Publish Release → Run workflow**, select the existing version tag
and a destination:

- `none`: build and validate without publishing; use this to check a tag before
  publishing its GitHub release.
- `pypi` or `npm`: publish only to that registry.
- `both`: publish to both registries.

Manual runs use the same tag validation and build checks. Avoid manually
publishing a version and then publishing its GitHub release: the automatic run
would attempt duplicate uploads.

If one registry succeeds and the other fails, rerun only the failed job in the
same Actions run. If a new run is needed, select only the failed registry as its
destination. Duplicate uploads are errors and are not silently skipped. If the
source needs a correction, prepare a new version; do not move a published tag or
try to overwrite an existing package version.

Trusted publishing uses `afshin/fortitudo`, `publish-release.yml`, and the
GitHub environments `npm` and `pypi`. Keep the registry configuration in sync if
these names change. Both environments are restricted to `v*` tags.
