import type { CommandRegistry } from '@lumino/commands';
import { DisposableSet } from '@lumino/disposable';
import type { IDisposable } from '@lumino/disposable';

import { assemblyText } from './compiler/assembly';
import type { IRunner } from './compiler/execution';
import { isTimeout } from './compiler/execution';
import { debugInvocation, serialize } from './compiler/request';
import { command } from './compiler/terminal';
import { isOptions, isOutputKind } from './compiler/types';
import type {
  File,
  ICompiler,
  OutputKind,
  Progress,
  Stage
} from './compiler/types';
import { examples } from './examples';
import type { IDebuggerClient } from './lldb/debugger';
import { canRun, currentModule, hasComparison, snapshot, stale } from './model';
import type { Pane } from './model';
import { session } from './persistence';
import type { ISharing } from './share';
import type { IStore } from './state';
import { replaceFile, workspacePath } from './workspace';

export namespace CommandIDs {
  export const open = 'wasmbolt:open';
  export const initialize = 'wasmbolt:initialize';
  export const setSource = 'wasmbolt:set-source';
  export const setOptions = 'wasmbolt:set-options';
  export const compile = 'wasmbolt:compile';
  export const compileAndRun = 'wasmbolt:compile-and-run';
  export const cancel = 'wasmbolt:cancel';
  export const resetLayout = 'wasmbolt:reset-layout';
  export const saveLayout = 'wasmbolt:save-layout';
  export const navigate = 'wasmbolt:navigate';
  export const selectOutput = 'wasmbolt:select-output';
  export const compare = 'wasmbolt:compare';
  export const resetExample = 'wasmbolt:reset-example';
  export const createFile = 'wasmbolt:create-file';
  export const importFile = 'wasmbolt:import-file';
  export const selectFile = 'wasmbolt:select-file';
  export const showDiagnostics = 'wasmbolt:show-diagnostics';
  export const showPipelines = 'wasmbolt:show-pipelines';
  export const showDebugger = 'wasmbolt:show-debugger';
  export const toggleBreakpoint = 'wasmbolt:toggle-breakpoint';
  export const startDebugging = 'wasmbolt:start-debugging';
  export const continueDebugging = 'wasmbolt:continue-debugging';
  export const pauseDebugging = 'wasmbolt:pause-debugging';
  export const stepOver = 'wasmbolt:step-over';
  export const stepIn = 'wasmbolt:step-in';
  export const stepOut = 'wasmbolt:step-out';
  export const restartDebugging = 'wasmbolt:restart-debugging';
  export const stopDebugging = 'wasmbolt:stop-debugging';
  export const selectDebugFrame = 'wasmbolt:select-debug-frame';
  export const debugCommand = 'wasmbolt:debug-command';
  export const runCommand = 'wasmbolt:run-command';
  export const clearTerminal = 'wasmbolt:clear-terminal';
  export const run = 'wasmbolt:run';
  export const stop = 'wasmbolt:stop';
  export const selectModule = 'wasmbolt:select-module';
  export const selectExport = 'wasmbolt:select-export';
  export const setArguments = 'wasmbolt:set-arguments';
  export const setTimeout = 'wasmbolt:set-timeout';
  export const share = 'wasmbolt:share';
  export const copy = 'wasmbolt:copy';
  export const download = 'wasmbolt:download';
}

/** Explicit services and host actions used by the shared commands. */
export interface ICommandContext {
  readonly store: IStore;
  readonly compiler: ICompiler;
  readonly runner: IRunner;
  readonly debugger?: IDebuggerClient;
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
  const { store, compiler, runner, debugger: debuggerClient } = context;
  const disposables = new DisposableSet();
  let sequence = 0;
  let disposed = false;
  let startingRun = false;
  const idle = () => !disposed && store.state.active === null;
  const add = (id: string, options: CommandRegistry.ICommandOptions) =>
    disposables.add(commands.addCommand(id, options));
  const debugActive = () =>
    ['starting', 'running', 'stopped'].includes(store.state.debugger.status);

