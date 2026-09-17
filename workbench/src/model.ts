import type { RunResult } from './compiler/execution';
import type {
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

export type Pane =
  | 'source'
  | 'outputs'
  | 'comparison'
  | 'diagnostics'
  | 'files'
  | 'terminal'
  | 'run'
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

export type State = Readonly<{
  source: string;
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
  notice: string | null;
  position: Readonly<{ line: number; column: number; serial: number }> | null;
}>;

export type Action =
  | Readonly<{ type: 'source'; source: string }>
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
  | Readonly<{ type: 'navigate'; line: number; column: number }>;

export const options: Options = {
  language: 'cpp',
  target: 'wasm32-unknown-emscripten',
  optimization: 2,
  ...pipelines
};

/** Create an independent application state from a validated session. */
export function initial(session: Session | null = null): State {
  return {
    source: session?.source ?? examples.cpp,
    options: session?.options ?? options,
    layout: session?.layout ?? null,
    outputs: outputSelection(session?.options ?? options, session?.outputs),
    timeout: session?.timeout ?? 10000,
    revision: 0,
    status: 'idle',
    info: null,
    progress: null,
    active: null,
    result: null,
    files: [],
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
            revision: state.revision + 1
          };
    case 'options':
      return equalOptions(action.options, state.options)
        ? state
        : {
            ...state,
            options: action.options,
            source:
              state.source === examples[state.options.language]
                ? examples[action.options.language]
                : state.source,
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
              terminal: [],
              result: { revision: state.active.revision, value: action.result },
              filesRevision: state.active.revision
            },
            action.result.files,
            true
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
  compiled = false
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
        const unchanged =
          !compiled &&
          previous?.data.length === file.data.length &&
          previous.data.every((byte, index) => byte === file.data[index]);
        return [
          file.path,
          unchanged
            ? state.moduleRevisions[file.path]
            : (state.filesRevision ?? state.revision)
        ];
      })
  );
  return selectModule({ ...state, files, moduleRevisions }, path);
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
    pane => !['source', 'outputs', 'comparison'].includes(pane)
  );
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
