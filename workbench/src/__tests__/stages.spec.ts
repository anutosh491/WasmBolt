import type { IFilesystem, IModuleRuntime } from '../compiler/module';
import { runtime } from '../compiler/runtime';
import { options } from '../model';

class Filesystem implements IFilesystem {
  private readonly entries = new Map<string, Uint8Array>();
  mkdirTree(): void {}
  chdir(): void {}
  stat() {
    return { mode: 0 };
  }
  isDir() {
    return false;
  }
  rmdir(): void {}
  unlink(path: string): void {
    this.entries.delete(path);
  }
  writeFile(path: string, data: string | Uint8Array): void {
    this.entries.set(
      path,
      typeof data === 'string' ? new TextEncoder().encode(data) : data
    );
  }
  readFile(path: string): Uint8Array;
  readFile(path: string, options: { encoding: 'utf8' }): string;
  readFile(path: string, options?: { encoding: 'utf8' }): string | Uint8Array {
    const data = this.entries.get(path);
    if (!data) {
      throw new Error('Missing file: ' + path);
    }
    return options ? new TextDecoder().decode(data) : data.slice();
  }
  readdir(path: string): string[] {
    return [
      '.',
      '..',
      ...[...this.entries.keys()]
        .filter(name => name.startsWith(path + '/'))
        .map(name => name.slice(path.length + 1))
    ];
  }
}

function setup(failure: 'link' | 'optimization') {
  const fs = new Filesystem();
  const calls: string[] = [];
  const module: IModuleRuntime = {
    fs,
    info: {
      version: 'LLVM',
      targets: [options.target],
      resourceDirectory: '/'
    },
    ensureMlir: async () => {},
    call: () => ({
      value: { status: 'success', value: 0 },
      stdout: '',
      stderr: ''
    }),
    run(command) {
      calls.push(command);
      if (
        (failure === 'link' && command.startsWith('"wasm-ld"')) ||
        (failure === 'optimization' && command.includes('default<O2>'))
      ) {
        return { value: 1, stdout: '', stderr: 'error: deliberate failure' };
      }
      const output = command.match(/"-o" "([^"]+)"/)?.[1];
      if (output) {
        fs.writeFile(output, 'generated content');
      }
      return {
        value: 0,
        stdout: command.includes('-ast-dump') ? 'AST' : '',
        stderr: ''
      };
    }
  };
  return { service: runtime(module), calls };
}

it('keeps independent outputs when linking fails', async () => {
  const { service } = setup('link');
  const result = await service.compile(
    { id: 1, source: 'int x;', options },
    () => {}
  );
  expect(result.exitCode).toBe(1);
  expect(result.artifacts.map(artifact => artifact.kind)).toEqual(
    expect.arrayContaining(['ast', 'ir', 'optimized', 'assembly', 'object'])
  );
  expect(result.stages.find(stage => stage.name === 'wasm')?.status).toBe(
    'failed'
  );
  expect(result.stages.find(stage => stage.name === 'assembly')?.status).toBe(
    'success'
  );
  expect(
    result.artifacts.find(artifact => artifact.kind === 'ast')
  ).toMatchObject({ text: 'AST' });
});

it('skips dependent stages after a failed optimization', async () => {
  const { service, calls } = setup('optimization');
  const result = await service.compile(
    { id: 1, source: 'int x;', options },
    () => {}
  );
  expect(result.artifacts.map(artifact => artifact.kind)).toEqual([
    'ast',
    'ir'
  ]);
  expect(calls.some(command => command.startsWith('"llc"'))).toBe(false);
  expect(result.stages.find(stage => stage.name === 'wasm')?.status).toBe(
    'skipped'
  );
});
