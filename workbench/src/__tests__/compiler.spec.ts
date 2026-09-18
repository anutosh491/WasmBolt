import { diagnostics, uniqueDiagnostics } from '../compiler/diagnostics';
import { isInput, isOutput } from '../compiler/protocol';
import {
  debugInvocation,
  debugWrapper,
  invocation,
  serialize
} from '../compiler/request';
import { options } from '../model';

const info = {
  version: 'LLVM 23.1.0',
  resourceDirectory: '/lib/clang/23',
  targets: [options.target]
};

describe('compiler requests', () => {
  it('formats each argument as a readable shell command', () => {
    expect(serialize(['clang++', 'a b', 'say "hi"', 'a\\b', ''])).toBe(
      `clang++ 'a b' 'say "hi"' 'a\\b' ''`
    );
    expect(serialize(['opt', '-passes=default<O2>', 'input.ll'])).toBe(
      "opt '-passes=default<O2>' input.ll"
    );
    expect(() => serialize(['a\0b'])).toThrow('null bytes');
  });

  it('constructs the requested compiler pipeline', () => {
    const request = {
      id: 1,
      source: '',
      sourcePath: '/workspace/request-1/snippet.cpp',
      files: [],
      options
    };
    const plan = invocation(request, info, '/workspace/request-1');
    expect(plan.steps.map(step => step.name)).toEqual([
      'ast',
      'ir',
      'optimized',
      'analysis',
      'graphs',
      'assembly',
      'object',
      'wasm'
    ]);
    expect(plan.steps[1].commands[0]).toContain('-std=c++23');
    expect(plan.steps[1].commands[0]).toContain('/include/c++/v1');
    expect(plan.steps[1].commands[0]).toContain('-fvisibility=default');
    expect(plan.steps[1].commands[0]).toContain('-fvisibility-inlines-hidden');
    expect(plan.steps[2].commands[0]).toContain('-passes=default<O2>');
    expect(plan.steps[5].commands[0]).toContain(
      '-mtriple=wasm32-unknown-emscripten'
    );
    expect(plan.steps.at(-1)?.commands[0]).not.toContain('--export-all');
    expect(plan.source).toBe('/workspace/request-1/snippet.cpp');
  });

  it('plans only a selected output and its prerequisites', () => {
    const plan = invocation(
      {
        id: 2,
        source: '',
        sourcePath: '/workspace/request-2/snippet.cpp',
        files: [],
        options,
        output: 'wasm'
      },
      info,
      '/workspace/request-2'
    );
    expect(plan.steps.map(step => step.name)).toEqual(['object', 'wasm']);
    expect(plan.steps[0].requires).toEqual([]);
    expect(plan.steps[0].commands[0]).toEqual(
      expect.arrayContaining([
        'clang++',
        '-O2',
        '-c',
        '/workspace/request-2/snippet.cpp',
        '-o',
        '/workspace/request-2/output.o'
      ])
    );
    expect(plan.steps[0].commands[0]).not.toContain('llc');
    expect(plan.steps[1].commands[0]).toEqual([
      'wasm-ld',
      '-shared',
      '--unresolved-symbols=import-dynamic',
      '/workspace/request-2/output.o',
      '-o',
      '/workspace/request-2/program.wasm'
    ]);
  });

  it('keeps opt and llc for explicit compiler representations', () => {
    const plan = invocation(
      {
        id: 4,
        source: '',
        sourcePath: '/workspace/snippet.cpp',
        files: [],
        options,
        output: 'assembly'
      },
      info,
      '/workspace'
    );
    expect(plan.steps.map(step => step.name)).toEqual([
      'ir',
      'optimized',
      'assembly'
    ]);
    expect(plan.steps[1].commands[0][0]).toBe('opt');
    expect(plan.steps[2].commands[0][0]).toBe('llc');
  });

  it('honors an explicit LLVM pipeline in a runnable module', () => {
    const plan = invocation(
      {
        id: 5,
        source: '',
        sourcePath: '/workspace/snippet.cpp',
        files: [],
        options: { ...options, llvmPipeline: 'mem2reg' },
        output: 'wasm'
      },
      info,
      '/workspace'
    );
    expect(plan.steps.map(step => step.name)).toEqual([
      'ir',
      'optimized',
      'object',
      'wasm'
    ]);
    expect(plan.steps[1].commands[0]).toContain('-passes=mem2reg');
    expect(plan.steps[2].commands[0][0]).toBe('llc');
  });

  it('uses the same direct module path for C', () => {
    const plan = invocation(
      {
        id: 6,
        source: '',
        sourcePath: '/workspace/snippet.c',
        files: [],
        options: { ...options, language: 'c' },
        output: 'wasm'
      },
      info,
      '/workspace'
    );
    expect(plan.steps.map(step => step.name)).toEqual(['object', 'wasm']);
    expect(plan.steps[0].commands[0].slice(0, 4)).toEqual([
      'clang',
      '-x',
      'c',
      '-std=c23'
    ]);
  });

  it('plans MLIR optimization and translation with complete argv', () => {
    const plan = invocation(
      {
        id: 3,
        source: '',
        sourcePath: '/workspace/input.mlir',
        files: [],
        options: { ...options, language: 'mlir' },
        output: 'ir'
      },
      info,
      '/workspace'
    );
    expect(plan.steps.map(step => step.name)).toEqual(['mlir', 'ir']);
    expect(plan.steps[0].commands[0]).toEqual([
      'mlir-opt',
      `--pass-pipeline=${options.mlirPipeline}`,
      '/workspace/input.mlir',
      '-o',
      '/workspace/optimized.mlir'
    ]);
    expect(plan.steps[1].commands[0]).toEqual([
      'mlir-translate',
      '--mlir-to-llvmir',
      '/workspace/optimized.mlir',
      '-o',
      '/workspace/source.ll'
    ]);
  });

  it('does not supply the Wasm sysroot to native targets', () => {
    const plan = invocation(
      {
        id: 2,
        source: '',
        sourcePath: '/workspace/request-2/snippet.c',
        files: [],
        options: {
          ...options,
          language: 'c',
          optimization: 0,
          target: 'x86_64-unknown-linux-gnu'
        }
      },
      info,
      '/workspace/request-2'
    );
    expect(plan.steps[1].commands[0]).toContain('-std=c23');
    expect(plan.steps[1].commands[0]).toContain('/lib/clang/23/include');
    expect(plan.steps[1].commands[0]).not.toContain('/include');
    expect(plan.steps[2].commands[0]).toContain('-passes=default<O0>');
  });

  it('builds a standalone debug program around a selected export', () => {
    const entry = {
      symbol: '_Z13sum_invariantii',
      signature: {
        params: ['i32', 'i32'] as const,
        results: ['i32'] as const
      },
      args: [2, 3]
    };
    const plan = debugInvocation(
      {
        id: 7,
        source: '',
        sourcePath: '/workspace/snippet.cpp',
        files: [],
        options
      },
      info,
      '/workspace',
      entry
    );

    expect(plan.wrapper).toEqual({
      path: '/workspace/.wasmbolt-debug-main.cpp',
      source: debugWrapper(entry)
    });
    expect(plan.wrapper?.source).toContain('asm("_Z13sum_invariantii")');
    expect(plan.wrapper?.source).toContain('wasmbolt_debug_target(2, 3)');
    expect(plan.commands.map(command => command[0])).toEqual([
      'clang++',
      'clang++',
      'wasm-ld'
    ]);
    expect(plan.commands[0]).toEqual(
      expect.arrayContaining(['-O0', '-g3', '-c'])
    );
    expect(plan.commands[2]).toContain('/lib/wasm32-emscripten/crt1.o');
    expect(plan.commands[2]).not.toContain('--no-entry');
    expect(plan.commands[2]).not.toContain('-shared');
    expect(plan.module).toBe('/workspace/debug.wasm');
  });

  it('uses an existing main without generating a debug wrapper', () => {
    const plan = debugInvocation(
      {
        id: 8,
        source: '',
        sourcePath: '/workspace/main.c',
        files: [],
        options: { ...options, language: 'c' }
      },
      info,
      '/workspace',
      null
    );

    expect(plan.wrapper).toBeNull();
    expect(plan.generated).toEqual(['/workspace/debug.o']);
    expect(plan.commands.map(command => command[0])).toEqual([
      'clang',
      'wasm-ld'
    ]);
  });
});

