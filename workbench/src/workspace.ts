import type { File, Language } from './compiler/types';
import { sourceName } from './compiler/types';
import { examples, xtensorExample } from './examples';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export const workspaceRoot = '/workspace';

export const exampleFiles: readonly File[] = [
  sourceFile('cpp', examples.cpp),
  sourceFile('c', examples.c),
  sourceFile('llvm', examples.llvm),
  sourceFile('mlir', examples.mlir),
  {
    path: `${workspaceRoot}/xtensor.cpp`,
    data: encoder.encode(xtensorExample)
  }
];

export function sourcePath(language: Language): string {
  return `${workspaceRoot}/${sourceName(language)}`;
}

export function languageForPath(path: string): Language | null {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'c') {
    return 'c';
  }
  if (
    ['cc', 'cpp', 'cxx', 'c++', 'h', 'hh', 'hpp', 'hxx'].includes(extension)
  ) {
    return 'cpp';
  }
  if (extension === 'll') {
    return 'llvm';
  }
  return extension === 'mlir' ? 'mlir' : null;
}

export function text(file: File): string | null {
  if (file.data.subarray(0, 1024).includes(0)) {
    return null;
  }
  try {
    return decoder.decode(file.data);
  } catch {
    return null;
  }
}

export function workspacePath(name: string): string {
  const path = name.trim().replace(/\\/g, '/');
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (!base || base === '.' || base === '..' || base.includes('\0')) {
    throw new Error('Choose a valid file name.');
  }
  return `${workspaceRoot}/${base}`;
}

export function replaceFile(files: readonly File[], file: File): File[] {
  return [...files.filter(entry => entry.path !== file.path), file].sort(
    (left, right) => left.path.localeCompare(right.path)
  );
}

function sourceFile(language: Language, source: string): File {
  return { path: sourcePath(language), data: encoder.encode(source) };
}
