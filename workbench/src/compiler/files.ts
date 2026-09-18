import type { IFilesystem } from './module';
import type { File } from './types';

/** Replace only the user workspace, never the packaged runtime filesystem. */
export function restore(fs: IFilesystem, files: readonly File[]): void {
  fs.chdir('/');
  fs.mkdirTree('/workspace');
  clear(fs, '/workspace');
  for (const file of files) {
    fs.mkdirTree(file.path.slice(0, file.path.lastIndexOf('/')));
    fs.writeFile(file.path, file.data);
  }
  fs.chdir('/workspace');
}

export function files(fs: IFilesystem, path = '/workspace'): File[] {
  return fs
    .readdir(path)
    .filter(name => name !== '.' && name !== '..')
    .sort()
    .flatMap(name => {
      const child = `${path}/${name}`;
      return fs.isDir(fs.stat(child).mode)
        ? files(fs, child)
        : [{ path: child, data: fs.readFile(child) }];
    });
}

function clear(fs: IFilesystem, path: string): void {
  for (const name of fs.readdir(path)) {
    if (name === '.' || name === '..') {
      continue;
    }
    const child = `${path}/${name}`;
    if (fs.isDir(fs.stat(child).mode)) {
      clear(fs, child);
      fs.rmdir(child);
    } else {
      fs.unlink(child);
    }
  }
}
