import { CommandRegistry } from '@lumino/commands';

import type { IClangdClient } from '../clangd/types';
import { CommandIDs } from '../commands';
import type { IDebuggerClient } from '../lldb/debugger';
import { initial, snapshot } from '../model';
import type { Session } from '../model';
import { createWorkbench } from '../workbench';

afterEach(() => jest.restoreAllMocks());

function clangd(): IClangdClient {
  return {
    initialize: jest.fn(async () => {}),
    openDocument: jest.fn(async () => {}),
    changeDocument: jest.fn(async () => {}),
    closeDocument: jest.fn(),
    completion: jest.fn(async () => ({ isIncomplete: false, items: [] })),
    onDiagnostics: jest.fn(() => () => {}),
    suspend: jest.fn(),
    restart: jest.fn(async () => {}),
    dispose: jest.fn()
  };
}

function debuggerClient(): IDebuggerClient {
  return {
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
    subscribe: jest.fn(() => () => {}),
    dispose: jest.fn()
  };
}

it('coalesces saved edits and finishes persistence after closing', async () => {
  const commands = new CommandRegistry();
  const writes: Session[] = [];
  let release = () => {};
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  const workbench = await createWorkbench({
    commands,
    workerUrl: new URL('https://example.test/compiler/worker.js'),
    persistence: {
      load: async () => null,
      save: async value => {
        writes.push(value);
        await waiting;
      }
    }
  });
  await commands.execute(CommandIDs.setSource, { source: 'first' });
  await commands.execute(CommandIDs.setSource, { source: 'second' });
  await commands.execute(CommandIDs.setSource, { source: 'third' });
  workbench.close();
  expect(workbench.isDisposed).toBe(true);
  expect(commands.hasCommand(CommandIDs.compile)).toBe(false);
  expect(commands.keyBindings).toHaveLength(0);
  release();
  await workbench.saved;
  expect(writes.map(value => value.source)).toEqual(['first', 'third']);
  expect(writes.every(value => !('result' in value))).toBe(true);
});

it('saves navigation and layout reset without losing edits', async () => {
  const commands = new CommandRegistry();
  const writes: Session[] = [];
  const saved: Session = {
    ...snapshot(initial()),
    source: 'int restored() { return 42; }',
    layout: {
      type: 'tab-area',
      widgets: [
        'outputs',
        'source',
        'explorer',
        'diagnostics',
        'terminal',
        'debugger',
        'run',
        'pipelines'
      ],
      currentIndex: 0
    }
  };
  const workbench = await createWorkbench({
    commands,
    workerUrl: new URL('https://example.test/compiler/worker.js'),
    persistence: {
      load: async () => saved,
      save: async value => {
        writes.push(value);
      }
    }
  });
  expect(writes).toEqual([]);
  await commands.execute(CommandIDs.navigate, { line: 1, column: 1 });
  await workbench.saved;
  expect(writes.at(-1)?.layout).toEqual({
    ...saved.layout,
    widgets: [
      'outputs',
      'source',
      'explorer',
      'diagnostics',
      'terminal',
      'pipelines'
    ],
    currentIndex: 1
  });
  await commands.execute(CommandIDs.resetLayout);
  await workbench.saved;
  expect(writes.at(-1)?.layout?.type).toBe('split-area');
  expect(writes.every(value => value.source === saved.source)).toBe(true);
  workbench.close();
  expect(writes).toHaveLength(2);
});

it('preserves explicitly injected optional clients', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  const languageClient = clangd();
  const debugClient = debuggerClient();
  const workbench = await createWorkbench({
    commands: new CommandRegistry(),
    workerUrl: new URL('https://example.test/compiler/worker.js'),
    persistence: { load: async () => null, save: async () => {} },
    clangd: languageClient,
    debugger: debugClient
  });
  expect(fetch).not.toHaveBeenCalled();
  workbench.dispose();
  expect(languageClient.dispose).toHaveBeenCalledTimes(1);
  expect(debugClient.dispose).toHaveBeenCalledTimes(1);
});
