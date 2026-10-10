// A small UI-side mirror of /workspace; the compiler's real FS stays in its Worker.
export function createWorkspace() {
  const files = new Map(), directories = new Set(['/', '/workspace']);
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const path = name => {
    const value = name.startsWith('/') ? name : `/workspace/${name}`;
    if (value.split('/').some(part => part === '..')) throw new Error('Invalid workspace path');
    return value.replace(/\/$/, '') || '/';
  };
  return {
    mkdirTree(name) {
      let directory = '';
      for (const part of path(name).split('/').filter(Boolean)) {
        directory += '/' + part; directories.add(directory);
      }
    },
    chdir() {},
    writeFile(name, bytes) {
      files.set(path(name), typeof bytes === 'string' ? encoder.encode(bytes) : bytes.slice());
    },
    readFile(name, options = {}) {
      const bytes = files.get(path(name));
      if (!bytes) throw new Error(`No such file: ${name}`);
      return options.encoding === 'utf8' ? decoder.decode(bytes) : bytes.slice();
    },
    stat(name) {
      const value = path(name);
      if (directories.has(value)) return { mode: 0o040000, size: 0 };
      if (!files.has(value)) throw new Error(`No such file: ${name}`);
      return { mode: 0o100000, size: files.get(value).length };
    },
    isDir(mode) { return (mode & 0o170000) === 0o040000; },
    readdir(name) {
      const prefix = path(name) === '/' ? '/' : path(name) + '/';
      return ['.', '..', ...new Set([...directories, ...files.keys()]
        .filter(value => value.startsWith(prefix) && value !== prefix)
        .map(value => value.slice(prefix.length).split('/')[0]).filter(Boolean))];
    },
    unlink(name) {
      if (!files.delete(path(name))) throw new Error(`No such file: ${name}`);
    },
  };
}

export const swiftExampleNames = ['fibonacci.swift', 'fizzbuzz.swift', 'math.swift', 'main.swift'];
export async function loadSwiftExamples() {
  const response = await fetch(new URL('./workspace-examples.json', import.meta.url));
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('Swift workspace examples could not load');
  return response.json();
}
