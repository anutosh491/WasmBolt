import type {
  CommandRequest,
  CommandResult,
  Progress
} from '../compiler/types';
import { isLldbOutput, lldbInvocation } from './protocol';
import type { LldbInput } from './protocol';

export interface ILldbWorker {
  postMessage(message: LldbInput): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export interface ILldbStaticInspector {
  run(
    request: CommandRequest,
    onProgress?: (progress: Progress) => void
  ): Promise<CommandResult>;
  cancel(): void;
  dispose(): void;
}

/** A static inspection owns a fresh threaded LLDB runtime and discards it. */
export function createLldbStaticInspector(
  url: URL,
  create: () => ILldbWorker = () =>
    new Worker(url, { type: 'module', name: 'lldb-static-inspection' }),
  assetBase: URL = new URL('.', url)
): ILldbStaticInspector {
  let active: Readonly<{
    worker: ILldbWorker;
    reject(error: Error): void;
  }> | null = null;
  let disposed = false;

  const finish = (worker: ILldbWorker) => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    if (active?.worker === worker) {
      active = null;
    }
  };

  return {
    run(request, onProgress) {
      if (disposed) {
        return Promise.reject(new Error('LLDB inspection is disposed.'));
      }
      if (active) {
        return Promise.reject(new Error('LLDB inspection is already running.'));
      }
      const invocation = lldbInvocation(request.command);
      if (!request.files.some(file => file.path === invocation.target)) {
        return Promise.reject(
          new Error(`${invocation.target} is not in the workspace.`)
        );
      }
      return new Promise((resolve, reject) => {
        const worker = create();
        active = { worker, reject };
        worker.onmessage = event => {
          if (active?.worker !== worker) {
            return;
          }
          if (!isLldbOutput(event.data)) {
            finish(worker);
            reject(new Error('LLDB returned an invalid response.'));
            return;
          }
          if (event.data.id !== request.id) {
            finish(worker);
            reject(new Error('The LLDB response belongs to another request.'));
          } else if (event.data.kind === 'progress') {
            onProgress?.(event.data.progress);
          } else if (event.data.kind === 'error') {
            finish(worker);
            reject(new Error(event.data.message));
          } else {
            finish(worker);
            resolve(event.data.result);
          }
        };
        worker.onerror = event => {
          if (active?.worker === worker) {
            event.preventDefault();
            const location = event.filename
              ? ` (${event.filename}:${event.lineno}:${event.colno})`
              : '';
            finish(worker);
            reject(
              new Error(
                `${event.message || 'LLDB inspection failed.'}${location}`
              )
            );
          }
        };
        worker.onmessageerror = () => {
          if (active?.worker === worker) {
            finish(worker);
            reject(new Error('The LLDB response could not be read.'));
          }
        };
        worker.postMessage({
          kind: 'run',
          id: request.id,
          base: assetBase.href,
          request
        });
      });
    },
    cancel() {
      if (active) {
        const current = active;
        finish(current.worker);
        const error = new Error('LLDB inspection cancelled.');
        error.name = 'AbortError';
        current.reject(error);
      }
    },
    dispose() {
      disposed = true;
      if (active) {
        const current = active;
        finish(current.worker);
        current.reject(new Error('LLDB inspection is disposed.'));
      }
    }
  };
}
