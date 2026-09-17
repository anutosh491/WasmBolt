import type { RunResult } from './compiler/execution';
import type {
  Artifact,
  CommandResult,
  File,
  Info,
  Options,
  OutputKind,
  Progress,
  Result,
  Stage
} from './compiler/types';
import { availableOutputs, pipelines } from './compiler/types';
import { inspectWasm } from './compiler/wasm';
import type { WasmInfo } from './compiler/wasm';
import { examples } from './examples';
import {
  exampleFiles,
  languageForPath,
  replaceFile,
  sourcePath,
  text
} from './workspace';

export type Pane =
  | 'explorer'
  | 'source'
  | 'outputs'
  | 'comparison'
  | 'diagnostics'
  | 'terminal'
  | 'run'
  | 'debugger'
  | 'pipelines';
export type OutputGroup = 'primary' | 'comparison';

export type Area =
  | Readonly<{
      type: 'tab-area';
      widgets: readonly Pane[];
      currentIndex: number;
    }>
  | Readonly<{
      type: 'split-area';
      orientation: 'horizontal' | 'vertical';
      children: readonly Area[];
      sizes: readonly number[];
    }>;

export type Session = Readonly<{
  version: 2;
  source: string;
  documents?: readonly Readonly<{ path: string; source: string }>[];
  activeFile?: string;
  options: Options;
  layout: Area | null;
  outputs: Readonly<Record<OutputGroup, OutputKind>>;
  timeout: number;
}>;

export type Execution = Readonly<{
  module: string | null;
  info: WasmInfo | null;
  symbol: string;
  args: readonly string[];
  status: 'idle' | 'loading' | 'running' | 'complete' | 'failed' | 'stopped';
  active: Readonly<{ id: number; revision: number }> | null;
  result: RunResult | null;
  progress: Progress | null;
  notice: string | null;
}>;

export type DebugBreakpointState = Readonly<{
  path: string;
  line: number;
  verified: boolean | null;
  message?: string;
}>;

export type DebugFrameState = Readonly<{
  id: number;
  name: string;
  path: string | null;
  line: number | null;
  column: number | null;
}>;

export type DebugVariableState = Readonly<{
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
}>;

export type DebugState = Readonly<{
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'exited' | 'error';
  module: string | null;
  breakpoints: readonly DebugBreakpointState[];
  frames: readonly DebugFrameState[];
  frameId: number | null;
  variables: readonly DebugVariableState[];
  console: readonly Readonly<{
    channel: 'input' | 'stdout' | 'stderr' | 'console';
    text: string;
  }>[];
  message: string | null;
  exitCode: number | null;
}>;

export type State = Readonly<{
  source: string;
  activeFile: string;
  selectedFile: string;
  editableFiles: readonly string[];
  options: Options;
  layout: Area | null;
  outputs: Session['outputs'];
  timeout: number;
  revision: number;
  status: 'idle' | 'loading' | 'ready' | 'compiling' | 'cancelled' | 'failed';
  info: Info | null;
  progress: Progress | null;
  active: Readonly<{ id: number; revision: number }> | null;
  result: Readonly<{ revision: number; value: Result }> | null;
  files: readonly File[];
  filesRevision: number | null;
  moduleRevisions: Readonly<Record<string, number>>;
  terminal: readonly Stage[];
  execution: Execution;
  debugger: DebugState;
  notice: string | null;
  position: Readonly<{ line: number; column: number; serial: number }> | null;
}>;

