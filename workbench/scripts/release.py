"""Check release metadata and write archive sizes and SHA-256 hashes."""

from email.parser import BytesParser
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import zipfile


root = Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text())
version = package['version']
dist = root / 'dist'
npm = dist / 'fortitudo.tgz'
sdist = dist / f'fortitudo-{version}.tar.gz'
wheel = dist / f'fortitudo-{version}-py3-none-any.whl'
expected = {npm, sdist, wheel}
archives = {
    path for pattern in ['*.tgz', '*.tar.gz', '*.whl']
    for path in dist.glob(pattern)
}
if archives != expected:
    raise ValueError('dist must contain exactly the three current archives.')


def check_metadata(data, label):
    metadata = BytesParser().parsebytes(data)
    if metadata['Name'] != 'fortitudo' or metadata['Version'] != version:
        raise ValueError(f'{label}: package name or version does not match.')


with tarfile.open(npm) as archive:
    member = archive.extractfile('package/package.json')
    if member is None:
        raise ValueError('The npm archive has no package metadata.')
    if json.load(member) != package:
        raise ValueError('The npm archive contains stale package metadata.')

with tarfile.open(sdist) as archive:
    member = archive.extractfile(f'fortitudo-{version}/PKG-INFO')
    if member is None:
        raise ValueError('The source archive has no Python metadata.')
    check_metadata(member.read(), sdist.name)

with zipfile.ZipFile(wheel) as archive:
    check_metadata(
        archive.read(f'fortitudo-{version}.dist-info/METADATA'), wheel.name
    )

for path in [sdist, wheel]:
    if path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError(f'{path.name} exceeds PyPI\'s 100 MiB file limit.')

subprocess.run(
    [sys.executable, '-m', 'twine', 'check', '--strict',
     str(sdist), str(wheel)],
    check=True,
)
subprocess.run(
    ['npm', 'pack', str(npm), '--dry-run', '--ignore-scripts',
     '--offline', '--json'],
    cwd=root,
    stdout=subprocess.DEVNULL,
    check=True,
)

report = {
    'name': package['name'],
    'version': version,
    'revision': os.environ.get('GITHUB_SHA'),
    'files': {},
}
for path in sorted(expected):
    with path.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    size = path.stat().st_size
    report['files'][path.name] = {'bytes': size, 'sha256': digest}
    print(f'{path.name}: {size / 1024 / 1024:.2f} MiB; {digest}')

(dist / 'release.json').write_text(json.dumps(report, indent=2) + '\n')
