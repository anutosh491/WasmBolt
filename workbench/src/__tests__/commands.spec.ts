import { CommandRegistry } from '@lumino/commands';

import { CommandIDs, registerCommands } from '../commands';
import type { ICompiler, Result } from '../compiler/types';
import { initial, options, stale } from '../model';
import { createStore } from '../state';

const info = {
  version: 'LLVM 23.1.0',
  resourceDirectory: '/lib/clang/23',
  targets: [options.target]
};

it('routes edits and releases command registrations', async () => {
  const commands = new CommandRegistry();
  const store = createStore(initial());
  const activatePane = jest.fn();
  let finish: (result: Result) => void = () => {
    throw new Error('not started');
  };
  const compile = jest.fn(
    () =>
      new Promise<Result>(resolve => {
        finish = resolve;
      })
  );
  const compiler: ICompiler = {
    initialize: async () => info,
    command: jest.fn(),
    compile,
    cancel: jest.fn(),
    dispose: jest.fn()
  };
  const registered = registerCommands(commands, {
    store,
    compiler,
    resetLayout: jest.fn(),
    compare: jest.fn(),
    activatePane,
    copy: jest.fn(),
    download: jest.fn(),
    runner: { run: jest.fn(), reset: jest.fn(), dispose: jest.fn() }
  });
  const running = commands.execute(CommandIDs.compile);
  expect(commands.isEnabled(CommandIDs.compile)).toBe(false);
  expect(commands.isEnabled(CommandIDs.cancel)).toBe(true);
  await Promise.resolve();
  await commands.execute(CommandIDs.setSource, {
    source: 'edited while compiling'
  });
  finish({
    id: 1,
    sourcePath: '/workspace/snippet.cpp',
    artifacts: [],
    stages: [],
    files: [],
    diagnostics: [],
    commands: [],
    stdout: '',
    stderr: '',
    exitCode: 1,
    duration: 1
  });
  await running;
  expect(compile).toHaveBeenCalledWith(
    expect.objectContaining({ output: 'assembly' }),
    expect.any(Function)
  );
  expect(stale(store.state)).toBe(true);
  expect(activatePane).not.toHaveBeenCalled();
  expect(commands.isEnabled(CommandIDs.compile)).toBe(true);
  registered.dispose();
  expect(commands.hasCommand(CommandIDs.compile)).toBe(false);
  store.dispose();
});

it('keeps cancellation distinct from worker failure', async () => {
  const commands = new CommandRegistry();
  const store = createStore(initial());
  let reject: (error: Error) => void = () => {
    throw new Error('not started');
  };
  const compiler: ICompiler = {
    initialize: onProgress => {
      onProgress?.({ phase: 'preparing' });
      return new Promise((_, failure) => {
        reject = failure;
      });
    },
    command: jest.fn(),
    compile: jest.fn(),
    cancel: () => reject(new Error('terminated')),
    dispose: jest.fn()
  };
  const registered = registerCommands(commands, {
    store,
    compiler,
    resetLayout: jest.fn(),
    compare: jest.fn(),
    activatePane: jest.fn(),
    copy: jest.fn(),
    download: jest.fn(),
    runner: { run: jest.fn(), reset: jest.fn(), dispose: jest.fn() }
  });
  const running = commands.execute(CommandIDs.compile);
  expect(store.state.progress).toEqual({ phase: 'preparing' });
  await commands.execute(CommandIDs.cancel);
  await running;
  expect(store.state.status).toBe('cancelled');
  expect(store.state.notice).toBeNull();
  expect(store.state.progress).toBeNull();
  registered.dispose();
});

it('keeps output selections when closing a restored comparison', async () => {
  const commands = new CommandRegistry();
  const store = createStore(initial());
  const compare = jest.fn();
  const registered = registerCommands(commands, {
    store,
    compiler: {
      initialize: jest.fn(),
      compile: jest.fn(),
      command: jest.fn(),
      cancel: jest.fn(),
      dispose: jest.fn()
    },
    resetLayout: jest.fn(),
    compare,
    activatePane: jest.fn(),
    copy: jest.fn(),
    download: jest.fn(),
    runner: { run: jest.fn(), reset: jest.fn(), dispose: jest.fn() }
  });
  expect(commands.isToggled(CommandIDs.compare)).toBe(false);
  await commands.execute(CommandIDs.compare);
  expect(store.state.outputs).toEqual({
    primary: 'ir',
    comparison: 'optimized'
  });
  store.dispatch({
    type: 'layout',
    layout: {
      type: 'split-area',
      orientation: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        { type: 'tab-area', widgets: ['outputs'], currentIndex: 0 },
        { type: 'tab-area', widgets: ['comparison'], currentIndex: 0 }
      ]
    }
  });
  await commands.execute(CommandIDs.selectOutput, {
    group: 'primary',
    output: 'assembly'
  });
  await commands.execute(CommandIDs.selectOutput, {
    group: 'comparison',
    output: 'analysis'
  });
  expect(commands.isToggled(CommandIDs.compare)).toBe(true);
  const outputs = store.state.outputs;
  await commands.execute(CommandIDs.compare);
  expect(store.state.outputs).toBe(outputs);
  expect(compare).toHaveBeenCalledTimes(2);
  registered.dispose();
  store.dispose();
});
