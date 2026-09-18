import { createClangd } from '../clangd/client';
import type { ClangdInput, ClangdOutput } from '../clangd/protocol';
import type { IClangdWorker } from '../clangd/types';

class FakeWorker implements IClangdWorker {
  onmessage: IClangdWorker['onmessage'] = null;
  onerror: IClangdWorker['onerror'] = null;
  onmessageerror: IClangdWorker['onmessageerror'] = null;
  messages: ClangdInput[] = [];
  terminated = false;

  postMessage(message: ClangdInput): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: ClangdOutput): void {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = createClangd({
    workerUrl: new URL('https://example.test/clangd-worker.js'),
    assetBase: new URL('https://assets.example.test/clangd/'),
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { client, workers };
}

function initialize(worker: FakeWorker): void {
  worker.reply({ kind: 'ready' });
}

async function acknowledgeInitialize(worker: FakeWorker): Promise<void> {
  initialize(worker);
  await Promise.resolve();
  const initialization = request(worker, 'initialize');
  worker.reply({
    kind: 'lsp',
    message: { jsonrpc: '2.0', id: initialization.id, result: {} }
  });
}

function request(worker: FakeWorker, method: string) {
  const input = worker.messages.find(
    candidate => candidate.kind === 'lsp' && candidate.message.method === method
  );
  if (!input || input.kind !== 'lsp' || input.message.id === undefined) {
    throw new Error(`Missing ${method} request.`);
  }
  return input.message;
}

async function eventualRequest(worker: FakeWorker, method: string) {
  for (let attempt = 0; attempt < 8; ++attempt) {
    const input = worker.messages.find(
      candidate =>
        candidate.kind === 'lsp' && candidate.message.method === method
    );
    if (input?.kind === 'lsp' && input.message.id !== undefined) {
      return input.message;
    }
    await Promise.resolve();
  }
  throw new Error(`Missing ${method} request.`);
}

it('starts lazily and routes initialization and server requests', async () => {
  const { client, workers } = setup();
  expect(workers).toHaveLength(0);
  const pending = client.initialize();
  expect(workers[0].messages[0]).toEqual({
    kind: 'start',
    base: 'https://assets.example.test/clangd/'
  });
  initialize(workers[0]);
  await Promise.resolve();
  const initialization = request(workers[0], 'initialize');
  workers[0].reply({
    kind: 'lsp',
    message: { jsonrpc: '2.0', id: initialization.id, result: {} }
  });
  await expect(pending).resolves.toBeUndefined();
  expect(
    workers[0].messages.some(
      input => input.kind === 'lsp' && input.message.method === 'initialized'
    )
  ).toBe(true);

  workers[0].reply({
    kind: 'lsp',
    message: {
      jsonrpc: '2.0',
      id: 'folders',
      method: 'workspace/workspaceFolders'
    }
  });
  expect(workers[0].messages.at(-1)).toEqual({
    kind: 'lsp',
    message: {
      jsonrpc: '2.0',
      id: 'folders',
      result: [{ uri: 'file:///workspace', name: 'workspace' }]
    }
  });
  client.dispose();
});

it('syncs a C++ document, publishes diagnostics, and completes', async () => {
  const { client, workers } = setup();
  const opening = client.openDocument('src/main.cpp', 'int main() { ret }');
  initialize(workers[0]);
  await Promise.resolve();
  const initialization = request(workers[0], 'initialize');
  workers[0].reply({
    kind: 'lsp',
    message: { jsonrpc: '2.0', id: initialization.id, result: {} }
  });
  await opening;
  expect(workers[0].messages).toContainEqual({
    kind: 'sync',
    path: '/workspace/src/main.cpp',
    contents: 'int main() { ret }'
  });

  const listener = jest.fn();
  const unsubscribe = client.onDiagnostics(listener);
  workers[0].reply({
    kind: 'lsp',
    message: {
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///workspace/src/main.cpp',
        version: 1,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 13 },
              end: { line: 0, character: 16 }
            },
            severity: 1,
            message: "use of undeclared identifier 'ret'"
          }
        ]
      }
    }
  });
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'src/main.cpp', version: 1 })
  );

  const completion = client.completion(
    'src/main.cpp',
    { line: 0, character: 16 },
    { triggerKind: 1 }
  );
  const completionRequest = await eventualRequest(
    workers[0],
    'textDocument/completion'
  );
  workers[0].reply({
    kind: 'lsp',
    message: {
      jsonrpc: '2.0',
      id: completionRequest.id,
      result: { isIncomplete: false, items: [{ label: 'return' }] }
    }
  });
  await expect(completion).resolves.toEqual({
    isIncomplete: false,
    items: [{ label: 'return' }]
  });
  unsubscribe();
  client.dispose();
});

it('rejects pending work and terminates the worker on disposal', async () => {
  const { client, workers } = setup();
  const initializing = client.initialize();
  initialize(workers[0]);
  await Promise.resolve();
  client.dispose();
  await expect(initializing).rejects.toThrow('disposed');
  expect(workers[0].terminated).toBe(true);
  await expect(client.initialize()).rejects.toThrow('disposed');
});

it('suspends the worker and safely rejects pending work', async () => {
  const { client, workers } = setup();
  const opening = client.openDocument('src/main.cpp', 'int main() {}');
  await acknowledgeInitialize(workers[0]);
  await opening;

  const completion = client.completion('src/main.cpp', {
    line: 0,
    character: 4
  });
  await Promise.resolve();
  request(workers[0], 'textDocument/completion');

  client.suspend();

  await expect(completion).rejects.toThrow('suspended');
  expect(workers[0].terminated).toBe(true);
  expect(workers).toHaveLength(1);
  client.dispose();
});

it('restarts lazily with retained documents after suspension', async () => {
  const { client, workers } = setup();
  const contents = 'int main() { ret }';
  const opening = client.openDocument('src/main.cpp', contents);
  await acknowledgeInitialize(workers[0]);
  await opening;
  client.suspend();

  expect(workers[0].terminated).toBe(true);
  expect(workers).toHaveLength(1);

  const completion = client.completion('src/main.cpp', {
    line: 0,
    character: 16
  });
  expect(workers).toHaveLength(2);
  await acknowledgeInitialize(workers[1]);
  const completionRequest = await eventualRequest(
    workers[1],
    'textDocument/completion'
  );
  workers[1].reply({
    kind: 'lsp',
    message: {
      jsonrpc: '2.0',
      id: completionRequest.id,
      result: { isIncomplete: false, items: [{ label: 'return' }] }
    }
  });

  await expect(completion).resolves.toEqual({
    isIncomplete: false,
    items: [{ label: 'return' }]
  });
  expect(workers[1].messages).toContainEqual({
    kind: 'sync',
    path: '/workspace/src/main.cpp',
    contents
  });
  client.dispose();
});
