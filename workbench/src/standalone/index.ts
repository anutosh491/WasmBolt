import { CommandRegistry } from '@lumino/commands';
import { Widget } from '@lumino/widgets';

import { createSharing } from '../share';
import { createWorkbench } from '../workbench';
import type { Workbench } from '../workbench';

import '@lumino/widgets/style/index.css';
import '../../style/base.css';
import '../../style/standalone.css';

const commands = new CommandRegistry();
const sharing = createSharing(new URL(location.href));
const key = 'wasmbolt:session:v2';
const host = document.getElementById('wasmbolt');
if (!host) {
  throw new Error('The WasmBolt page attachment is missing.');
}
const button = document.createElement('button');
button.textContent = 'Open WasmBolt';
button.className = 'wasmbolt-open';
host.appendChild(button);
let current: Workbench | null = null;
let opening: Promise<void> | null = null;
let saved = Promise.resolve();

function open(): Promise<void> {
  if (current) {
    current.activate();
    return Promise.resolve();
  }
  opening ??= (async () => {
    await saved;
    const workbench = await createWorkbench({
      commands,
      sharing,
      preloadCompiler: true,
      workerUrl: new URL('compiler/worker.js', document.baseURI),
      persistence: {
        load: async () => {
          const value = localStorage.getItem(key);
          return value === null ? null : JSON.parse(value);
        },
        save: async value => localStorage.setItem(key, JSON.stringify(value))
      }
    });
    current = workbench;
    button.hidden = true;
    workbench.disposed.connect(() => {
      saved = workbench.saved;
      current = null;
      button.hidden = false;
      button.focus();
    });
    Widget.attach(workbench, host ?? document.body);
    workbench.activate();
  })().finally(() => {
    opening = null;
  });
  return opening;
}

function report(error: unknown): void {
  button.hidden = false;
  button.textContent = `Unable to open WasmBolt. Retry: ${String(error)}`;
}

button.addEventListener('click', () => {
  void open().catch(report);
});
document.addEventListener('keydown', event =>
  commands.processKeydownEvent(event)
);
window.addEventListener('resize', () => current?.update());
window.addEventListener('pagehide', () => current?.dispose());
void open().catch(report);
