import { CommandRegistry } from '@lumino/commands';

import { CommandIDs } from '../commands';
import { initial, snapshot } from '../model';
import type { Session } from '../model';
import { createWorkbench } from '../workbench';

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
        'diagnostics',
        'files',
        'terminal',
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
    currentIndex: 1
  });
  await commands.execute(CommandIDs.resetLayout);
  await workbench.saved;
  expect(writes.at(-1)?.layout?.type).toBe('split-area');
  expect(writes.every(value => value.source === saved.source)).toBe(true);
  workbench.close();
  expect(writes).toHaveLength(2);
});
