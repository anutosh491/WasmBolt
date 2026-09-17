import { isOutput } from './protocol';
import type { Input, Output } from './protocol';
import type { ICompiler, Info, Progress } from './types';
import type { RunRequest, RunResult } from './execution';

export interface IWorker {
  postMessage(message: Input): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

type Pending = {
  resolve(output: Output): void;
  reject(error: Error): void;
  onProgress?: (progress: Progress) => void;
};

type Loading = {
  listeners: Set<(progress: Progress) => void>;
  progress: Progress | null;
};

/** One disposable worker owns the compiler and all of its process state. */
export function createCompiler(
  url: URL,
  create: () => IWorker = () => new Worker(url, { type: 'module' })
): ICompiler {
  return createClient(url, create);
}

export interface IClient extends ICompiler {
  execute(
    request: RunRequest,
    onProgress?: (progress: Progress) => void
  ): Promise<RunResult>;
}

/** Shared request transport; each client owns a distinct worker. */
export function createClient(
  url: URL,
  create: () => IWorker = () => new Worker(url, { type: 'module' })
): IClient {
  let worker: IWorker | null = null;
  let ready: Promise<Info> | null = null;
  let loading: Loading | null = null;
  let disposed = false;
  let busy: number | null = null;
  let sequence = 0;
  let generation = 0;
  const pending = new Map<number, Pending>();

  function stop(error: Error): void {
    generation += 1;
    busy = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    ready = null;
    loading = null;
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  }

  function start(): IWorker {
    if (disposed) {
      throw new Error('The compiler has been disposed.');
    }
    if (worker) {
      return worker;
    }
    const current = create();
    worker = current;
    current.onmessage = event => {
      if (worker !== current) {
        return;
      }
      if (!isOutput(event.data)) {
        stop(new Error('The compiler returned an invalid response.'));
        return;
      }
      const output = event.data;
      const entry = pending.get(output.id);
      if (!entry) {
        return;
      }
      if (output.kind === 'progress') {
        entry.onProgress?.(output.progress);
      } else if (output.kind === 'error') {
        stop(new Error(output.message));
      } else {
        pending.delete(output.id);
        entry.resolve(output);
      }
    };
    current.onerror = event => {
      if (worker === current) {
        event.preventDefault();
        stop(new Error(event.message || 'The compiler worker failed.'));
      }
    };
    current.onmessageerror = () => {
      if (worker === current) {
        stop(new Error('The compiler response could not be read.'));
      }
    };
    return current;
  }

  function send(
    input: Input,
    onProgress?: (progress: Progress) => void
  ): Promise<Output> {
    return new Promise((resolve, reject) => {
      const current = start();
      pending.set(input.id, { resolve, reject, onProgress });
      try {
        current.postMessage(input);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function initialize(
    onProgress?: (progress: Progress) => void
  ): Promise<Info> {
    if (!ready) {
      const current: Loading = { listeners: new Set(), progress: null };
      loading = current;
      ready = send(
        {
          kind: 'initialize',
          id: ++sequence,
          base: new URL('.', url).href
        },
        progress => {
          current.progress = progress;
          for (const listener of current.listeners) {
            listener(progress);
          }
        }
      )
        .then(output => {
          if (output.kind !== 'ready') {
            throw new Error('Expected compiler capabilities.');
          }
          return output.info;
        })
        .finally(() => {
          current.listeners.clear();
          if (loading === current) {
            loading = null;
          }
        });
      const attempt = ready;
      void attempt.catch(() => {
        if (ready === attempt) {
          ready = null;
        }
      });
    }
    if (onProgress && loading) {
      loading.listeners.add(onProgress);
      if (loading.progress) {
        onProgress(loading.progress);
      }
    }
    return ready;
  }

  async function invoke(
    task: Exclude<Input, { kind: 'initialize' }>,
    onProgress?: (progress: Progress) => void
  ): Promise<Exclude<Output, { kind: 'ready' | 'progress' | 'error' }>> {
    if (busy !== null) {
      throw new Error('A compiler operation is already in progress.');
    }
    busy = task.id;
    const current = generation;
    try {
      await initialize(onProgress);
      if (current !== generation) {
        const error = new Error('Compilation cancelled.');
        error.name = 'AbortError';
        throw error;
      }
      const output = await send(task, onProgress);
      if (!('result' in output) || output.result.id !== task.request.id) {
        throw new Error('The response belongs to another request.');
      }
      return output;
    } finally {
      if (busy === task.id) {
        busy = null;
      }
    }
  }

  return {
    initialize,
    async compile(request, onProgress) {
      const output = await invoke(
        {
          kind: 'compile',
          id: ++sequence,
          request
        },
        onProgress
      );
      if (output.kind !== 'result') {
        throw new Error('Expected a compilation result.');
      }
      return output.result;
    },
    async command(request, onProgress) {
      const output = await invoke(
        {
          kind: 'command',
          id: ++sequence,
          request
        },
        onProgress
      );
      if (output.kind !== 'command') {
        throw new Error('Expected a command result.');
      }
      return output.result;
    },
    async execute(request, onProgress) {
      const output = await invoke(
        {
          kind: 'execute',
          id: ++sequence,
          request
        },
        onProgress
      );
      if (output.kind !== 'execution') {
        throw new Error('Expected an execution result.');
      }
      return output.result;
    },
    cancel() {
      const error = new Error('Compilation cancelled.');
      error.name = 'AbortError';
      stop(error);
    },
    dispose() {
      disposed = true;
      stop(new Error('The compiler has been disposed.'));
    }
  };
}
