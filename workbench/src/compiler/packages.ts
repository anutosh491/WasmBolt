import { asset } from './assets';
import type { IFilesystem } from './module';
import { isRecord } from './protocol';
import type { Progress } from './types';

type EmpackPackage = Readonly<{ filename: string }>;

/** Restore an empack environment into the compiler filesystem. */
export async function installPackages(
  base: string,
  files: unknown,
  fs: IFilesystem,
  onProgress: (progress: Progress) => void
): Promise<void> {
  const metadata = await asset(
    base,
    files,
    'packages/empack_env_meta.json',
    onProgress
  );
  const value: unknown = JSON.parse(new TextDecoder().decode(metadata));
  if (
    !isRecord(value) ||
    value.prefix !== '/' ||
    !Array.isArray(value.packages)
  ) {
    throw new Error('The empack environment metadata is invalid.');
  }
  const packages = value.packages.map(packageEntry);
  for (const entry of packages) {
    const compressed = await asset(
      base,
      files,
      `packages/${entry.filename}`,
      onProgress
    );
    unpackTar(fs, await decompress(compressed));
  }
}

function packageEntry(value: unknown): EmpackPackage {
  if (
    !isRecord(value) ||
    typeof value.filename !== 'string' ||
    !/^[A-Za-z0-9_.+-]+\.tar\.gz$/.test(value.filename)
  ) {
    throw new Error('The empack package description is invalid.');
  }
  return { filename: value.filename };
}

async function decompress(bytes: ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot decompress empack packages.');
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extract the regular files produced by empack's filtered package archives. */
export function unpackTar(fs: IFilesystem, archive: Uint8Array): void {
  let offset = 0;
  let extendedPath: string | null = null;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      return;
    }
    const size = octal(header, 124, 136);
    const type = String.fromCharCode(header[156] || 48);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    if (body.byteLength !== size) {
      throw new Error('An empack archive is truncated.');
    }
    if (type === 'x') {
      extendedPath = paxPath(body);
    } else {
      const name = extendedPath ?? tarName(header);
      extendedPath = null;
      const path = packagePath(name);
      if (type === '0' || type === '\0') {
        const slash = path.lastIndexOf('/');
        fs.mkdirTree(slash === 0 ? '/' : path.slice(0, slash));
        fs.writeFile(path, body.slice());
      } else if (type === '5') {
        fs.mkdirTree(path);
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('An empack archive has no terminating block.');
}

function tarName(header: Uint8Array): string {
  const name = text(header, 0, 100);
  const prefix = text(header, 345, 500);
  return prefix ? `${prefix}/${name}` : name;
}

function packagePath(name: string): string {
  const parts = name.replace(/^\.\//, '').split('/').filter(Boolean);
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..')) {
    throw new Error('An empack archive contains an unsafe path.');
  }
  return `/${parts.join('/')}`;
}

function text(bytes: Uint8Array, start: number, end: number): string {
  const zero = bytes.subarray(start, end).indexOf(0);
  return new TextDecoder().decode(
    bytes.subarray(start, zero < 0 ? end : start + zero)
  );
}

function octal(bytes: Uint8Array, start: number, end: number): number {
  const value = text(bytes, start, end).trim();
  if (!/^[0-7]+$/.test(value)) {
    throw new Error('An empack archive has an invalid size.');
  }
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('An empack archive entry is too large.');
  }
  return result;
}

function paxPath(bytes: Uint8Array): string | null {
  const records = new TextDecoder().decode(bytes);
  let offset = 0;
  let path: string | null = null;
  while (offset < records.length) {
    const space = records.indexOf(' ', offset);
    if (space < 0) {
      throw new Error('An empack archive has invalid PAX metadata.');
    }
    const length = Number.parseInt(records.slice(offset, space), 10);
    if (!Number.isSafeInteger(length) || length <= space - offset + 1) {
      throw new Error('An empack archive has invalid PAX metadata.');
    }
    const record = records.slice(space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0 && record.slice(0, equals) === 'path') {
      path = record.slice(equals + 1);
    }
    offset += length;
  }
  return path;
}
