import { diagnostics, uniqueDiagnostics } from '../compiler/diagnostics';
import { isInput, isOutput } from '../compiler/protocol';
import { invocation, serialize } from '../compiler/request';
import { options } from '../model';

const info = {
  version: 'LLVM 23.1.0',
  resourceDirectory: '/lib/clang/23',
  targets: [options.target]
};

describe('compiler requests', () => {
  it('retains each argument through GNU quoting', () => {
    expect(serialize(['clang++', 'a b', 'say "hi"', 'a\\b', ''])).toBe(
      '"clang++" "a b" "say \\"hi\\"" "a\\\\b" ""'
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
    expect(plan.steps[2].commands[0]).toContain('-passes=default<O2>');
    expect(plan.steps[5].commands[0]).toContain(
      '-mtriple=wasm32-unknown-emscripten'
    );
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
    expect(plan.steps.map(step => step.name)).toEqual([
      'ir',
      'optimized',
      'object',
      'wasm'
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
