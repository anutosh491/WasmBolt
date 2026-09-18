import { CommandRegistry } from '@lumino/commands';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommandIDs, registerCommands } from '../commands';
import type { ICompiler } from '../compiler/types';
import type { IDebuggerClient } from '../lldb/debugger';
import { initial, reduce } from '../model';
import { createStore } from '../state';
import { Debugger } from '../ui/debug';

const debugCallbacks = {
  onStartDebugging: jest.fn(),
  onContinueDebugging: jest.fn(),
  onPauseDebugging: jest.fn(),
  onStepOver: jest.fn(),
  onStepIn: jest.fn(),
  onStepOut: jest.fn(),
  onRestartDebugging: jest.fn(),
  onStopDebugging: jest.fn(),
  onSelectFrame: jest.fn(),
  onDebugCommand: jest.fn()
};

it('keeps every debugger control visible with state-based availability', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    createElement(Debugger, { state: initial(), ...debugCallbacks })
  );
  const controls = [
    ['Start', false],
    ['Continue', true],
    ['Step over', true],
    ['Step into', true],
    ['Step out', true],
    ['Restart', true],
    ['Stop', true]
  ] as const;
  for (const [label, disabled] of controls) {
    const button = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === label || button.title === label
    );
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(disabled);
  }
});

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
  expect(commands.isVisible(CommandIDs.showDebugger)).toBe(true);
  expect(commands.isEnabled(CommandIDs.startDebugging)).toBe(true);
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
  await commands.execute(CommandIDs.runCommand, {
    command: ' lldb   frame variable '
  });
  expect(debuggerClient.command).toHaveBeenCalledWith('frame variable');
  expect(compiler.command).not.toHaveBeenCalled();
  expect(store.state.terminal.at(-1)?.commands).toEqual([
    'lldb frame variable'
  ]);
  publish({
    type: 'console',
    channel: 'console',
    text: '(int) value = 6\n'
  });
  expect(store.state.terminal.at(-1)?.stdout).toBe('(int) value = 6');
  expect(store.state.debugger.console).toEqual([
    { channel: 'input', text: 'frame variable' },
    { channel: 'console', text: '(int) value = 6\n' }
  ]);
  registered.dispose();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('requires an active DAP session for terminal LLDB commands', async () => {
  const commands = new CommandRegistry();
  const store = createStore(initial());
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
    resetLayout: jest.fn(),
    compare: jest.fn(),
    activatePane: jest.fn(),
    copy: jest.fn(),
    download: jest.fn(),
    runner: { run: jest.fn(), reset: jest.fn(), dispose: jest.fn() }
  });
  expect(commands.isVisible(CommandIDs.showDebugger)).toBe(false);
  expect(commands.isEnabled(CommandIDs.startDebugging)).toBe(false);

  await commands.execute(CommandIDs.runCommand, {
    command: 'lldb breakpoint list'
  });

  expect(compiler.command).not.toHaveBeenCalled();
  expect(store.state.terminal.map(stage => stage.commands)).toEqual([
    ['lldb breakpoint list'],
    []
  ]);
  expect(store.state.terminal.at(-1)?.stderr).toBe(
    'The LLDB-DAP debugger is not available in this build.'
  );
  registered.dispose();
  store.dispose();
});
