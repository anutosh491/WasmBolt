import { isFiles, isRecord } from '../compiler/protocol';
import type { DebugEvent, DebugStartRequest } from './debugger';

export type DebugControl =
  'continue' | 'pause' | 'stepOver' | 'stepIn' | 'stepOut';

export type DebuggerInput =
  | Readonly<{
      kind: 'start';
      id: number;
      base: string;
      request: DebugStartRequest;
    }>
  | Readonly<{
      kind: 'breakpoints';
      id: number;
      path: string;
      lines: readonly number[];
    }>
  | Readonly<{
      kind: 'control';
      id: number;
      control: DebugControl;
    }>
  | Readonly<{ kind: 'frame'; id: number; frameId: number }>
  | Readonly<{ kind: 'command'; id: number; command: string }>;

export type DebuggerOutput =
  | Readonly<{ kind: 'response'; id: number }>
  | Readonly<{ kind: 'event'; event: DebugEvent }>
  | Readonly<{ kind: 'error'; id: number; message: string }>;

export function isDebuggerInput(value: unknown): value is DebuggerInput {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) {
    return false;
  }
  if (value.kind === 'start') {
    return typeof value.base === 'string' && isStartRequest(value.request);
  }
  if (value.kind === 'breakpoints') {
    return (
      isWorkspacePath(value.path) &&
      Array.isArray(value.lines) &&
      value.lines.every(line => Number.isInteger(line) && Number(line) > 0)
    );
  }
  if (value.kind === 'control') {
    return ['continue', 'pause', 'stepOver', 'stepIn', 'stepOut'].includes(
      String(value.control)
    );
  }
  if (value.kind === 'frame') {
    return Number.isSafeInteger(value.frameId);
  }
  return (
    value.kind === 'command' &&
    typeof value.command === 'string' &&
    value.command.trim().length > 0 &&
    !value.command.includes('\0')
  );
}

export function isDebuggerOutput(value: unknown): value is DebuggerOutput {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'event') {
    return isDebugEvent(value.event);
  }
  return (
    Number.isSafeInteger(value.id) &&
    (value.kind === 'response' ||
      (value.kind === 'error' && typeof value.message === 'string'))
  );
}

function isStartRequest(value: unknown): value is DebugStartRequest {
  if (
    !isRecord(value) ||
    !isWorkspacePath(value.module) ||
    !value.module.endsWith('.wasm') ||
    typeof value.entry !== 'string' ||
    value.entry.includes('\0') ||
    !isFiles(value.files) ||
    !value.files.some(file => file.path === value.module) ||
    !Array.isArray(value.sourcePaths) ||
    !value.sourcePaths.every(isWorkspacePath) ||
    !Array.isArray(value.breakpoints) ||
    !value.breakpoints.every(isBreakpoint) ||
    !Array.isArray(value.argv) ||
    !value.argv.every(
      argument => typeof argument === 'string' && !argument.includes('\0')
    )
  ) {
    return false;
  }
  return true;
}

function isWorkspacePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/workspace/') &&
    !value.includes('\0') &&
    !value
      .split('/')
      .slice(1)
      .some(part => !part || part === '.' || part === '..')
  );
}

function isBreakpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    isWorkspacePath(value.path) &&
    Number.isInteger(value.line) &&
    Number(value.line) > 0 &&
    (value.verified === null || typeof value.verified === 'boolean') &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

function isDebugEvent(value: unknown): value is DebugEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'status') {
    return (
      ['idle', 'starting', 'running', 'stopped', 'exited', 'error'].includes(
        String(value.status)
      ) &&
      (value.message === undefined || typeof value.message === 'string')
    );
  }
  if (value.type === 'running') {
    return true;
  }
  if (value.type === 'exited') {
    return Number.isInteger(value.exitCode);
  }
  if (value.type === 'error') {
    return typeof value.message === 'string';
  }
  if (value.type === 'console') {
    return (
      ['input', 'stdout', 'stderr', 'console'].includes(
        String(value.channel)
      ) && typeof value.text === 'string'
    );
  }
  if (value.type === 'breakpoints') {
    return (
      isWorkspacePath(value.path) &&
      Array.isArray(value.breakpoints) &&
      value.breakpoints.every(isBreakpoint)
    );
  }
  if (value.type === 'frame') {
    return (
      Number.isSafeInteger(value.frameId) &&
      Array.isArray(value.variables) &&
      value.variables.every(isVariable)
    );
  }
  return (
    value.type === 'stopped' &&
    Number.isSafeInteger(value.threadId) &&
    Array.isArray(value.frames) &&
    value.frames.every(isFrame) &&
    (value.frameId === null || Number.isSafeInteger(value.frameId)) &&
    Array.isArray(value.variables) &&
    value.variables.every(isVariable) &&
    typeof value.reason === 'string'
  );
}

function isFrame(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    typeof value.name === 'string' &&
    (value.path === null || typeof value.path === 'string') &&
    (value.line === null || Number.isInteger(value.line)) &&
    (value.column === null || Number.isInteger(value.column))
  );
}

function isVariable(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.value === 'string' &&
    (value.type === undefined || typeof value.type === 'string') &&
    (value.variablesReference === undefined ||
      Number.isSafeInteger(value.variablesReference))
  );
}
