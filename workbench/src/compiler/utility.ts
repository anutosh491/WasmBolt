import { diagnostics } from './diagnostics';
import { isFiles, isProgress, isRecord } from './protocol';
import { command, utilitySubcommand } from './terminal';
import type { CommandRequest, CommandResult, Progress } from './types';

export type UtilityInput = Readonly<{
  kind: 'utility';
  id: number;
  base: string;
  request: CommandRequest;
  args: readonly string[];
  stdout: string | null;
  stderr: string | null;
}>;

export type UtilityOutput =
  | Readonly<{ kind: 'progress'; id: number; progress: Progress }>
  | Readonly<{
      kind: 'result';
      id: number;
      files: CommandResult['files'];
      stdout: string;
      stderr: string;
      exitCode: number;
      duration: number;
    }>
  | Readonly<{ kind: 'error'; id: number; message: string }>;

export interface IUtilityWorker {
  postMessage(message: UtilityInput): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export function isUtilityInput(value: unknown): value is UtilityInput {
  return (
    isRecord(value) &&
    value.kind === 'utility' &&
    Number.isSafeInteger(value.id) &&
    typeof value.base === 'string' &&
    isRecord(value.request) &&
    Number.isSafeInteger(value.request.id) &&
    typeof value.request.command === 'string' &&
    isFiles(value.request.files) &&
    Array.isArray(value.args) &&
    value.args.length > 1 &&
    value.args.every(arg => typeof arg === 'string' && !arg.includes('\0')) &&
    (value.stdout === null || typeof value.stdout === 'string') &&
    (value.stderr === null || typeof value.stderr === 'string')
  );
}

export function isUtilityOutput(value: unknown): value is UtilityOutput {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    !['progress', 'result', 'error'].includes(String(value.kind))
  ) {
    return false;
  }
  if (value.kind === 'progress') {
    return isProgress(value.progress);
  }
  if (value.kind === 'error') {
    return typeof value.message === 'string';
  }
  return (
    isFiles(value.files) &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string' &&
    Number.isInteger(value.exitCode) &&
    typeof value.duration === 'number' &&
    Number.isFinite(value.duration) &&
    value.duration >= 0
  );
}

/** Run one utility in a new worker, then release all of its process state. */
export function createUtilityRunner(
  compilerUrl: URL,
  create: () => IUtilityWorker = () =>
    new Worker(new URL('utility-worker.js', compilerUrl), { type: 'module' })
) {
  let worker: IUtilityWorker | null = null;
  let disposed = false;
  let rejectCurrent: ((error: Error) => void) | null = null;

  function stop(error?: Error): void {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    if (error) {
      rejectCurrent?.(error);
    }
    rejectCurrent = null;
  }

  return {
    async command(
      request: CommandRequest,
      onProgress?: (progress: Progress) => void
    ): Promise<CommandResult | null> {
      const parsed = command(request.command);
      const subcommand = utilitySubcommand(parsed.tool);
      if (subcommand === null) {
        return null;
      }
      if (disposed) {
        throw new Error('The compiler has been disposed.');
      }
      if (worker) {
        throw new Error('An LLVM utility is already running.');
      }
      const current = create();
      worker = current;
      const started = performance.now();
      const input: UtilityInput = {
        kind: 'utility',
        id: request.id,
        base: new URL('.', compilerUrl).href,
        request,
        args: [subcommand, ...parsed.args.slice(1)],
        stdout: parsed.stdout,
        stderr: parsed.stderr
      };
      return new Promise<CommandResult>((resolve, reject) => {
        rejectCurrent = reject;
        current.onmessage = event => {
          if (worker !== current) {
            return;
          }
          if (!isUtilityOutput(event.data) || event.data.id !== request.id) {
            stop(new Error('The LLVM utility returned an invalid response.'));
            return;
          }
          const output = event.data;
          if (output.kind === 'progress') {
            onProgress?.(output.progress);
            return;
          }
          stop();
          if (output.kind === 'error') {
            reject(new Error(output.message));
            return;
          }
          resolve({
            id: request.id,
            files: output.files,
            stage: {
              name: parsed.tool,
              status: output.exitCode === 0 ? 'success' : 'failed',
              commands: [request.command],
              stdout: output.stdout,
              stderr: output.stderr,
              diagnostics: diagnostics(output.stderr),
              exitCode: output.exitCode,
              duration: output.duration || performance.now() - started
            }
          });
        };
        current.onerror = event => {
          event.preventDefault();
          if (worker === current) {
            stop(new Error(event.message || 'The LLVM utility failed.'));
          }
        };
        current.onmessageerror = () => {
          if (worker === current) {
            stop(new Error('The LLVM utility response could not be read.'));
          }
        };
        current.postMessage(input);
      });
    },
    cancel(): void {
      const error = new Error('Compilation cancelled.');
      error.name = 'AbortError';
      stop(error);
    },
    dispose(): void {
      disposed = true;
      stop(new Error('The compiler has been disposed.'));
    }
  };
}
