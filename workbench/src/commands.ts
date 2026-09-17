import type { CommandRegistry } from '@lumino/commands';
import { DisposableSet } from '@lumino/disposable';
import type { IDisposable } from '@lumino/disposable';

import { assemblyText } from './compiler/assembly';
import type { IRunner } from './compiler/execution';
import { isTimeout } from './compiler/execution';
import { command } from './compiler/terminal';
import { isOptions, isOutputKind, sourceName } from './compiler/types';
import type { File, ICompiler, Progress } from './compiler/types';
import { examples } from './examples';
import { canRun, currentModule, hasComparison, snapshot, stale } from './model';
import type { Pane } from './model';
import { session } from './persistence';
import type { ISharing } from './share';
import type { IStore } from './state';

export namespace CommandIDs {
  export const open = 'fortitudo:open';
  export const initialize = 'fortitudo:initialize';
  export const setSource = 'fortitudo:set-source';
  export const setOptions = 'fortitudo:set-options';
  export const compile = 'fortitudo:compile';
  export const cancel = 'fortitudo:cancel';
  export const resetLayout = 'fortitudo:reset-layout';
  export const saveLayout = 'fortitudo:save-layout';
  export const navigate = 'fortitudo:navigate';
  export const selectOutput = 'fortitudo:select-output';
  export const compare = 'fortitudo:compare';
  export const resetExample = 'fortitudo:reset-example';
  export const runCommand = 'fortitudo:run-command';
  export const clearTerminal = 'fortitudo:clear-terminal';
  export const run = 'fortitudo:run';
  export const stop = 'fortitudo:stop';
  export const selectModule = 'fortitudo:select-module';
  export const selectExport = 'fortitudo:select-export';
  export const setArguments = 'fortitudo:set-arguments';
  export const setTimeout = 'fortitudo:set-timeout';
  export const share = 'fortitudo:share';
  export const copy = 'fortitudo:copy';
  export const download = 'fortitudo:download';
}

/** Explicit services and host actions used by the shared commands. */
export interface ICommandContext {
  readonly store: IStore;
  readonly compiler: ICompiler;
  readonly runner: IRunner;
  readonly sharing?: ISharing;
  resetLayout(): void;
  compare(): void;
  activatePane(pane: Pane): void;
  copy(text: string): Promise<void>;
  download(file: File): void;
}

