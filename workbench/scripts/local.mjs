import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'fortitudo/site');
const content = new Map();
const routes = {};

function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`Local site assets must be regular files: ${path}`);
    }
    return entry.isDirectory()
      ? files(resolve(directory, entry.name), `${path}/`)
      : [path];
  });
}

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// The extension already owns the compiler. Every URL in the combined site
// resolves to a packaged file, with identical assets stored only once.
const extension = resolve(root, 'fortitudo/labextension');
for (const path of files(extension)) {
  content.set(hash(resolve(extension, path)), ['extension', path]);
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const site = resolve(root, 'dist/site');
for (const path of files(site)) {
  const source = resolve(site, path);
  const digest = hash(source);
  let asset = content.get(digest);
  if (!asset) {
    const destination = resolve(output, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    asset = ['site', path];
    content.set(digest, asset);
  }
  routes[`/${path}`] = asset;
}
writeFileSync(
  resolve(output, 'routes.json'),
  JSON.stringify(routes, null, 2) + '\n'
);
process.stdout.write(`Local site: ${Object.keys(routes).length} asset URLs\n`);
