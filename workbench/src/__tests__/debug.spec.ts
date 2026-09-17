import { CommandRegistry } from '@lumino/commands';

import { CommandIDs, registerCommands } from '../commands';
import type { ICompiler } from '../compiler/types';
import type { IDebuggerClient } from '../lldb/debugger';
import { initial, reduce } from '../model';
import { createStore } from '../state';

it('tracks breakpoints and paused debugger state immutably', () => {
  const original = initial();
  const breakpoint = reduce(original, {
    type: 'debug-toggle-breakpoint',
    path: original.activeFile,
    line: 2
  });
  expect(original.debugger.breakpoints).toEqual([]);
  expect(breakpoint.debugger.breakpoints).toEqual([
    {
      path: original.activeFile,
      line: 2,
      verified: null
    }
  ]);
  const stopped = reduce(breakpoint, {
    type: 'debug-stopped',
    frames: [
      {
        id: 7,
        name: 'square_plus_one',
        path: original.activeFile,
        line: 2,
        column: 3
      }
    ],
    frameId: 7,
    variables: [{ name: 'value', type: 'int', value: '6' }],
    reason: 'breakpoint'
  });
  expect(stopped.debugger).toMatchObject({
    status: 'stopped',
    frameId: 7,
    message: 'breakpoint',
    variables: [{ name: 'value', type: 'int', value: '6' }]
  });
  expect(
    reduce(stopped, { type: 'debug-exited', exitCode: 37 }).debugger.message
  ).toBe('Process exited with code 37.');
});

it('wires debug commands to one selected Wasm module', async () => {
  const commands = new CommandRegistry();
  const store = createStore(initial());
  let publish: Parameters<IDebuggerClient['subscribe']>[0] = () => {};
  const unsubscribe = jest.fn();
  const debuggerClient: IDebuggerClient = {
    start: jest.fn(async () => {}),
    setBreakpoints: jest.fn(async () => {}),
    continue: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    stepOver: jest.fn(async () => {}),
    stepIn: jest.fn(async () => {}),
    stepOut: jest.fn(async () => {}),
    restart: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    selectFrame: jest.fn(async () => {}),
    command: jest.fn(async () => {}),
    subscribe(listener) {
      publish = listener;
      return unsubscribe;
    },
    dispose: jest.fn()
  };
  const compiler: ICompiler = {
    initialize: jest.fn(),
    compile: jest.fn(),
    command: jest.fn(),
    cancel: jest.fn(),
    dispose: jest.fn()
  };
  const registered = registerCommands(commands, {
    store,
    compiler,
    debugger: debuggerClient,
    resetLayout: jest.fn(),
    compare: jest.fn(),
    activatePane: jest.fn(),
    copy: jest.fn(),
    download: jest.fn(),
    runner: { run: jest.fn(), reset: jest.fn(), dispose: jest.fn() }
  });
  store.dispatch({
    type: 'file-import',
    path: '/workspace/debug.wasm',
    data: Uint8Array.of(0, 97, 115, 109)
  });
  await commands.execute(CommandIDs.toggleBreakpoint, {
    path: '/workspace/snippet.cpp',
    line: 2
  });
  await commands.execute(CommandIDs.startDebugging);
  expect(debuggerClient.start).toHaveBeenCalledWith(
    expect.objectContaining({
      module: '/workspace/debug.wasm',
      argv: [],
      breakpoints: [
        expect.objectContaining({ path: '/workspace/snippet.cpp', line: 2 })
      ]
    })
  );
  publish({
    type: 'stopped',
    threadId: 1,
    reason: 'breakpoint',
    frames: [
      {
        id: 1,
        name: 'main',
        path: '/workspace/snippet.cpp',
        line: 2,
        column: 1
      }
    ],
    frameId: 1,
    variables: [{ name: 'value', value: '6', type: 'int' }]
  });
  expect(store.state.debugger.status).toBe('stopped');
  expect(store.state.position?.line).toBe(2);
  await commands.execute(CommandIDs.stepOver);
  expect(debuggerClient.stepOver).toHaveBeenCalledTimes(1);
  registered.dispose();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
