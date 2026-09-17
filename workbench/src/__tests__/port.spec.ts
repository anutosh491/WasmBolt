import { command } from '../compiler/terminal';
import { inspectWasm } from '../compiler/wasm';
import { invocation } from '../compiler/request';
import { isFiles, isInput, isOutput } from '../compiler/protocol';
import { currentModule, initial, options, reduce, snapshot } from '../model';
import { session } from '../persistence';
import { decodeShare, encodeShare } from '../sharing';
import { createSharing } from '../share';

const wasm = Uint8Array.from([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127, 3, 2, 1, 0, 7, 10,
  1, 6, 115, 113, 117, 97, 114, 101, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 0, 108, 11
]);

it('reads exported scalar signatures without executing the module', () => {
  expect(inspectWasm(wasm).functions).toEqual([
    {
      name: 'square',
      params: ['i32'],
      results: ['i32'],
      signature: 'i32(i32)',
      signatureCode: 1
    }
  ]);
  for (let i = 1; i < wasm.length; i++) {
    // A complete prefix ending at a section boundary can still be inspected.
    if (![8, 16, 20, 32].includes(i)) {
      expect(() => inspectWasm(wasm.slice(0, i))).toThrow();
    }
  }
  expect(() =>
    inspectWasm(
      Uint8Array.from([...wasm.slice(0, 8), 1, 255, 255, 255, 255, 31])
    )
  ).toThrow();
});

it('parses quoted commands and redirections without a shell', () => {
  expect(
    command('opt "-passes=print<domtree>" "source file.ll" 2> "tree.txt"')
  ).toEqual({
    tool: 'opt',
    command: '"opt" "-passes=print<domtree>" "source file.ll"',
    stdout: null,
    stderr: 'tree.txt'
  });
  expect(command('clang -fsyntax-only input.c > ast.txt').stdout).toBe(
    'ast.txt'
  );
  for (const invalid of ['opt "unclosed', 'opt x 2>', 'opt x | dot', 'sh x']) {
    expect(() => command(invalid)).toThrow();
  }
});

it('plans applicable outputs with a single optimization stage', () => {
  const info = {
    version: 'LLVM',
    resourceDirectory: '/lib/clang/23',
    targets: []
  };
  const plan = (language: typeof options.language, target = options.target) =>
    invocation(
      {
        id: 1,
        source: '',
        sourcePath: `/workspace/${
          language === 'llvm'
            ? 'input.ll'
            : language === 'mlir'
              ? 'input.mlir'
              : language === 'c'
                ? 'snippet.c'
                : 'snippet.cpp'
        }`,
        files: [],
        options: { ...options, language, target }
      },
      info,
      '/workspace'
    );
  const cpp = plan('cpp');
  expect(cpp.steps.find(step => step.name === 'ir')?.commands[0]).toContain(
    '-disable-llvm-passes'
  );
  expect(cpp.steps.filter(step => step.name === 'optimized')).toHaveLength(1);
  expect(cpp.steps.find(step => step.name === 'wasm')?.requires).toEqual([
    'object'
  ]);
  expect(plan('llvm').steps.some(step => step.name === 'ast')).toBe(false);
  expect(
    plan('c', 'x86_64-unknown-linux-gnu').steps.some(
      step => step.name === 'wasm'
    )
  ).toBe(false);
  expect(plan('mlir').steps.map(step => step.name)).toEqual(['mlir', 'graphs']);
});

it('migrates v1 layouts without losing edits or split proportions', () => {
  const saved = session({
    version: 1,
    source: 'saved source',
    options: { language: 'c', target: options.target, optimization: 3 },
    layout: {
      type: 'split-area',
      orientation: 'horizontal',
      sizes: [0.3, 0.7],
      children: [
        { type: 'tab-area', widgets: ['source'], currentIndex: 0 },
        {
          type: 'tab-area',
          widgets: ['assembly', 'diagnostics'],
          currentIndex: 0
        }
      ]
    }
  });
  expect(saved?.version).toBe(2);
  expect(saved?.source).toBe('saved source');
  expect(saved?.layout).toMatchObject({
    sizes: [0.3, 0.7],
    children: [
      { widgets: ['source'] },
      {
        widgets: [
          'outputs',
          'diagnostics',
          'explorer',
          'terminal',
          'debugger',
          'run',
          'pipelines'
        ]
      }
    ]
  });
  expect(saved?.outputs.primary).toBe('assembly');
  expect(session({ ...snapshot(initial()), version: '2' })).toBeNull();
});