export type Action =
  | Readonly<{ type: 'source'; source: string }>
  | Readonly<{ type: 'file-create'; path: string }>
  | Readonly<{ type: 'file-import'; path: string; data: Uint8Array }>
  | Readonly<{ type: 'file-select'; path: string }>
  | Readonly<{ type: 'options'; options: Options }>
  | Readonly<{ type: 'layout'; layout: Area | null }>
  | Readonly<{ type: 'output'; group: OutputGroup; output: OutputKind }>
  | Readonly<{ type: 'begin'; id: number }>
  | Readonly<{ type: 'progress'; id: number; progress: Progress }>
  | Readonly<{ type: 'initialized'; id: number; info: Info; compile: boolean }>
  | Readonly<{ type: 'finished'; id: number; result: Result }>
  | Readonly<{ type: 'command'; id: number; result: CommandResult }>
  | Readonly<{ type: 'clear-terminal' }>
  | Readonly<{ type: 'failed'; id: number; message: string }>
  | Readonly<{ type: 'cancelled' }>
  | Readonly<{ type: 'notice'; message: string }>
  | Readonly<{ type: 'module'; path: string }>
  | Readonly<{ type: 'symbol'; symbol: string }>
  | Readonly<{ type: 'arguments'; args: readonly string[] }>
  | Readonly<{ type: 'timeout'; timeout: number }>
  | Readonly<{ type: 'run-begin'; id: number }>
  | Readonly<{ type: 'run-progress'; id: number; progress: Progress }>
  | Readonly<{ type: 'run-finished'; id: number; result: RunResult }>
  | Readonly<{ type: 'run-failed'; id: number; message: string }>
  | Readonly<{ type: 'run-reset' }>
  | Readonly<{ type: 'debug-toggle-breakpoint'; path: string; line: number }>
  | Readonly<{
      type: 'debug-status';
      status: DebugState['status'];
      message?: string;
      module?: string;
    }>
  | Readonly<{
      type: 'debug-breakpoints';
      path: string;
      breakpoints: readonly DebugBreakpointState[];
    }>
  | Readonly<{
      type: 'debug-stopped';
      frames: readonly DebugFrameState[];
      frameId: number | null;
      variables: readonly DebugVariableState[];
      reason: string;
    }>
  | Readonly<{ type: 'debug-running' }>
  | Readonly<{
      type: 'debug-frame';
      frameId: number;
      variables: readonly DebugVariableState[];
    }>
  | Readonly<{ type: 'debug-exited'; exitCode: number }>
  | Readonly<{
      type: 'debug-console';
      channel: 'input' | 'stdout' | 'stderr' | 'console';
      text: string;
    }>
  | Readonly<{ type: 'debug-error'; message: string }>
  | Readonly<{ type: 'debug-reset' }>
  | Readonly<{ type: 'navigate'; line: number; column: number }>;

export const options: Options = {
  language: 'cpp',
  target: 'wasm32-unknown-emscripten',
  optimization: 2,
  ...pipelines
};

/** Create an independent application state from a validated session. */
export function initial(session: Session | null = null): State {
  const saved = session?.documents?.map(document => ({
    path: document.path,
    data: new TextEncoder().encode(document.source)
  }));
  const language = session?.options.language ?? 'cpp';
  let files = saved?.length
    ? saved
    : session
      ? replaceFile(exampleFiles, {
          path: sourcePath(language),
          data: new TextEncoder().encode(session.source)
        })
      : exampleFiles;
  const preferred = session?.activeFile ?? sourcePath(language);
  if (session) {
    files = replaceFile(files, {
      path: preferred,
      data: new TextEncoder().encode(session.source)
    });
  }
  const active =
    files.find(file => file.path === preferred && languageForPath(file.path)) ??
    files.find(file => languageForPath(file.path)) ??
    exampleFiles[0];
  return {
    source: text(active) ?? session?.source ?? examples.cpp,
    activeFile: active.path,
    selectedFile: active.path,
    editableFiles: files
      .filter(file => languageForPath(file.path) && text(file) !== null)
      .map(file => file.path),
    options: {
      ...(session?.options ?? options),
      language:
        languageForPath(active.path) ?? session?.options.language ?? 'cpp'
    },
    layout: session?.layout ?? null,
    outputs: outputSelection(session?.options ?? options, session?.outputs),
    timeout: session?.timeout ?? 10000,
    revision: 0,
    status: 'idle',
    info: null,
    progress: null,
    active: null,
    result: null,
    files,
    filesRevision: null,
    moduleRevisions: {},
    terminal: [],
    execution: {
      module: null,
      info: null,
      symbol: '',
      args: [],
      status: 'idle',
      active: null,
      result: null,
      notice: null,
      progress: null
    },
    debugger: {
      status: 'idle',
      module: null,
      breakpoints: [],
      frames: [],
      frameId: null,
      variables: [],
      console: [],
      message: null,
      exitCode: null
    },
    notice: null,
    position: null
  };
}

