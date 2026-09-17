import { createDebugger } from '../lldb/client';
import type { IDebuggerWorker } from '../lldb/client';
import { isDebuggerInput } from '../lldb/debug-protocol';
import type { DebuggerInput, DebuggerOutput } from '../lldb/debug-protocol';
import type { DebugEvent, DebugStartRequest } from '../lldb/debugger';

class FakeWorker implements IDebuggerWorker {
  onmessage: IDebuggerWorker['onmessage'] = null;
  onerror: IDebuggerWorker['onerror'] = null;
  onmessageerror: IDebuggerWorker['onmessageerror'] = null;
  messages: DebuggerInput[] = [];
  terminated = false;

  postMessage(message: DebuggerInput): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: DebuggerOutput): void {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }
}

const startRequest: DebugStartRequest = {
  module: '/workspace/program.wasm',
  files: [
    {
      path: '/workspace/program.wasm',
      data: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
    },
    {
      path: '/workspace/main.cpp',
      data: new TextEncoder().encode('int main() { return 0; }')
    }
  ],
  sourcePaths: ['/workspace/main.cpp'],
  breakpoints: [],
  argv: []
};

function setup() {
  const workers: FakeWorker[] = [];
  const client = createDebugger({
    workerUrl: new URL('https://example.test/debug-worker.js'),
    assetBase: new URL('https://example.test/lldb-dap/'),
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { client, workers };
}

function acknowledge(worker: FakeWorker, index = -1): void {
  const message = worker.messages.at(index);
  if (!message) {
    throw new Error('The debugger worker received no request.');
  }
  worker.reply({ kind: 'response', id: message.id });
}

it('starts lazily and correlates controls and domain events', async () => {
  const { client, workers } = setup();
  const listener = jest.fn<void, [DebugEvent]>();
  client.subscribe(listener);
  expect(workers).toHaveLength(0);

  const starting = client.start(startRequest);
  expect(workers).toHaveLength(1);
  expect(workers[0].messages[0]).toEqual({
    kind: 'start',
    id: 1,
    base: 'https://example.test/lldb-dap/',
    request: startRequest
  });
  acknowledge(workers[0], 0);
  await starting;

  const continuing = client.continue();
  expect(workers[0].messages[1]).toEqual({
    kind: 'control',
    id: 2,
    control: 'continue'
  });
  workers[0].reply({
    kind: 'event',
    event: { type: 'running' }
  });
  acknowledge(workers[0], 1);
  await continuing;
  expect(listener).toHaveBeenCalledWith({ type: 'running' });

  client.dispose();
  expect(workers[0].terminated).toBe(true);
});

it('restarts in a fresh worker with the latest breakpoint snapshot', async () => {
  const { client, workers } = setup();
  const starting = client.start(startRequest);
  acknowledge(workers[0]);
  await starting;

  const setting = client.setBreakpoints('/workspace/main.cpp', [3, 7]);
  expect(workers[0].messages.at(-1)).toEqual({
    kind: 'breakpoints',
    id: 2,
    path: '/workspace/main.cpp',
    lines: [3, 7]
  });
  acknowledge(workers[0]);
  await setting;

  const restarting = client.restart();
  expect(workers[0].terminated).toBe(true);
  expect(workers).toHaveLength(2);
  expect(workers[1].messages[0]).toEqual(
    expect.objectContaining({
      kind: 'start',
      id: 3,
      request: expect.objectContaining({
        breakpoints: [
          { path: '/workspace/main.cpp', line: 3, verified: null },
          { path: '/workspace/main.cpp', line: 7, verified: null }
        ]
      })
    })
  );
  acknowledge(workers[1]);
  await restarting;
  client.dispose();
});

it('rejects pending requests when the worker fails', async () => {
  const { client, workers } = setup();
  const listener = jest.fn<void, [DebugEvent]>();
  client.subscribe(listener);
  const starting = client.start(startRequest);
  workers[0].reply({ kind: 'response', id: 999 });
  await expect(starting).rejects.toThrow('unknown request');
  expect(workers[0].terminated).toBe(true);
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error' })
  );
  client.dispose();
});

it('discards a failed runtime before another start', async () => {
  const { client, workers } = setup();
  const first = client.start(startRequest);
  const id = workers[0].messages[0].id;
  workers[0].reply({ kind: 'error', id, message: 'native runtime missing' });
  await expect(first).rejects.toThrow('native runtime missing');
  expect(workers[0].terminated).toBe(true);

  const second = client.start(startRequest);
  expect(workers).toHaveLength(2);
  acknowledge(workers[1]);
  await expect(second).resolves.toBeUndefined();
  client.dispose();
});

it('keeps process argv separate from function-entry concepts', () => {
  expect(
    isDebuggerInput({
      kind: 'start',
      id: 1,
      base: 'https://example.test/compiler/lldb-dap/',
      request: startRequest
    })
  ).toBe(true);
  expect(
    isDebuggerInput({
      kind: 'start',
      id: 1,
      base: 'https://example.test/compiler/lldb-dap/',
      request: { ...startRequest, argv: undefined, entry: 'main', args: [] }
    })
  ).toBe(false);
});
