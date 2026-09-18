import { unpackTar } from '../compiler/packages';
import type { IFilesystem } from '../compiler/module';

function archive(name: string, contents: string): Uint8Array {
  const encoder = new TextEncoder();
  const data = encoder.encode(contents);
  const result = new Uint8Array(
    512 + Math.ceil(data.length / 512) * 512 + 1024
  );
  result.set(encoder.encode(name), 0);
  result.set(
    encoder.encode(data.length.toString(8).padStart(11, '0') + '\0'),
    124
  );
  result[156] = '0'.charCodeAt(0);
  result.set(data, 512);
  return result;
}

function filesystem() {
  const written = new Map<string, Uint8Array>();
  const directories: string[] = [];
  const fs = {
    mkdirTree(path: string) {
      directories.push(path);
    },
    writeFile(path: string, data: string | Uint8Array) {
      written.set(
        path,
        typeof data === 'string' ? new TextEncoder().encode(data) : data
      );
    }
  } as unknown as IFilesystem;
  return { fs, written, directories };
}

it('restores empack package files at their prefix paths', () => {
  const { fs, written, directories } = filesystem();
  unpackTar(fs, archive('include/xtensor/xarray.hpp', 'header'));
  expect(directories).toContain('/include/xtensor');
  expect(
    new TextDecoder().decode(written.get('/include/xtensor/xarray.hpp'))
  ).toBe('header');
});

it('rejects paths escaping the browser prefix', () => {
  const { fs } = filesystem();
  expect(() =>
    unpackTar(fs, archive('../workspace/replace.cpp', 'bad'))
  ).toThrow('unsafe path');
});