/** State transitions are pure; obsolete operations cannot replace results. */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'source':
      return action.source === state.source
        ? state
        : {
            ...state,
            source: action.source,
            files: replaceFile(state.files, {
              path: state.activeFile,
              data: new TextEncoder().encode(action.source)
            }),
            revision: state.revision + 1
          };
    case 'file-create': {
      const language = languageForPath(action.path);
      const file = { path: action.path, data: new Uint8Array() };
      const next = {
        ...state,
        files: replaceFile(state.files, file),
        editableFiles: language
          ? [...new Set([...state.editableFiles, action.path])]
          : state.editableFiles,
        selectedFile: action.path,
        revision: state.revision + 1
      };
      return language ? activateSource(next, file, language) : next;
    }
    case 'file-import': {
      const file = { path: action.path, data: action.data };
      const language = languageForPath(action.path);
      const editable = language !== null && text(file) !== null;
      let next: State = {
        ...state,
        files: replaceFile(state.files, file),
        editableFiles: editable
          ? [...new Set([...state.editableFiles, action.path])]
          : state.editableFiles.filter(path => path !== action.path),
        selectedFile: action.path,
        revision: state.revision + 1
      };
      if (editable && language) {
        return activateSource(next, file, language);
      }
      if (action.path.endsWith('.wasm')) {
        next = {
          ...next,
          moduleRevisions: {
            ...next.moduleRevisions,
            [action.path]: next.revision
          }
        };
        return selectModule(next, action.path);
      }
      return next;
    }
    case 'file-select': {
      const file = state.files.find(file => file.path === action.path);
      if (!file) {
        return state;
      }
      const language = languageForPath(file.path);
      if (!language || !state.editableFiles.includes(file.path)) {
        return { ...state, selectedFile: file.path };
      }
      return activateSource(
        {
          ...state,
          selectedFile: file.path,
          revision:
            file.path === state.activeFile ? state.revision : state.revision + 1
        },
        file,
        language
      );
    }
    case 'options':
      if (equalOptions(action.options, state.options)) {
        return state;
      }
      if (action.options.language !== state.options.language) {
        const path = sourcePath(action.options.language);
        const file = state.files.find(file => file.path === path) ?? {
          path,
          data: new TextEncoder().encode(examples[action.options.language])
        };
        return activateSource(
          {
            ...state,
            files: replaceFile(state.files, file),
            editableFiles: [...new Set([...state.editableFiles, path])],
            options: action.options,
            outputs: outputSelection(action.options, state.outputs),
            revision: state.revision + 1
          },
          file,
          action.options.language
        );
      }
      return {
        ...state,
        options: action.options,
        outputs: outputSelection(action.options, state.outputs),
        revision: state.revision + 1
      };
    case 'layout':
      return { ...state, layout: action.layout };
    case 'output':
      if (!availableOutputs(state.options).includes(action.output)) {
        return state;
      }
      return {
        ...state,
        outputs: { ...state.outputs, [action.group]: action.output }
      };
    case 'begin':
      return {
        ...state,
        active: { id: action.id, revision: state.revision },
        status: 'loading',
        progress: null,
        notice: null
      };
    case 'progress':
      return state.active?.id === action.id
        ? {
            ...state,
            progress: action.progress,
            status:
              action.progress.phase === 'working' ? 'compiling' : state.status
          }
        : state;
    case 'initialized':
      return state.active?.id === action.id
        ? {
            ...state,
            info: action.info,
            status: action.compile ? 'compiling' : 'ready',
            progress: null,
            active: action.compile ? state.active : null
          }
        : state;
    case 'finished':
      return state.active?.id === action.id
        ? withFiles(
            {
              ...state,
              status: 'ready',
              progress: null,
              active: null,
              terminal: action.result.stages,
              result: { revision: state.active.revision, value: action.result },
              filesRevision: state.active.revision
            },
            action.result.files,
            action.result.artifacts
          )
        : state;
    case 'command':
      return state.active?.id === action.id
        ? withFiles(
            {
              ...state,
              status: 'ready',
              progress: null,
              active: null,
              filesRevision: state.active.revision,
              terminal: [...state.terminal, action.result.stage]
            },
            action.result.files
          )
        : state;
    case 'clear-terminal':
      return { ...state, terminal: [] };
    case 'failed':
      return state.active?.id === action.id
        ? {
            ...state,
            status: 'failed',
            progress: null,
            active: null,
            notice: action.message
          }
        : state;
    case 'cancelled':
      return { ...state, active: null, status: 'cancelled', progress: null };
    case 'notice':
      return { ...state, notice: action.message };
    case 'module':
      return selectModule(state, action.path);
    case 'symbol': {
      const fn = state.execution.info?.functions.find(
        fn => fn.name === action.symbol
      );
      return {
        ...state,
        execution: {
          ...state.execution,
          symbol: fn?.name ?? '',
          args: fn?.params.map(() => '0') ?? [],
          result: null,
          notice: null
        }
      };
    }
    case 'arguments':
      return { ...state, execution: { ...state.execution, args: action.args } };
    case 'timeout':
      return { ...state, timeout: action.timeout };
    case 'run-begin':
      return {
        ...state,
        execution: {
          ...state.execution,
          active: { id: action.id, revision: state.revision },
          status: 'loading',
          progress: null,
          result: null,
          notice: null
        }
      };
    case 'run-progress':
      return state.execution.active?.id === action.id
        ? {
            ...state,
            execution: {
              ...state.execution,
              progress: action.progress,
              status:
                action.progress.phase === 'working' ? 'running' : 'loading'
            }
          }
        : state;
    case 'run-finished':
      return state.execution.active?.id === action.id
        ? {
            ...state,
            execution: {
              ...state.execution,
              active: null,
              progress: null,
              status:
                action.result.status === 'success' ? 'complete' : 'failed',
              result: action.result
            }
          }
        : state;
    case 'run-failed':
      return state.execution.active?.id === action.id
        ? {
            ...state,
            execution: {
              ...state.execution,
              active: null,
              progress: null,
              status: 'failed',
              notice: action.message
            }
          }
        : state;
    case 'run-reset':
      return {
        ...state,
        execution: {
          ...state.execution,
          active: null,
          result: null,
          progress: null,
          notice: null,
          status: 'stopped'
        }
      };
    case 'debug-toggle-breakpoint': {
      const exists = state.debugger.breakpoints.some(
        breakpoint =>
          breakpoint.path === action.path && breakpoint.line === action.line
      );
      return {
        ...state,
        debugger: {
          ...state.debugger,
          breakpoints: exists
            ? state.debugger.breakpoints.filter(
                breakpoint =>
                  breakpoint.path !== action.path ||
                  breakpoint.line !== action.line
              )
            : [
                ...state.debugger.breakpoints,
                {
                  path: action.path,
                  line: action.line,
                  verified: null
                }
              ]
        }
      };
    }
    case 'debug-status':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          status: action.status,
          module: action.module ?? state.debugger.module,
          message: action.message ?? null,
          ...(action.status === 'starting'
            ? {
                frames: [],
                frameId: null,
                variables: [],
                console: [],
                exitCode: null
              }
            : {})
        }
      };
    case 'debug-breakpoints':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          breakpoints: [
            ...state.debugger.breakpoints.filter(
              breakpoint => breakpoint.path !== action.path
            ),
            ...action.breakpoints
          ]
        }
      };
    case 'debug-stopped':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          status: 'stopped',
          frames: action.frames,
          frameId: action.frameId,
          variables: action.variables,
          message: action.reason
        }
      };
    case 'debug-running':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          status: 'running',
          frames: [],
          frameId: null,
          variables: [],
          message: null
        }
      };
    case 'debug-frame':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          frameId: action.frameId,
          variables: action.variables
        }
      };
    case 'debug-exited':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          status: 'exited',
          frames: [],
          frameId: null,
          variables: [],
          exitCode: action.exitCode,
          message: `Process exited with code ${action.exitCode}.`
        }
      };
    case 'debug-console':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          console: [
            ...state.debugger.console,
            { channel: action.channel, text: action.text }
          ]
        }
      };
    case 'debug-error':
      return {
        ...state,
        debugger: {
          ...state.debugger,
          status: 'error',
          message: action.message
        }
      };
    case 'debug-reset':
      return {
        ...state,
        debugger: {
          ...initial().debugger,
          breakpoints: state.debugger.breakpoints
        }
      };
    case 'navigate':
      return {
        ...state,
        position: {
          line: action.line,
          column: action.column,
          serial: (state.position?.serial ?? 0) + 1
        }
      };
  }
}

