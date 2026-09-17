import type { CommandRegistry } from '@lumino/commands';
import type { IDisposable } from '@lumino/disposable';
import type { Message } from '@lumino/messaging';
import { BoxPanel } from '@lumino/widgets';
import * as React from 'react';

import { CommandIDs, registerCommands } from './commands';
import { createRunner } from './compiler/runner';
import type { IRunner } from './compiler/execution';
import { createCompiler } from './compiler/client';
import type { ICompiler, OutputKind } from './compiler/types';
import { initial, snapshot } from './model';
import type { Pane, Session } from './model';
import { session } from './persistence';
import type { IPersistence } from './persistence';
import { createStore } from './state';
import type { IStore } from './state';
import { Bridge } from './ui/bridge';
import type { ISharing } from './share';
import { OutputPanel } from './ui/outputpanel';
import { PanePanel } from './ui/panels';
import { ReactWidget } from './widget';

export interface IWorkbenchOptions {
  commands: CommandRegistry;
  workerUrl: URL;
  persistence: IPersistence;
  defaults?: Session;
  sharing?: ISharing;
}

/** Load editing state without initializing or invoking the compiler. */
export async function createWorkbench(
  options: IWorkbenchOptions
): Promise<Workbench> {
  let saved = options.defaults ?? null;
  let notice: string | null = null;
  try {
    const value = await options.persistence.load();
    if (value !== null && value !== undefined) {
      const parsed = session(value);
      if (parsed) {
        saved = parsed;
      } else {
        notice = 'Saved state is invalid. A default session was opened.';
      }
    }
  } catch (error) {
    notice = `Saved state could not be loaded: ${String(error)}`;
  }
  try {
    saved = options.sharing?.read() ?? saved;
  } catch (error) {
    notice = String(error);
  }
  const store = createStore(initial(saved));
  if (notice) {
    store.dispatch({ type: 'notice', message: notice });
  }
  return new Workbench(options, store);
}

/** Own the complete session and release its resources when closed. */
export class Workbench extends BoxPanel {
  constructor(
    private readonly options: IWorkbenchOptions,
    private readonly store: IStore
  ) {
    super({ direction: 'top-to-bottom', spacing: 0 });
    this.id = 'fortitudo-workbench';
    this.title.label = 'Fortitudo';
    this.title.iconClass = 'fortitudo-icon';
    this.title.closable = true;
    this.addClass('fortitudo-workbench');
    this.compiler = createCompiler(options.workerUrl);
    this.runner = createRunner(options.workerUrl);
    const header = this.view('controls');
    header.addClass('fortitudo-header');
    this.addWidget(header);
    const panes = {
      source: this.view('source'),
      outputs: new OutputPanel(store, options.commands, 'primary', kind =>
        this.view('outputs', kind)
      ),
      comparison: new OutputPanel(store, options.commands, 'comparison', kind =>
        this.view('comparison', kind)
      ),
      diagnostics: this.view('diagnostics'),
      files: this.view('files'),
      terminal: this.view('terminal'),
      run: this.view('run'),
      pipelines: this.view('pipelines')
    };
    panes.source.title.label = 'Source';
    panes.outputs.title.label = 'Outputs';
    panes.comparison.title.label = 'Comparison';
    panes.files.title.label = 'Files';
    panes.terminal.title.label = 'Terminal';
    panes.run.title.label = 'Run';
    panes.pipelines.title.label = 'Pipelines';
    panes.diagnostics.title.label = 'Diagnostics';
    this.panels = new PanePanel(panes, store.state.layout, () =>
      this.layoutChanged()
    );
    this.addWidget(this.panels);
    BoxPanel.setStretch(this.panels, 1);
    this.registered = registerCommands(options.commands, {
      store,
      compiler: this.compiler,
      runner: this.runner,
      sharing: options.sharing,
      resetLayout: () => this.panels.reset(),
      compare: () => this.panels.compare(),
      activatePane: pane => this.panels.activatePane(pane),
      copy: text => navigator.clipboard.writeText(text),
      download: file => {
        const url = URL.createObjectURL(new Blob([file.data]));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = file.path.slice(file.path.lastIndexOf('/') + 1);
          link.click();
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    });
    this.binding = options.commands.addKeyBinding({
      command: CommandIDs.compile,
      keys: ['Accel Enter'],
      selector: '.fortitudo-workbench'
    });
    let previous = snapshot(store.state);
    let position = store.state.position;
    this.unsubscribe = store.subscribe(() => {
      const next = snapshot(store.state);
      if (
        next.source !== previous.source ||
        next.options !== previous.options ||
        next.layout !== previous.layout ||
        next.outputs !== previous.outputs ||
        next.timeout !== previous.timeout
      ) {
        previous = next;
        this.pending = next;
        this.save();
      }
      if (store.state.position !== position) {
        position = store.state.position;
        this.panels.activatePane('source');
      }
    });
  }

  /** Hosts await pending saves before reopening the single session. */
  get saved(): Promise<void> {
    return this.waitForSave();
  }

  dispose(): void {
    if (!this.isDisposed) {
      this.unsubscribe();
      this.binding.dispose();
      this.registered.dispose();
      this.compiler.dispose();
      this.runner.dispose();
      this.store.dispose();
      super.dispose();
    }
  }

  protected onCloseRequest(): void {
    this.dispose();
  }

  protected onActivateRequest(message: Message): void {
    super.onActivateRequest(message);
    this.panels.activatePane('source');
  }

  private view(pane: Pane | 'controls', output?: OutputKind): ReactWidget {
    const resize = (height: number) => {
      widget.node.style.minHeight = `${Math.ceil(height)}px`;
      widget.node.style.maxHeight = `${Math.ceil(height)}px`;
      this.fit();
    };
    const widget = new ReactWidget(() => (
      <Bridge
        store={this.store}
        commands={this.options.commands}
        pane={pane}
        output={output}
        canShare={!!this.options.sharing}
        onSize={resize}
      />
    ));
    widget.addClass('fortitudo-view');
    widget.node.dataset.pane = pane;
    if (output) {
      widget.node.dataset.output = output;
    }
    return widget;
  }

  private layoutChanged(): void {
    if (this.isDisposed) {
      return;
    }
    void this.options.commands
      .execute(CommandIDs.saveLayout, {
        layout: this.panels.save()
      })
      .catch(error => {
        this.store.dispatch({ type: 'notice', message: String(error) });
      });
  }

  private save(): void {
    if (this.saving) {
      return;
    }
    this.saving = (async () => {
      while (this.pending) {
        const value = this.pending;
        this.pending = null;
        try {
          await this.options.persistence.save(value);
        } catch (error) {
          this.store.dispatch({
            type: 'notice',
            message: `Session could not be saved: ${String(error)}`
          });
        }
      }
    })().finally(() => {
      this.saving = null;
      if (this.pending) {
        this.save();
      }
    });
  }

  private async waitForSave(): Promise<void> {
    while (this.saving) {
      await this.saving;
    }
  }

  private readonly panels: PanePanel;
  private readonly compiler: ICompiler;
  private readonly runner: IRunner;
  private readonly registered: IDisposable;
  private readonly binding: IDisposable;
  private readonly unsubscribe: () => void;
  private pending: Session | null = null;
  private saving: Promise<void> | null = null;
}
