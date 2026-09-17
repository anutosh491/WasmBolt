import {
  canRun,
  currentModule,
  initial,
  options,
  reduce,
  snapshot,
  stale
} from '../model';
import type { Result } from '../compiler/types';
import { createStore } from '../state';
import { session } from '../persistence';

const result: Result = {
  id: 1,
  sourcePath: '/workspace/snippet.cpp',
  artifacts: [],
  stages: [],
  files: [],
  diagnostics: [],
  commands: [],
  stdout: '',
  stderr: '',
  exitCode: 0,
  duration: 10
};

it('enables Run only when a current module can be reused or built', () => {
  const state = initial();
  expect(canRun(state)).toBe(true);
  expect(canRun(reduce(state, { type: 'begin', id: 1 }))).toBe(false);
  expect(canRun(reduce(state, { type: 'run-begin', id: 1 }))).toBe(false);
  for (const options of [
    { ...state.options, language: 'mlir' as const },
    { ...state.options, target: 'x86_64-unknown-linux-gnu' as const }
  ]) {
    const changed = reduce(state, { type: 'options', options });
    expect(canRun(changed)).toBe(false);
    const path = '/workspace/manual.wasm';
    const selected = {
      ...changed,
      execution: { ...changed.execution, module: path },
      moduleRevisions: { [path]: changed.revision }
    };
    expect(canRun(selected)).toBe(true);
    expect(canRun(reduce(selected, { type: 'source', source: 'edited' }))).toBe(
      false
    );
  }
});

it('associates output with its original input', () => {
  const original = Object.freeze(initial());
  const started = reduce(original, { type: 'begin', id: 1 });
  const edited = reduce(started, { type: 'source', source: 'new source' });
  const finished = reduce(edited, { type: 'finished', id: 1, result });
  expect(original.revision).toBe(0);
  expect(finished.source).toBe('new source');
  expect(stale(finished)).toBe(true);
  expect(finished.result?.revision).toBe(0);
});

it('does not make an old Wasm module current after a partial build', () => {
  const wasm = {
    path: '/workspace/program.wasm',
    data: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
  };
  const imported = reduce(initial(), {
    type: 'file-import',
    path: wasm.path,
    data: wasm.data
  });
  const edited = reduce(imported, { type: 'source', source: 'edited' });
  const started = reduce(edited, { type: 'begin', id: 2 });
  const finished = reduce(started, {
    type: 'finished',
    id: 2,
    result: { ...result, id: 2, files: [wasm] }
  });
  expect(currentModule(finished)).toBe(false);
});

it('ignores a response after cancellation or a newer request', () => {
  const started = reduce(initial(), { type: 'begin', id: 1 });
  const cancelled = reduce(started, { type: 'cancelled' });
  expect(reduce(cancelled, { type: 'finished', id: 1, result })).toBe(
    cancelled
  );
  const newer = reduce(cancelled, { type: 'begin', id: 2 });
  expect(reduce(newer, { type: 'finished', id: 1, result })).toBe(newer);
});

it('clears progress outside the current initialization', () => {
  const progress = { phase: 'preparing' as const };
  const action = { type: 'progress' as const, id: 1, progress };
  const started = reduce(initial(), { type: 'begin', id: 1 });
  const loading = reduce(started, action);
  expect(loading.progress).toBe(progress);
  expect(started.progress).toBeNull();
  expect(snapshot(loading)).not.toHaveProperty('progress');
  const cancelled = reduce(loading, { type: 'cancelled' });
  expect(cancelled.progress).toBeNull();
  expect(reduce(cancelled, action)).toBe(cancelled);
  const retry = reduce(cancelled, { type: 'begin', id: 2 });
  expect(reduce(retry, action)).toBe(retry);
  const initialized = reduce(loading, {
    type: 'initialized',
    id: 1,
    info: { version: 'LLVM', resourceDirectory: '/', targets: [] },
    compile: true
  });
  expect(initialized.progress).toBeNull();
  expect(reduce(initialized, action).progress).toBe(progress);
  expect(
    reduce(loading, { type: 'failed', id: 1, message: 'missing' }).progress
  ).toBeNull();
});

