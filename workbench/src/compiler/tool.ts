import type { CommandResult, Progress } from './types';
import type {
  ToolInput,
  ToolOutput,
  ToolRequest,
  ToolRuntime
} from './tool-protocol';
import { isToolOutput, requestArgv, requestCommand } from './tool-protocol';

export interface IToolWorker {
  postMessage(message: ToolInput): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export interface IIsolatedTool {
  run(
    request: ToolRequest,
    onProgress?: (progress: Progress) => void
  ): Promise<CommandResult>;
  cancel(): void;
  dispose(): void;
}

type Active = Readonly<{
  worker: IToolWorker;
  reject(error: Error): void;
}>;

/** Every invocation gets a fresh process-equivalent Worker and runtime. */
export function createIsolatedTool(
  workerUrl: URL,
  assetBase: URL,
  runtime: ToolRuntime,
  create: () => IToolWorker = () => new Worker(workerUrl, { type: 'module' })
): IIsolatedTool {
  let active: Active | null = null;
  let disposed = false;

  function finish(worker: IToolWorker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    if (active?.worker === worker) {
      active = null;
    }
  }

  function stop(error: Error): void {
    if (!active) {
      return;
    }
    const current = active;
    finish(current.worker);
    current.reject(error);
  }

  return {
    run(request, onProgress) {
      if (disposed) {
        return Promise.reject(new Error(`${runtime.name} is disposed.`));
      }
      if (active) {
        return Promise.reject(
          new Error(`${runtime.name} is already in progress.`)
        );
      }
      try {
        requestArgv(request);
        requestCommand(request);
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error))
        );
      }
      return new Promise((resolve, reject) => {
        const worker = create();
        active = { worker, reject };
        worker.onmessage = event => {
          if (active?.worker !== worker) {
            return;
          }
          if (!isToolOutput(event.data)) {
            finish(worker);
            reject(new Error(`${runtime.name} returned an invalid response.`));
            return;
          }
          const output: ToolOutput = event.data;
          if (output.id !== request.id) {
            finish(worker);
            reject(new Error('The response belongs to another request.'));
          } else if (output.kind === 'progress') {
            onProgress?.(output.progress);
          } else if (output.kind === 'error') {
            finish(worker);
            reject(new Error(output.message));
          } else {
            finish(worker);
            resolve(output.result);
          }
        };
        worker.onerror = event => {
          if (active?.worker === worker) {
            event.preventDefault();
            finish(worker);
            reject(new Error(event.message || `${runtime.name} failed.`));
          }
        };
        worker.onmessageerror = () => {
          if (active?.worker === worker) {
            finish(worker);
            reject(new Error(`${runtime.name} response could not be read.`));
          }
        };
        try {
          worker.postMessage({
            kind: 'run',
            id: request.id,
            base: assetBase.href,
            runtime,
            request
          });
        } catch (error) {
          finish(worker);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    cancel() {
      const error = new Error(`${runtime.name} execution cancelled.`);
      error.name = 'AbortError';
      stop(error);
    },
    dispose() {
      disposed = true;
      stop(new Error(`${runtime.name} is disposed.`));
    }
  };
}