/** Register shared commands; each host owns the open command. */
export function registerCommands(
  commands: CommandRegistry,
  context: ICommandContext
): IDisposable {
  const { store, compiler, runner } = context;
  const disposables = new DisposableSet();
  let sequence = 0;
  let disposed = false;
  let startingRun = false;
  const idle = () => !disposed && store.state.active === null;
  const add = (id: string, options: CommandRegistry.ICommandOptions) =>
    disposables.add(commands.addCommand(id, options));

  async function build(compile: boolean): Promise<void> {
    if (!idle()) {
      return;
    }
    const id = ++sequence;
    const { source, options } = store.state;
    store.dispatch({ type: 'begin', id });
    const progress = (progress: Progress) => {
      if (!disposed) {
        store.dispatch({ type: 'progress', id, progress });
      }
    };
    try {
      const info = await compiler.initialize(progress);
      if (disposed || store.state.active?.id !== id) {
        return;
      }
      store.dispatch({ type: 'initialized', id, info, compile });
      if (compile) {
        const result = await compiler.compile(
          { id, source, options },
          progress
        );
        if (!disposed && store.state.active?.id === id) {
          store.dispatch({ type: 'finished', id, result });
          if (result.exitCode !== 0 && !stale(store.state)) {
            context.activatePane('diagnostics');
          }
        }
      }
    } catch (error) {
      if (!disposed) {
        store.dispatch({ type: 'failed', id, message: String(error) });
      }
    }
  }

  add(CommandIDs.initialize, {
    label: 'Load compiler',
    isEnabled: idle,
    execute: () => build(false)
  });
  add(CommandIDs.compile, {
    label: 'Compile',
    isEnabled: idle,
    execute: () => build(true)
  });
  add(CommandIDs.cancel, {
    label: 'Cancel',
    isEnabled: () => !idle(),
    execute: () => {
      if (!idle()) {
        store.dispatch({ type: 'cancelled' });
        compiler.cancel();
      }
    }
  });
  add(CommandIDs.setSource, {
    label: 'Edit source',
    execute: args => {
      if (typeof args.source !== 'string') {
        throw new Error('Source must be text.');
      }
      store.dispatch({ type: 'source', source: args.source });
    }
  });
  add(CommandIDs.setOptions, {
    label: 'Change compiler options',
    execute: args => {
      if (!isOptions(args.options)) {
        throw new Error('Invalid compiler options.');
      }
      store.dispatch({ type: 'options', options: args.options });
    }
  });
  add(CommandIDs.resetExample, {
    label: 'Reset example',
    execute: () => {
      store.dispatch({
        type: 'source',
        source: examples[store.state.options.language]
      });
    }
  });
  add(CommandIDs.resetLayout, {
    label: 'Reset layout',
    execute: () => context.resetLayout()
  });
  add(CommandIDs.compare, {
    label: 'Compare outputs',
    isToggled: () => hasComparison(store.state.layout),
    execute: () => {
      if (!hasComparison(store.state.layout)) {
        const mlir = store.state.options.language === 'mlir';
        store.dispatch({
          type: 'output',
          group: 'primary',
          output: mlir ? 'mlir' : 'ir'
        });
        store.dispatch({
          type: 'output',
          group: 'comparison',
          output: mlir ? 'graphs' : 'optimized'
        });
      }
      context.compare();
    }
  });
  add(CommandIDs.selectOutput, {
    label: 'Select output',
    execute: args => {
      if (
        (args.group !== 'primary' && args.group !== 'comparison') ||
        !isOutputKind(args.output)
      ) {
        throw new Error('Invalid output selection.');
      }
      store.dispatch({
        type: 'output',
        group: args.group,
        output: args.output
      });
    }
  });
  add(CommandIDs.saveLayout, {
    label: 'Save pane layout',
    execute: args => {
      const saved = session({ ...snapshot(store.state), layout: args.layout });
      if (!saved) {
        throw new Error('Invalid pane layout.');
      }
      store.dispatch({ type: 'layout', layout: saved.layout });
    }
  });
  add(CommandIDs.navigate, {
    label: 'Go to diagnostic',
    execute: args => {
      const { line, column } = args;
      if (
        typeof line !== 'number' ||
        typeof column !== 'number' ||
        !Number.isInteger(line) ||
        !Number.isInteger(column) ||
        line < 1 ||
        column < 1
      ) {
        throw new Error('Invalid source location.');
      }
      store.dispatch({ type: 'navigate', line, column });
    }
  });
  add(CommandIDs.runCommand, {
    label: 'Run command',
    isEnabled: idle,
    execute: async args => {
      if (!idle()) {
        return;
      }
      if (typeof args.command !== 'string') {
        throw new Error('Command must be text.');
      }
      try {
        command(args.command);
      } catch (error) {
        store.dispatch({ type: 'notice', message: String(error) });
        return;
      }
      const id = ++sequence;
      const path = `/workspace/${sourceName(store.state.options.language)}`;
      const files = [
        ...store.state.files.filter(file => file.path !== path),
        { path, data: new TextEncoder().encode(store.state.source) }
      ];
      store.dispatch({ type: 'begin', id });
      try {
        const result = await compiler.command(
          {
            id,
            command: args.command,
            files
          },
          progress => store.dispatch({ type: 'progress', id, progress })
        );
        store.dispatch({ type: 'command', id, result });
      } catch (error) {
        store.dispatch({ type: 'failed', id, message: String(error) });
      }
    }
  });
  add(CommandIDs.clearTerminal, {
    label: 'Clear command log',
    execute: () => {
      store.dispatch({ type: 'clear-terminal' });
    }
  });
  add(CommandIDs.selectModule, {
    label: 'Select Wasm module',
    execute: args => {
      if (
        typeof args.path !== 'string' ||
        !store.state.files.some(file => file.path === args.path)
      ) {
        throw new Error('The selected module is not in the workspace.');
      }
      runner.reset();
      store.dispatch({ type: 'module', path: args.path });
      context.activatePane('run');
    }
  });
  add(CommandIDs.selectExport, {
    label: 'Select export',
    execute: args => {
      if (typeof args.symbol !== 'string' || store.state.execution.active) {
        return;
      }
      store.dispatch({ type: 'symbol', symbol: args.symbol });
    }
  });
  add(CommandIDs.setArguments, {
    label: 'Change arguments',
    execute: args => {
      if (
        !Array.isArray(args.values) ||
        !args.values.every(
          (value): value is string => typeof value === 'string'
        )
      ) {
        throw new Error('Arguments must be text values.');
      }
      store.dispatch({ type: 'arguments', args: args.values });
    }
  });
  add(CommandIDs.setTimeout, {
    label: 'Change execution timeout',
    execute: args => {
      if (!isTimeout(args.timeout)) {
        throw new Error(
          'Execution timeout is outside the browser timer range.'
        );
      }
      store.dispatch({ type: 'timeout', timeout: args.timeout });
    }
  });
  add(CommandIDs.stop, {
    label: () =>
      store.state.execution.active ? 'Stop execution' : 'Reset execution',
    execute: () => {
      store.dispatch({ type: 'run-reset' });
      runner.reset();
    }
  });
  add(CommandIDs.run, {
    label: 'Run',
    isEnabled: () => !disposed && !startingRun && canRun(store.state),
    execute: async () => {
      if (disposed || startingRun || !canRun(store.state)) {
        return;
      }
      startingRun = true;
      let id: number | null = null;
      try {
        if (!currentModule(store.state)) {
          await build(true);
        }
        if (disposed) {
          return;
        }
        context.activatePane('run');
        const state = store.state;
        if (!currentModule(state)) {
          throw new Error(
            'No current Wasm module. Check source and compilation diagnostics.'
          );
        }
        const execution = state.execution;
        const fn = execution.info?.functions.find(
          fn => fn.name === execution.symbol
        );
        if (!execution.module || !fn || fn.signatureCode === null) {
          throw new Error(
            execution.notice || 'Select a supported export in the Run pane.'
          );
        }
        const values =
          fn.name === 'main' && fn.signatureCode === 2
            ? [0, 0]
            : execution.args.map(value => (value.trim() ? Number(value) : NaN));
        if (
          values.length !== fn.params.length ||
          values.some(
            value =>
              !Number.isFinite(value) ||
              (Number(fn.signatureCode) <= 2 &&
                (!Number.isInteger(value) ||
                  value < -2147483648 ||
                  value > 2147483647))
          )
        ) {
          throw new Error(
            'Enter valid arguments for the displayed Wasm signature.'
          );
        }
        id = ++sequence;
        const current = id;
        store.dispatch({ type: 'run-begin', id });
        const result = await runner.run(
          {
            id,
            module: execution.module,
            files: state.files,
            symbol: fn.name,
            signatureCode: fn.signatureCode,
            args: values
          },
          state.timeout,
          progress =>
            store.dispatch({ type: 'run-progress', id: current, progress })
        );
        store.dispatch({ type: 'run-finished', id, result });
      } catch (error) {
        if (id !== null) {
          store.dispatch({ type: 'run-failed', id, message: String(error) });
        } else if (!disposed) {
          store.dispatch({ type: 'notice', message: String(error) });
        }
      } finally {
        startingRun = false;
        commands.notifyCommandChanged(CommandIDs.run);
      }
    }
  });
  add(CommandIDs.share, {
    label: 'Copy share link',
    isVisible: () => !!context.sharing,
    isEnabled: () => !!context.sharing,
    execute: async () => {
      await context.sharing?.copy(snapshot(store.state));
      store.dispatch({ type: 'notice', message: 'Share link copied.' });
    }
  });
  for (const id of [CommandIDs.copy, CommandIDs.download]) {
    add(id, {
      label: id === CommandIDs.copy ? 'Copy output' : 'Download file',
      execute: async args => {
        const files = args.workspace
          ? store.state.files
          : store.state.result?.value.files;
        const file = files?.find(file => file.path === args.path);
        if (!file) {
          throw new Error('The file is no longer available.');
        }
        if (id === CommandIDs.copy) {
          const text = new TextDecoder().decode(file.data);
          await context.copy(
            args.hideMetadata === true && file.path.endsWith('.s')
              ? assemblyText(text)
              : text
          );
        } else {
          context.download(file);
        }
      }
    });
  }
  let files = store.state.files;
  const unsubscribe = store.subscribe(() => {
    if (files !== store.state.files) {
      files = store.state.files;
      runner.reset();
    }
    for (const id of [
      CommandIDs.compile,
      CommandIDs.cancel,
      CommandIDs.initialize,
      CommandIDs.compare,
      CommandIDs.run,
      CommandIDs.stop,
      CommandIDs.runCommand
    ]) {
      commands.notifyCommandChanged(id);
    }
  });
  return {
    get isDisposed() {
      return disposed;
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        unsubscribe();
        compiler.cancel();
        runner.reset();
        disposables.dispose();
      }
    }
  };
}