it('shares Unicode inputs without results or layout', () => {
  const state = {
    ...snapshot(initial()),
    source: '// λ 🍵\nint café;',
    options: { ...options, llvmPipeline: 'mem2reg' }
  };
  const restored = decodeShare(encodeShare(state));
  expect(restored.source).toBe(state.source);
  expect(restored.options).toEqual(state.options);
  expect(restored.layout).toBeNull();
  expect(restored).not.toHaveProperty('files');
  expect(() => decodeShare('not.a.link')).toThrow();
  const url = new URL('https://example.test/fortitudo/');
  url.searchParams.set('fortitudo', encodeShare(state));
  const sharing = createSharing(url);
  expect(sharing.read()?.source).toBe(state.source);
  expect(sharing.read()).toBeNull();
});

it('retains workspace buffers and ignores execution after stop', () => {
  const files = [{ path: '/workspace/program.wasm', data: wasm }];
  const state = reduce(reduce(initial(), { type: 'begin', id: 1 }), {
    type: 'command',
    id: 1,
    result: {
      id: 1,
      files,
      stage: {
        name: 'wasm-ld',
        status: 'success',
        commands: [],
        diagnostics: [],
        stdout: '',
        stderr: '',
        exitCode: 0,
        duration: 1
      }
    }
  });
  expect(state.execution.symbol).toBe('square');
  expect(currentModule(state)).toBe(true);
  expect(state.files[0].data).toBe(wasm);
  const running = reduce(state, { type: 'run-begin', id: 2 });
  const stopped = reduce(running, { type: 'run-reset' });
  expect(
    reduce(stopped, {
      type: 'run-finished',
      id: 2,
      result: {
        id: 2,
        status: 'success',
        value: 25,
        stdout: '',
        stderr: '',
        duration: 1
      }
    })
  ).toBe(stopped);
  expect(snapshot(stopped)).not.toHaveProperty('execution');
  expect(wasm[0]).toBe(0);
  const edited = reduce(state, { type: 'source', source: 'new source' });
  const inspected = reduce(reduce(edited, { type: 'begin', id: 3 }), {
    type: 'command',
    id: 3,
    result: {
      id: 3,
      files: [{ path: '/workspace/program.wasm', data: wasm.slice() }],
      stage: state.terminal[0]
    }
  });
  expect(inspected.filesRevision).toBe(inspected.revision);
  expect(currentModule(inspected)).toBe(false);
});

it('guards binary snapshots and calls, allowing NaN returns', () => {
  expect(isFiles([{ path: '/workspace/../lib/a', data: wasm }])).toBe(false);
  expect(isFiles([{ path: '/workspace/a', data: [1, 2] }])).toBe(false);
  expect(isFiles([{ path: '/workspace//a', data: wasm }])).toBe(false);
  expect(isFiles([{ path: '/workspace/', data: wasm }])).toBe(false);
  const request = {
    id: 1,
    module: '/workspace/program.wasm',
    symbol: 'square',
    signatureCode: 1,
    files: [{ path: '/workspace/program.wasm', data: wasm }],
    args: [5]
  };
  expect(isInput({ kind: 'execute', id: 1, request })).toBe(true);
  for (const args of [[1.5], [], [1, 2]]) {
    expect(
      isInput({ kind: 'execute', id: 1, request: { ...request, args } })
    ).toBe(false);
  }
  expect(
    isOutput({
      kind: 'execution',
      id: 1,
      result: {
        id: 1,
        status: 'success',
        value: NaN,
        stdout: '',
        stderr: '',
        duration: 1
      }
    })
  ).toBe(true);
});
