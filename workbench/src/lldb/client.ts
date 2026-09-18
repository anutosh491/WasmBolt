import { isDebuggerOutput } from './debug-protocol';
import type { DebuggerInput } from './debug-protocol';
import type {
  DebugBreakpoint,
  DebugEvent,
  DebugStartRequest,
  IDebuggerClient
} from './debugger';

export interface IDebuggerWorker {
  postMessage(message: DebuggerInput): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export type DebuggerOptions = Readonly<{
  workerUrl: URL;
  assetBase: URL;
  requestTimeout?: number;
  createWorker?: () => IDebuggerWorker;
}>;

type Pending = Readonly<{
  resolve(): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}>;

type DebuggerRequest = DebuggerInput extends infer Input
  ? Input extends { id: number }
    ? Omit<Input, 'id'>
    : never
  : never;

/** A persistent LLDB-DAP client whose runtime is replaceable as one unit. */
export function createDebugger(options: DebuggerOptions): IDebuggerClient {
  const create =
    options.createWorker ??
    (() =>
      new Worker(options.workerUrl, {
        type: 'module',
        name: 'lldb-dap-debugger'
      }));
  const timeout = options.requestTimeout ?? 30_000;
  const listeners = new Set<(event: DebugEvent) => void>();
  const pending = new Map<number, Pending>();
  let worker: IDebuggerWorker | null = null;
  let lastStart: DebugStartRequest | null = null;
  let sequence = 0;
  let disposed = false;

  function publish(event: DebugEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function rejectPending(reason: Error): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(reason);
    }
    pending.clear();
  }

  function terminate(reason: Error): void {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    rejectPending(reason);
  }

  function fail(current: IDebuggerWorker, reason: Error): void {
    if (worker !== current) {
      return;
    }
    terminate(reason);
    publish({ type: 'error', message: reason.message });
  }

  function openWorker(): IDebuggerWorker {
    if (disposed) {
      throw new Error('The debugger has been disposed.');
    }
    if (worker) {
      return worker;
    }
    const current = create();
    worker = current;
    current.onmessage = (event: MessageEvent<unknown>) => {
      if (worker !== current) {
        return;
      }
      if (!isDebuggerOutput(event.data)) {
        fail(current, new Error('The debugger returned an invalid response.'));
        return;
      }
      const output = event.data;
      if (output.kind === 'event') {
        publish(output.event);
        return;
      }
      const entry = pending.get(output.id);
      if (!entry) {
        fail(
          current,
          new Error('The debugger returned a response for an unknown request.')
        );
        return;
      }
      clearTimeout(entry.timeout);
      pending.delete(output.id);
      if (output.kind === 'error') {
        entry.reject(new Error(output.message));
      } else {
        entry.resolve();
      }
    };
    current.onerror = event => {
      event.preventDefault();
      const location = event.filename
        ? ` (${event.filename}:${event.lineno}:${event.colno})`
        : '';
      fail(
        current,
        new Error(`${event.message || 'The debugger failed.'}${location}`)
      );
    };
    current.onmessageerror = () => {
      fail(current, new Error('The debugger response could not be read.'));
    };
    return current;
  }

  function send(input: DebuggerRequest): Promise<void> {
    if (disposed) {
      return Promise.reject(new Error('The debugger has been disposed.'));
    }
    const id = ++sequence;
    const current = openWorker();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`The debugger request timed out.`);
        reject(error);
        fail(current, error);
      }, timeout);
      pending.set(id, { resolve, reject, timeout: timer });
      current.postMessage({ ...input, id } as DebuggerInput);
    });
  }

  async function begin(request: DebugStartRequest): Promise<void> {
    if (worker) {
      throw new Error('A debugger session is already active.');
    }
    publish({ type: 'status', status: 'starting' });
    await send({
      kind: 'start',
      base: options.assetBase.href,
      request
    });
  }

  return {
    async start(request) {
      try {
        await begin(request);
        lastStart = request;
      } catch (error) {
        terminate(new Error('The failed debugger runtime was discarded.'));
        throw error;
      }
    },
    async setBreakpoints(path, lines) {
      if (!worker) {
        throw new Error('Start the debugger before updating breakpoints.');
      }
      if (lastStart) {
        const replacement: DebugBreakpoint[] = lines.map(line => ({
          path,
          line,
          verified: null
        }));
        lastStart = {
          ...lastStart,
          breakpoints: [
            ...lastStart.breakpoints.filter(item => item.path !== path),
            ...replacement
          ]
        };
      }
      await send({ kind: 'breakpoints', path, lines });
    },
    continue: () => send({ kind: 'control', control: 'continue' }),
    pause: () => send({ kind: 'control', control: 'pause' }),
    stepOver: () => send({ kind: 'control', control: 'stepOver' }),
    stepIn: () => send({ kind: 'control', control: 'stepIn' }),
    stepOut: () => send({ kind: 'control', control: 'stepOut' }),
    async restart() {
      if (!lastStart) {
        throw new Error('There is no debugger session to restart.');
      }
      const request = lastStart;
      terminate(new Error('The debugger runtime was restarted.'));
      try {
        await begin(request);
      } catch (error) {
        terminate(new Error('The failed debugger runtime was discarded.'));
        throw error;
      }
    },
    async stop() {
      terminate(new Error('The debugger session was stopped.'));
      publish({ type: 'status', status: 'idle' });
    },
    selectFrame: frameId => send({ kind: 'frame', frameId }),
    command: command => send({ kind: 'command', command }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        terminate(new Error('The debugger has been disposed.'));
        listeners.clear();
        lastStart = null;
      }
    }
  };
}