describe('diagnostics', () => {
  it('deduplicates stage summaries while preserving distinct locations', () => {
    const [error] = diagnostics('input.c:1:2: error: missing name');
    const second = { ...error, line: 2 };
    expect(uniqueDiagnostics([error, { ...error }, second])).toEqual([
      error,
      second
    ]);
  });

  it('parses source locations and global errors', () => {
    expect(
      diagnostics(
        [
          '/workspace/snippet.cpp:2:4: error: expected expression',
          '   invalid(',
          '   ^',
          '/include/thing.h:7:2: note: declared here',
          'clang: warning: argument unused',
          'fatal error: no input files'
        ].join('\n')
      )
    ).toEqual([
      {
        file: '/workspace/snippet.cpp',
        line: 2,
        column: 4,
        severity: 'error',
        message: 'expected expression'
      },
      {
        file: '/include/thing.h',
        line: 7,
        column: 2,
        severity: 'note',
        message: 'declared here'
      },
      {
        file: null,
        line: null,
        column: null,
        severity: 'warning',
        message: 'argument unused'
      },
      {
        file: null,
        line: null,
        column: null,
        severity: 'error',
        message: 'no input files'
      }
    ]);
  });
});

it('rejects malformed messages before they reach the compiler', () => {
  expect(isInput({ kind: 'compile', id: 1, request: { source: '' } })).toBe(
    false
  );
  expect(
    isOutput({ kind: 'ready', id: 1, info: { ...info, targets: ['bogus'] } })
  ).toBe(false);
  expect(isOutput({ kind: 'ready', id: 1, info })).toBe(true);
});

it.each([
  { loaded: -1, total: 10 },
  { loaded: 11, total: 10 },
  { loaded: 1, total: 0 },
  { loaded: 0.5, total: 10 },
  { loaded: NaN, total: 10 },
  { loaded: 1, total: Infinity }
])('rejects invalid download counts: %p', counts => {
  expect(
    isOutput({
      kind: 'progress',
      id: 1,
      progress: {
        phase: 'downloading',
        downloads: [{ name: 'Compiler.wasm', ...counts }]
      }
    })
  ).toBe(false);
});
