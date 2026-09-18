export type WatInput = Readonly<{
  kind: 'wat';
  id: number;
  data: Uint8Array;
}>;

export type WatOutput =
  | Readonly<{ kind: 'result'; id: number; text: string }>
  | Readonly<{ kind: 'error'; id: number; message: string }>;

export interface IWatWorker {
  postMessage(message: WatInput, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export interface IWatRenderer {
  render(data: Uint8Array, signal?: AbortSignal): Promise<string>;
  dispose(): void;
}

type Active = {
  worker: IWatWorker;
  reject(error: Error): void;
  signal?: AbortSignal;
  abort?(): void;
};

/** Render WAT in a fresh Worker so its parser heap is always released. */
export function createWatRenderer(
  url: URL,
  create: () => IWatWorker = () => new Worker(url, { type: 'module' })
): IWatRenderer {
  const active = new Set<Active>();
  let sequence = 0;
  let disposed = false;

  const finish = (current: Active): void => {
    current.worker.onmessage = null;
    current.worker.onerror = null;
    current.worker.onmessageerror = null;
    current.worker.terminate();
    if (current.signal && current.abort) {
      current.signal.removeEventListener('abort', current.abort);
    }
    active.delete(current);
  };

  return {
    render(data, signal) {
      if (disposed) {
        return Promise.reject(new Error('The WAT renderer is disposed.'));
      }
      return new Promise((resolve, reject) => {
        const worker = create();
        const current: Active = { worker, reject, signal };
        const fail = (error: Error) => {
          if (active.has(current)) {
            finish(current);
            reject(error);
          }
        };
        current.abort = () => {
          const error = new Error('WAT rendering cancelled.');
          error.name = 'AbortError';
          fail(error);
        };
        active.add(current);
        if (signal?.aborted) {
          current.abort();
          return;
        }
        signal?.addEventListener('abort', current.abort, { once: true });
        const id = ++sequence;
        worker.onmessage = event => {
          if (!active.has(current)) {
            return;
          }
          if (!isWatOutput(event.data) || event.data.id !== id) {
            fail(new Error('The WAT worker returned an invalid response.'));
            return;
          }
          const output = event.data;
          finish(current);
          if (output.kind === 'error') {
            reject(new Error(output.message));
          } else {
            resolve(output.text);
          }
        };
        worker.onerror = event => {
          event.preventDefault();
          fail(new Error(event.message || 'The WAT worker failed.'));
        };
        worker.onmessageerror = () => {
          fail(new Error('The WAT worker response could not be read.'));
        };
        try {
          const copy = data.slice();
          worker.postMessage({ kind: 'wat', id, data: copy }, [copy.buffer]);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      disposed = true;
      for (const current of [...active]) {
        finish(current);
        current.reject(new Error('The WAT renderer is disposed.'));
      }
    }
  };
}

export function isWatInput(value: unknown): value is WatInput {
  return (
    isRecord(value) &&
    value.kind === 'wat' &&
    Number.isSafeInteger(value.id) &&
    value.data instanceof Uint8Array
  );
}

export function isWatOutput(value: unknown): value is WatOutput {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    ((value.kind === 'result' && typeof value.text === 'string') ||
      (value.kind === 'error' && typeof value.message === 'string'))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
