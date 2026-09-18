import type { File } from '../compiler/types';

export type DebugStatus =
  'idle' | 'starting' | 'running' | 'stopped' | 'exited' | 'error';

export type DebugBreakpoint = Readonly<{
  path: string;
  line: number;
  verified: boolean | null;
  message?: string;
}>;

export type DebugFrame = Readonly<{
  id: number;
  name: string;
  path: string | null;
  line: number | null;
  column: number | null;
}>;

export type DebugVariable = Readonly<{
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
}>;

export type DebugStartRequest = Readonly<{
  module: string;
  /** Export invoked by WAMR after LLDB attaches. */
  entry: string;
  files: readonly File[];
  sourcePaths: readonly string[];
  breakpoints: readonly DebugBreakpoint[];
  /** Program arguments, excluding argv[0]. */
  argv: readonly string[];
}>;

/** Domain events keep the workbench independent of the DAP Worker protocol. */
export type DebugEvent =
  | Readonly<{ type: 'status'; status: DebugStatus; message?: string }>
  | Readonly<{
      type: 'breakpoints';
      path: string;
      breakpoints: readonly DebugBreakpoint[];
    }>
  | Readonly<{
      type: 'stopped';
      threadId: number;
      frames: readonly DebugFrame[];
      frameId: number | null;
      variables: readonly DebugVariable[];
      reason: string;
    }>
  | Readonly<{ type: 'running' }>
  | Readonly<{ type: 'exited'; exitCode: number }>
  | Readonly<{
      type: 'frame';
      frameId: number;
      variables: readonly DebugVariable[];
    }>
  | Readonly<{
      type: 'console';
      channel: 'input' | 'stdout' | 'stderr' | 'console';
      text: string;
    }>
  | Readonly<{ type: 'error'; message: string }>;

export interface IDebuggerClient {
  start(request: DebugStartRequest): Promise<void>;
  setBreakpoints(path: string, lines: readonly number[]): Promise<void>;
  continue(): Promise<void>;
  pause(): Promise<void>;
  stepOver(): Promise<void>;
  stepIn(): Promise<void>;
  stepOut(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  selectFrame(frameId: number): Promise<void>;
  command(text: string): Promise<void>;
  subscribe(listener: (event: DebugEvent) => void): () => void;
  dispose(): void;
}