function withFiles(
  state: State,
  files: readonly File[],
  artifacts: readonly Artifact[] = []
): State {
  const path =
    files.find(file => file.path === state.execution.module)?.path ??
    files.find(file => file.path.endsWith('/program.wasm'))?.path ??
    null;
  const moduleRevisions = Object.fromEntries(
    files
      .filter(file => file.path.endsWith('.wasm'))
      .map(file => {
        const previous = state.files.find(entry => entry.path === file.path);
        const generated = artifacts.some(
          artifact => artifact.kind === 'wasm' && artifact.path === file.path
        );
        const unchanged =
          previous?.data.length === file.data.length &&
          previous.data.every((byte, index) => byte === file.data[index]);
        const revision =
          generated || !unchanged
            ? (state.filesRevision ?? state.revision)
            : state.moduleRevisions[file.path];
        return [file.path, revision];
      })
  );
  const selectedFile = files.some(file => file.path === state.selectedFile)
    ? state.selectedFile
    : state.activeFile;
  return selectModule({ ...state, files, moduleRevisions, selectedFile }, path);
}

/** Editing or inspecting other files cannot make an old module current. */
export function currentModule(state: State): boolean {
  const path = state.execution.module;
  return path !== null && state.moduleRevisions[path] === state.revision;
}

