import type { IFilesystem, IModuleRuntime } from '../compiler/module';
import type { IPipelineTools } from '../compiler/pipeline';
import { runtime } from '../compiler/runtime';
import { files } from '../compiler/files';
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

function setup(failure: 'link' | 'optimization' | null) {
  const fs = new Filesystem();
  const calls: (readonly string[])[] = [];
  const module: IModuleRuntime = {
    fs,
    isolatedTools: ['opt', 'llc'],
    prepareDebugSysroot: jest.fn(async () => {}),
    info: {
      version: 'LLVM',
      targets: [options.target],
      resourceDirectory: '/'
    },
    call: () => ({
      value: { status: 'success', value: 0 },
      stdout: '',
      stderr: ''
    }),
    run(args) {
      calls.push(args);
      if (failure === 'link' && args[0] === 'wasm-ld') {
        return { value: 1, stdout: '', stderr: 'error: deliberate failure' };
      }
      const outputIndex = args.indexOf('-o');
      const output = outputIndex < 0 ? null : args[outputIndex + 1];
      if (output) {
        fs.writeFile(output, 'generated content');
      }
      return {
        value: 0,
        stdout: args.includes('-ast-dump') ? 'AST' : '',
        stderr: ''
      };
    }
  };
  const pipeline: IPipelineTools = {
    async run(id, args) {
      if (args[0] !== 'opt' && args[0] !== 'llc') {
        return null;
      }
      calls.push(args);
      const failed =
        failure === 'optimization' &&
        args.some(argument => argument.includes('default<O2>'));
      const outputIndex = args.indexOf('-o');
      const output = outputIndex < 0 ? null : args[outputIndex + 1];
      if (!failed && output) {
        fs.writeFile(output, 'generated content');
      }
      return {
        id,
        files: files(fs),
        stage: {
          name: args[0],
          status: failed ? 'failed' : 'success',
          commands: [],
          diagnostics: [],
          stdout: '',
          stderr: failed ? 'error: deliberate failure' : '',
          exitCode: failed ? 1 : 0,
          duration: 1
        }
      };
    },
    cancel() {},
    dispose() {}
  };
  return { service: runtime(module, pipeline), calls };
}

it('builds a runnable C++ module without isolated opt or llc', async () => {
  const { service, calls } = setup(null);
  const result = await service.compile(
    {
      id: 1,
      source: 'int square(int x) { return x * x; }',
      sourcePath: '/workspace/snippet.cpp',
      files: [],
      options,
      output: 'wasm'
    },
    () => {}
  );
  expect(result.exitCode).toBe(0);
  expect(result.stages.map(stage => stage.name)).toEqual(['object', 'wasm']);
  expect(calls.map(args => args[0])).toEqual(['clang++', 'wasm-ld']);
  expect(result.commands[0]).toContain(' -c ');
  expect(result.commands[1]).toContain('wasm-ld');
});

it('keeps independent outputs when linking fails', async () => {
  const { service } = setup('link');
  const result = await service.compile(
    {
      id: 1,
      source: 'int x;',
      sourcePath: '/workspace/snippet.cpp',
      files: [],
      options
    },
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
    {
      id: 1,
      source: 'int x;',
      sourcePath: '/workspace/snippet.cpp',
      files: [],
      options
    },
    () => {}
  );
  expect(result.artifacts.map(artifact => artifact.kind)).toEqual([
    'ast',
    'ir'
  ]);
  expect(calls.some(args => args[0] === 'llc')).toBe(false);
  expect(result.stages.find(stage => stage.name === 'wasm')?.status).toBe(
    'skipped'
  );
});
