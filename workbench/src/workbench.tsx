import type { CommandRegistry } from '@lumino/commands';
import type { IDisposable } from '@lumino/disposable';
import type { Message } from '@lumino/messaging';
import { BoxPanel } from '@lumino/widgets';
import * as React from 'react';

import { createClangd } from './clangd/client';
import type { IClangdClient } from './clangd/types';
import { CommandIDs, registerCommands } from './commands';
import {
  loadCapabilities,
  threadedRuntimeSupport
} from './compiler/capabilities';
import type { Capabilities } from './compiler/capabilities';
import { createRunner } from './compiler/runner';
import type { IRunner } from './compiler/execution';
import { createCompiler } from './compiler/client';
import type { ICompiler, OutputKind } from './compiler/types';
import { createWatRenderer } from './compiler/wat';
import type { IWatRenderer } from './compiler/wat';
import { createDebugger } from './lldb/client';
import type { IDebuggerClient } from './lldb/debugger';
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
  clangd?: IClangdClient;
  debugger?: IDebuggerClient;
  wat?: IWatRenderer;
  preloadCompiler?: boolean;
}

/** Load editing state without initializing or invoking the compiler. */
export async function createWorkbench(
  options: IWorkbenchOptions
): Promise<Workbench> {
  const needsCapabilities =
    options.clangd === undefined || options.debugger === undefined;
  const detected = needsCapabilities
    ? await loadCapabilities(options.workerUrl)
    : { clangd: false, debugger: false };
  const threads = threadedRuntimeSupport();
  const capabilities: Capabilities = {
    clangd: options.clangd !== undefined || (threads && detected.clangd),
    debugger: options.debugger !== undefined || (threads && detected.debugger)
  };
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
  return new Workbench(options, store, capabilities);
}

/** Own the complete session and release its resources when closed. */
export class Workbench extends BoxPanel {
  constructor(
    private readonly options: IWorkbenchOptions,
    private readonly store: IStore,
    private readonly capabilities: Capabilities
  ) {
    super({ direction: 'top-to-bottom', spacing: 0 });
    this.id = 'wasmbolt-workbench';
    this.title.label = 'WasmBolt';
    this.title.iconClass = 'wasmbolt-icon';
    this.title.closable = true;
    this.addClass('wasmbolt-workbench');
    this.compiler = createCompiler(options.workerUrl);
    this.runner = createRunner(options.workerUrl);
    const assetBase = new URL('.', options.workerUrl);
    this.wat =
      options.wat ?? createWatRenderer(new URL('wat-worker.js', assetBase));
    this.clangd =
      options.clangd ??
      (capabilities.clangd
        ? createClangd({
            workerUrl: new URL('clangd-worker.js', assetBase),
            assetBase: new URL('clangd/', assetBase)
          })
        : null);
    this.debugger =
      options.debugger ??
      (capabilities.debugger
        ? createDebugger({
            workerUrl: new URL('debug-worker.js', assetBase),
            assetBase: new URL('lldb-dap/', assetBase)
          })
        : null);
    const header = this.view('controls');
    header.addClass('wasmbolt-header');
    this.addWidget(header);
    const panes = {
      explorer: this.view('explorer'),
      source: this.view('source'),
      outputs: new OutputPanel(store, options.commands, 'primary', kind =>
        this.view('outputs', kind)
      ),
      comparison: new OutputPanel(store, options.commands, 'comparison', kind =>
        this.view('comparison', kind)
      ),
      diagnostics: this.view('diagnostics'),
      terminal: this.view('terminal'),
      run: this.view('run'),
      pipelines: this.view('pipelines')
    };
    const debuggerPane = this.debugger ? this.view('debugger') : null;
    panes.explorer.title.label = 'Explorer';
    panes.source.title.label = 'Source';
    panes.outputs.title.label = 'Outputs';
    panes.comparison.title.label = 'Comparison';
    panes.terminal.title.label = 'Terminal';
    panes.run.title.label = 'Execute';
    if (debuggerPane) {
      debuggerPane.title.label = 'Debugger';
    }
    panes.pipelines.title.label = 'Pipelines';
    panes.diagnostics.title.label = 'Diagnostics';
    this.panels = new PanePanel(
      { ...panes, ...(debuggerPane ? { debugger: debuggerPane } : {}) },
      store.state.layout,
      () => this.layoutChanged(),
      ['run']
    );
    this.addWidget(this.panels);
    BoxPanel.setStretch(this.panels, 1);
    this.registered = registerCommands(options.commands, {
      store,
      compiler: this.compiler,
      runner: this.runner,
      debugger: this.debugger ?? undefined,
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
    if (options.preloadCompiler) {
      void options.commands.execute(CommandIDs.initialize).catch(error => {
        store.dispatch({ type: 'notice', message: String(error) });
      });
    }
    this.binding = options.commands.addKeyBinding({
      command: CommandIDs.compile,
      keys: ['Accel Enter'],
      selector: '.wasmbolt-workbench'
    });
    let previous = snapshot(store.state);
    let position = store.state.position;
    this.unsubscribe = store.subscribe(() => {
      const next = snapshot(store.state);
      if (
        next.source !== previous.source ||
        next.activeFile !== previous.activeFile ||
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
      this.wat.dispose();
      this.clangd?.dispose();
      this.debugger?.dispose();
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
        clangd={this.clangd}
        debuggerAvailable={this.capabilities.debugger}
        wat={this.wat}
        pane={pane}
        output={output}
        canShare={!!this.options.sharing}
        onSize={resize}
      />
    ));
    widget.addClass('wasmbolt-view');
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
  private readonly wat: IWatRenderer;
  private readonly clangd: IClangdClient | null;
  private readonly debugger: IDebuggerClient | null;
  private readonly registered: IDisposable;
  private readonly binding: IDisposable;
  private readonly unsubscribe: () => void;
  private pending: Session | null = null;
  private saving: Promise<void> | null = null;
}