/** Run can reuse a current module or build one from executable inputs. */
export function canRun(state: State): boolean {
  return (
    state.active === null &&
    state.execution.active === null &&
    (currentModule(state) ||
      (state.options.language !== 'mlir' &&
        state.options.target === 'wasm32-unknown-emscripten'))
  );
}

/** Comparison is part of the saved layout, including restored tab groups. */
export function hasComparison(area: Area | null): boolean {
  if (area === null) {
    return false;
  }
  return area.type === 'tab-area'
    ? area.widgets.includes('comparison')
    : area.children.some(hasComparison);
}

function selectModule(state: State, path: string | null): State {
  const previous = state.execution;
  const execution: Execution = {
    ...previous,
    module: path,
    info: null,
    symbol: '',
    args: [],
    active: null,
    result: null,
    progress: null,
    status: 'idle',
    notice: null
  };
  const file = state.files.find(file => file.path === path);
  if (!file) {
    return { ...state, execution };
  }
  try {
    const info = inspectWasm(file.data);
    const supported = info.functions.filter(fn => fn.signatureCode !== null);
    const old = previous.info?.functions.find(
      fn => fn.name === previous.symbol
    );
    const fn =
      supported.find(
        fn => fn.name === previous.symbol && fn.signature === old?.signature
      ) ??
      supported.find(fn => fn.name === 'main') ??
      (supported.length === 1 ? supported[0] : undefined);
    return {
      ...state,
      execution: {
        ...execution,
        info,
        symbol: fn?.name ?? '',
        args: fn
          ? fn.signature === old?.signature
            ? previous.args
            : fn.params.map(() => '0')
          : []
      }
    };
  } catch (error) {
    return { ...state, execution: { ...execution, notice: String(error) } };
  }
}

export function stale(state: State): boolean {
  return state.result !== null && state.result.revision !== state.revision;
}

export function snapshot(state: State): Session {
  return {
    version: 2,
    source: state.source,
    documents: state.files.flatMap(file => {
      if (!state.editableFiles.includes(file.path)) {
        return [];
      }
      const source = text(file);
      return source === null ? [] : [{ path: file.path, source }];
    }),
    activeFile: state.activeFile,
    options: state.options,
    layout: state.layout,
    outputs: state.outputs,
    timeout: state.timeout
  };
}

function outputSelection(
  options: Options,
  outputs?: Session['outputs']
): Session['outputs'] {
  const kinds = availableOutputs(options);
  const primary = outputs?.primary ?? 'assembly';
  const comparison = outputs?.comparison ?? 'optimized';
  return {
    primary: kinds.includes(primary) ? primary : kinds[0],
    comparison: kinds.includes(comparison) ? comparison : kinds[1]
  };
}

/** Only auxiliary tab groups can fold away while leaving their tabs visible. */
export function isToolArea(panes: readonly Pane[]): boolean {
  return panes.every(
    pane => !['explorer', 'source', 'outputs', 'comparison'].includes(pane)
  );
}

function activateSource(
  state: State,
  file: File,
  language: Options['language']
): State {
  const source = text(file);
  if (source === null) {
    return state;
  }
  const options = { ...state.options, language };
  return {
    ...state,
    source,
    activeFile: file.path,
    selectedFile: file.path,
    options,
    outputs: outputSelection(options, state.outputs)
  };
}

function equalOptions(left: Options, right: Options): boolean {
  return (
    left.language === right.language &&
    left.target === right.target &&
    left.optimization === right.optimization &&
    left.llvmPipeline === right.llvmPipeline &&
    left.analysisPipeline === right.analysisPipeline &&
    left.mlirPipeline === right.mlirPipeline
  );
}