it('keeps snapshots stable and removes subscriptions on disposal', () => {
  const store = createStore(initial());
  const listener = jest.fn();
  const unsubscribe = store.subscribe(listener);
  const before = store.state;
  store.dispatch({ type: 'source', source: before.source });
  expect(store.state).toBe(before);
  expect(listener).not.toHaveBeenCalled();
  store.dispatch({ type: 'options', options: { ...options, optimization: 3 } });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  store.dispatch({ type: 'source', source: 'changed' });
  expect(listener).toHaveBeenCalledTimes(1);
  const saved = store.state;
  store.dispose();
  store.dispatch({ type: 'source', source: 'ignored' });
  expect(store.state).toBe(saved);
});

it('validates saved inputs and pane identities', () => {
  const saved = snapshot(initial());
  expect(session(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  expect(session({ ...saved, version: 3 })).toBeNull();
  expect(
    session({ ...saved, options: { ...options, optimization: 99 } })
  ).toBeNull();
  expect(
    session({
      ...saved,
      layout: {
        type: 'tab-area',
        widgets: ['source', 'source', 'diagnostics'],
        currentIndex: 0
      }
    })
  ).toBeNull();
  const layout = {
    type: 'tab-area',
    widgets: [
      'explorer',
      'source',
      'outputs',
      'diagnostics',
      'terminal',
      'debugger',
      'run',
      'pipelines'
    ],
    currentIndex: 1
  };
  expect(session({ ...saved, layout })?.layout).toEqual(layout);
});

it('keeps output selections applicable when language and target change', () => {
  let state = reduce(initial(), {
    type: 'output',
    group: 'primary',
    output: 'wasm'
  });
  state = reduce(state, {
    type: 'options',
    options: { ...state.options, target: 'x86_64-unknown-linux-gnu' }
  });
  expect(state.outputs.primary).toBe('assembly');
  state = reduce(state, {
    type: 'options',
    options: { ...state.options, language: 'mlir' }
  });
  expect(state.outputs).toEqual({ primary: 'mlir', comparison: 'graphs' });
  expect(
    reduce(state, { type: 'output', group: 'primary', output: 'ast' })
  ).toBe(state);
  const saved = { ...snapshot(state), outputs: initial().outputs };
  expect(initial(saved).outputs).toEqual(state.outputs);
});

it('switches source files without discarding edits', () => {
  const original = initial();
  const mlir = { ...original.options, language: 'mlir' as const };
  expect(reduce(original, { type: 'options', options: mlir }).source).toContain(
    'func.func'
  );
  const edited = reduce(original, { type: 'source', source: 'my experiment' });
  const changed = reduce(edited, { type: 'options', options: mlir });
  expect(changed.source).toContain('func.func');
  const selected = reduce(changed, {
    type: 'file-select',
    path: '/workspace/snippet.cpp'
  });
  expect(selected.source).toBe('my experiment');
  expect(selected.revision).toBe(changed.revision + 1);
  expect(snapshot(selected).activeFile).toBe('/workspace/snippet.cpp');
});

it('creates and imports workspace files without corrupting binary data', () => {
  const original = initial();
  const created = reduce(original, {
    type: 'file-create',
    path: '/workspace/new.c'
  });
  expect(created.activeFile).toBe('/workspace/new.c');
  expect(created.options.language).toBe('c');
  const bytes = Uint8Array.of(0, 97, 115, 109);
  const imported = reduce(created, {
    type: 'file-import',
    path: '/workspace/module.wasm',
    data: bytes
  });
  expect(imported.files.find(file => file.path.endsWith('.wasm'))?.data).toBe(
    bytes
  );
  expect(imported.activeFile).toBe('/workspace/new.c');
});