  const runDebugCommand = async (text: string): Promise<void> => {
    const value = text.trim();
    store.dispatch({ type: 'debug-console', channel: 'input', text: value });
    if (!value) {
      const message = 'Usage: lldb <command>.';
      store.dispatch({
        type: 'debug-console',
        channel: 'stderr',
        text: message
      });
      store.dispatch({ type: 'debug-error', message });
      return;
    }
    if (!debuggerClient || !debugActive()) {
      const message = debuggerClient
        ? 'Start debugging before running LLDB commands.'
        : 'The LLDB-DAP debugger is not available in this build.';
      store.dispatch({
        type: 'debug-console',
        channel: 'stderr',
        text: message
      });
      store.dispatch({ type: 'debug-error', message });
      return;
    }
    try {
      await debuggerClient.command(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.dispatch({
        type: 'debug-console',
        channel: 'stderr',
        text: message
      });
      store.dispatch({ type: 'debug-error', message });
    }
  };

  const unsubscribeDebugger = debuggerClient?.subscribe(event => {
    switch (event.type) {
      case 'status':
        store.dispatch({
          type: 'debug-status',
          status: event.status,
          message: event.message
        });
        break;
      case 'breakpoints':
        store.dispatch({
          type: 'debug-breakpoints',
          path: event.path,
          breakpoints: event.breakpoints
        });
        break;
      case 'stopped': {
        store.dispatch({
          type: 'debug-stopped',
          frames: event.frames,
          frameId: event.frameId,
          variables: event.variables,
          reason: event.reason
        });
        const frame = event.frames.find(frame => frame.id === event.frameId);
        if (frame?.path && frame.line) {
          if (store.state.files.some(file => file.path === frame.path)) {
            store.dispatch({ type: 'file-select', path: frame.path });
          }
          store.dispatch({ type: 'navigate', line: frame.line, column: 1 });
        }
        break;
      }
      case 'running':
        store.dispatch({ type: 'debug-running' });
        break;
      case 'exited':
        store.dispatch({ type: 'debug-exited', exitCode: event.exitCode });
        break;
      case 'frame':
        store.dispatch({
          type: 'debug-frame',
          frameId: event.frameId,
          variables: event.variables
        });
        break;
      case 'console':
        store.dispatch({
          type: 'debug-console',
          channel: event.channel,
          text: event.text
        });
        break;
      case 'error':
        store.dispatch({ type: 'debug-error', message: event.message });
        break;
    }
  });

  async function build(compile: boolean, output?: OutputKind): Promise<void> {
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
          {
            id,
            source,
            sourcePath: store.state.activeFile,
            files: store.state.files,
            options,
            output: output ?? store.state.outputs.primary
          },
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
  add(CommandIDs.compileAndRun, {
    label: 'Compile and Run',
    isEnabled: () => commands.isEnabled(CommandIDs.run),
    execute: () => commands.execute(CommandIDs.run)
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
  add(CommandIDs.createFile, {
    label: 'New file',
    execute: args => {
      if (typeof args.name !== 'string') {
        throw new Error('A file name is required.');
      }
      store.dispatch({ type: 'file-create', path: workspacePath(args.name) });
    }
  });
  add(CommandIDs.importFile, {
    label: 'Import file',
    execute: args => {
      if (typeof args.name !== 'string' || !(args.data instanceof Uint8Array)) {
        throw new Error('The imported file is invalid.');
      }
      store.dispatch({
        type: 'file-import',
        path: workspacePath(args.name),
        data: args.data
      });
      if (args.name.toLowerCase().endsWith('.wasm')) {
        context.activatePane('run');
      }
    }
  });
  add(CommandIDs.selectFile, {
    label: 'Open file',
    execute: args => {
      if (
        typeof args.path !== 'string' ||
        !store.state.files.some(file => file.path === args.path)
      ) {
        throw new Error('The selected file is not in the workspace.');
      }
      store.dispatch({ type: 'file-select', path: args.path });
      if (args.path.endsWith('.wasm')) {
        runner.reset();
        store.dispatch({ type: 'module', path: args.path });
      }
    }
  });
  add(CommandIDs.showDebugger, {
    label: 'Open debugger',
    isVisible: () => !!debuggerClient,
    isEnabled: () => !!debuggerClient,
    execute: () => context.activatePane('debugger')
  });
  add(CommandIDs.showDiagnostics, {
    label: 'Open diagnostics',
    execute: () => context.activatePane('diagnostics')
  });
  add(CommandIDs.showPipelines, {
    label: 'Open pipelines',
    execute: () => context.activatePane('pipelines')
  });
  add(CommandIDs.toggleBreakpoint, {
    label: 'Toggle breakpoint',
    execute: async args => {
      if (
        typeof args.path !== 'string' ||
        typeof args.line !== 'number' ||
        !Number.isInteger(args.line) ||
        args.line < 1
      ) {
        throw new Error('The breakpoint location is invalid.');
      }
      store.dispatch({
        type: 'debug-toggle-breakpoint',
        path: args.path,
        line: args.line
      });
      if (debuggerClient && debugActive()) {
        const lines = store.state.debugger.breakpoints
          .filter(breakpoint => breakpoint.path === args.path)
          .map(breakpoint => breakpoint.line);
        try {
          await debuggerClient.setBreakpoints(args.path, lines);
        } catch (error) {
          store.dispatch({ type: 'debug-error', message: String(error) });
        }
      }
    }
  });
  add(CommandIDs.startDebugging, {
    label: 'Start debugging',
    isVisible: () => !!debuggerClient,
    isEnabled: () => !!debuggerClient && idle() && !debugActive(),
    execute: async () => {
      if (!debuggerClient) {
        store.dispatch({
          type: 'debug-error',
          message: 'The LLDB-DAP debugger is not available in this build.'
        });
        return;
      }
      context.activatePane('debugger');
      let buildId: number | null = null;
      try {
        const selected = store.state.selectedFile.endsWith('.wasm')
          ? store.state.selectedFile
          : null;
        let module = selected;
        let files = store.state.files;
        if (selected) {
          store.dispatch({ type: 'module', path: selected });
        } else {
          if (!currentModule(store.state)) {
            await build(true, 'wasm');
          }
          if (!currentModule(store.state)) {
            throw new Error(
              'Build a runnable Wasm module before starting the debugger.'
            );
          }
          const execution = store.state.execution;
          const fn = execution.info?.functions.find(
            fn => fn.name === execution.symbol && fn.callable
          );
          if (!fn) {
            throw new Error(
              execution.notice ||
                'Choose the function and arguments in Execute first.'
            );
          }
          buildId = ++sequence;
          const id = buildId;
          store.dispatch({ type: 'begin', id });
          const progress = (progress: Progress) => {
            if (!disposed) {
              store.dispatch({ type: 'progress', id, progress });
            }
          };
          const info = await compiler.initialize(progress);
          store.dispatch({ type: 'initialized', id, info, compile: true });
          const state = store.state;
          const values = execution.args.map(value => {
            return value.trim() ? Number(value) : NaN;
          });
          if (
            fn.name !== 'main' &&
            (values.length !== fn.params.length ||
              values.some(
                (value, index) =>
                  !Number.isFinite(value) ||
                  (fn.params[index] === 'i32' &&
                    (!Number.isInteger(value) ||
                      value < -2147483648 ||
                      value > 2147483647))
              ))
          ) {
            throw new Error(
              'Enter valid arguments for the displayed Wasm signature.'
            );
          }
          const hasMain = execution.info?.functions.some(
            candidate => candidate.name === 'main'
          );
          const plan = debugInvocation(
            {
              id,
              source: state.source,
              sourcePath: state.activeFile,
              files: state.files,
              options: state.options
            },
            info,
            '/workspace',
            hasMain || fn.name === 'main'
              ? null
              : {
                  symbol: fn.name,
                  signature: {
                    params: fn.params as ('i32' | 'f32' | 'f64')[],
                    results: fn.results as ('i32' | 'f32' | 'f64')[]
                  },
                  args: values
                }
          );
          const stages: Stage[] = [];
          files = plan.wrapper
            ? replaceFile(state.files, {
                path: plan.wrapper.path,
                data: new TextEncoder().encode(plan.wrapper.source)
              })
            : state.files;
          for (const args of plan.commands) {
            const result = await compiler.command(
              { id, command: serialize(args), files },
              progress
            );
            files = result.files;
            stages.push(result.stage);
            if (result.stage.exitCode !== 0) {
              break;
            }
          }
          files = files.filter(file => !plan.generated.includes(file.path));
          const failed = stages.find(stage => stage.exitCode !== 0);
          const stage: Stage = {
            name: 'debug',
            status: failed ? 'failed' : 'success',
            commands: stages.flatMap(stage => stage.commands),
            diagnostics: stages.flatMap(stage => stage.diagnostics),
            stdout: stages
              .map(stage => stage.stdout)
              .filter(Boolean)
              .join('\n'),
            stderr: stages
              .map(stage => stage.stderr)
              .filter(Boolean)
              .join('\n'),
            exitCode: failed?.exitCode ?? 0,
            duration: stages.reduce((total, stage) => {
              return total + stage.duration;
            }, 0)
          };
          store.dispatch({
            type: 'command',
            id,
            result: { id, files, stage }
          });
          buildId = null;
          if (failed) {
            throw new Error(
              failed.stderr || 'The standalone debug build failed.'
            );
          }
          module = plan.module;
        }
        const execution = store.state.execution;
        if (!module || !files.some(file => file.path === module)) {
          throw new Error('Select or build a WebAssembly module first.');
        }
        const entry = selected ? execution.symbol : '';
        const argv = selected && entry !== 'main' ? execution.args : [];
        store.dispatch({ type: 'debug-status', status: 'starting', module });
        await debuggerClient.start({
          module,
          entry,
          files,
          sourcePaths: store.state.editableFiles,
          breakpoints: store.state.debugger.breakpoints,
          argv
        });
      } catch (error) {
        if (buildId !== null && store.state.active?.id === buildId) {
          store.dispatch({
            type: 'failed',
            id: buildId,
            message: String(error)
          });
        }
        store.dispatch({ type: 'debug-error', message: String(error) });
      }
    }
  });
  const controls: readonly Readonly<{
    id: string;
    label: string;
    enabled(): boolean;
    run(): Promise<void>;
  }>[] = [
    {
      id: CommandIDs.continueDebugging,
      label: 'Continue',
      enabled: () => store.state.debugger.status === 'stopped',
      run: () => debuggerClient?.continue() ?? Promise.resolve()
    },
    {
      id: CommandIDs.pauseDebugging,
      label: 'Pause',
      enabled: () => store.state.debugger.status === 'running',
      run: () => debuggerClient?.pause() ?? Promise.resolve()
    },
    {
      id: CommandIDs.stepOver,
      label: 'Step over',
      enabled: () => store.state.debugger.status === 'stopped',
      run: () => debuggerClient?.stepOver() ?? Promise.resolve()
    },
    {
      id: CommandIDs.stepIn,
      label: 'Step into',
      enabled: () => store.state.debugger.status === 'stopped',
      run: () => debuggerClient?.stepIn() ?? Promise.resolve()
    },
    {
      id: CommandIDs.stepOut,
      label: 'Step out',
      enabled: () => store.state.debugger.status === 'stopped',
      run: () => debuggerClient?.stepOut() ?? Promise.resolve()
    },
    {
      id: CommandIDs.restartDebugging,
      label: 'Restart',
      enabled: debugActive,
      run: () => debuggerClient?.restart() ?? Promise.resolve()
    }
  ];
  for (const control of controls) {
    add(control.id, {
      label: control.label,
      isEnabled: () => !!debuggerClient && control.enabled(),
      execute: async () => {
        try {
          await control.run();
        } catch (error) {
          store.dispatch({ type: 'debug-error', message: String(error) });
        }
      }
    });
  }
  add(CommandIDs.stopDebugging, {
    label: 'Stop debugging',
    isEnabled: () => !!debuggerClient && debugActive(),
    execute: async () => {
      try {
        await debuggerClient?.stop();
        store.dispatch({ type: 'debug-reset' });
      } catch (error) {
        store.dispatch({ type: 'debug-error', message: String(error) });
      }
    }
  });
  add(CommandIDs.selectDebugFrame, {
    label: 'Select stack frame',
    execute: async args => {
      if (typeof args.frameId !== 'number' || !Number.isInteger(args.frameId)) {
        throw new Error('The stack frame is invalid.');
      }
      try {
        await debuggerClient?.selectFrame(args.frameId);
      } catch (error) {
        store.dispatch({ type: 'debug-error', message: String(error) });
      }
    }
  });
  add(CommandIDs.debugCommand, {
    label: 'Run LLDB command',
    execute: async args => {
      if (typeof args.command !== 'string' || !args.command.trim()) {
        throw new Error('An LLDB command is required.');
      }
      await runDebugCommand(args.command);
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
          output: 'graphs'
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
      if (args.command.trim() === 'clear') {
        store.dispatch({ type: 'clear-terminal' });
        return;
      }
      const debugCommand = terminalDebugCommand(args.command);
      if (debugCommand !== null) {
        await runDebugCommand(debugCommand);
        return;
      }
      try {
        command(args.command);
      } catch (error) {
        store.dispatch({ type: 'notice', message: String(error) });
        return;
      }
      const id = ++sequence;
      store.dispatch({ type: 'begin', id });
      try {
        const result = await compiler.command(
          {
            id,
            command: args.command,
            files: store.state.files
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
          await build(true, 'wasm');
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
        if (!execution.module || !fn || !fn.callable) {
          throw new Error(execution.notice || 'Choose an export in Execute.');
        }
        const values =
          fn.name === 'main' &&
          fn.params.length === 2 &&
          fn.params.every(type => type === 'i32')
            ? [0, 0]
            : execution.args.map(value => (value.trim() ? Number(value) : NaN));
        if (
          values.length !== fn.params.length ||
          values.some(
            (value, index) =>
              !Number.isFinite(value) ||
              (fn.params[index] === 'i32' &&
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
            signature: {
              params: fn.params as ('i32' | 'f32' | 'f64')[],
              results: fn.results as ('i32' | 'f32' | 'f64')[]
            },
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
      CommandIDs.compileAndRun,
      CommandIDs.cancel,
      CommandIDs.initialize,
      CommandIDs.compare,
      CommandIDs.run,
      CommandIDs.stop,
      CommandIDs.runCommand,
      CommandIDs.startDebugging,
      CommandIDs.stopDebugging,
      ...controls.map(control => control.id)
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
        unsubscribeDebugger?.();
        unsubscribe();
        compiler.cancel();
        runner.reset();
        disposables.dispose();
      }
    }
  };
}

/** Strip the explicit terminal route while preserving ordinary tool names. */
function terminalDebugCommand(text: string): string | null {
  const value = text.trim();
  return /^lldb(?:\s|$)/.test(value) ? value.slice('lldb'.length).trim() : null;
}
