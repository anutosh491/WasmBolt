import { createCompiler } from '../compiler/client';
import type { IWorker } from '../compiler/client';
import type { Input, Output } from '../compiler/protocol';
import { options } from '../model';

class Worker implements IWorker {
  onmessage: IWorker['onmessage'] = null;
  onerror: IWorker['onerror'] = null;
  onmessageerror: IWorker['onmessageerror'] = null;
  messages: Input[] = [];
  terminated = false;
  postMessage(input: Input): void {
    this.messages.push(input);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(output: Output): void {
    this.onmessage?.(new MessageEvent('message', { data: output }));
  }
}

const info = {
  version: 'LLVM 23.1.0',
  resourceDirectory: '/lib/clang/23',
  targets: [options.target]
};

function setup() {
  const workers: Worker[] = [];
  const compiler = createCompiler(
    new URL('https://example.test/compiler/worker.js'),
    () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    }
  );
  return { compiler, workers };
}

it('cancels loading and initializes a fresh worker on retry', async () => {
  const { compiler, workers } = setup();
  const first = compiler.initialize();
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  compiler.cancel();
  await rejected;
  expect(workers[0].terminated).toBe(true);
  const next = compiler.initialize();
  workers[1].reply({ kind: 'ready', id: workers[1].messages[0].id, info });
  await expect(next).resolves.toEqual(info);
  compiler.dispose();
});

it('cancels between readiness and compilation', async () => {
  const { compiler, workers } = setup();
  const pending = compiler.compile({
    id: 1,
    source: '',
    sourcePath: '/workspace/snippet.cpp',
    files: [],
    options
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError'
  });
  workers[0].reply({ kind: 'ready', id: workers[0].messages[0].id, info });
  compiler.cancel();
  await rejected;
  expect(workers).toHaveLength(1);
  expect(workers[0].messages).toHaveLength(1);
});

it('ignores a callback retained from a terminated worker', async () => {
  const { compiler, workers } = setup();
  const first = compiler.initialize();
  const rejected = expect(first).rejects.toThrow();
  const late = workers[0].onmessage;
  compiler.cancel();
  await rejected;
  const next = compiler.initialize();
  late?.(
    new MessageEvent('message', {
      data: {
        kind: 'error',
        id: workers[1].messages[0].id,
        message: 'obsolete'
      }
    })
  );
  expect(workers[1].terminated).toBe(false);
  workers[1].reply({ kind: 'ready', id: workers[1].messages[0].id, info });
  await expect(next).resolves.toEqual(info);
  compiler.dispose();
});

it('settles failures and refuses work after disposal', async () => {
  const { compiler, workers } = setup();
  const pending = compiler.initialize();
  workers[0].reply({
    kind: 'error',
    id: workers[0].messages[0].id,
    message: 'missing asset'
  });
  await expect(pending).rejects.toThrow('missing asset');
  compiler.dispose();
  await expect(compiler.initialize()).rejects.toThrow('disposed');
});

it('shares progress until initialization settles', async () => {
  const { compiler, workers } = setup();
  const first = jest.fn();
  const pending = compiler.initialize(first);
  const id = workers[0].messages[0].id;
  const progress = {
    phase: 'downloading' as const,
    downloads: [{ name: 'Compiler.wasm', loaded: 3, total: 10 }]
  };
  workers[0].reply({ kind: 'progress', id, progress });
  expect(first).toHaveBeenCalledWith(progress);
  const second = jest.fn();
  expect(compiler.initialize(second)).toBe(pending);
  expect(second).toHaveBeenCalledWith(progress);
  const settled = jest.fn();
  void pending.then(settled);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  workers[0].reply({ kind: 'progress', id: id + 1, progress });
  expect(first).toHaveBeenCalledTimes(1);
  workers[0].reply({ kind: 'ready', id, info });
  await expect(pending).resolves.toEqual(info);
  workers[0].reply({ kind: 'progress', id, progress });
  const cached = jest.fn();
  await compiler.initialize(cached);
  expect(cached).not.toHaveBeenCalled();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  compiler.dispose();
});

it('ignores old progress after cancellation and retry', async () => {
  const { compiler, workers } = setup();
  const first = jest.fn();
  const pending = compiler.initialize(first);
  const rejected = expect(pending).rejects.toThrow();
  const late = workers[0].onmessage;
  compiler.cancel();
  const second = jest.fn();
  const next = compiler.initialize(second);
  await rejected;
  const id = workers[1].messages[0].id;
  late?.(
    new MessageEvent('message', {
      data: { kind: 'progress', id, progress: { phase: 'preparing' } }
    })
  );
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  workers[1].reply({ kind: 'progress', id, progress: { phase: 'preparing' } });
  expect(second).toHaveBeenCalledWith({ phase: 'preparing' });
  workers[1].reply({ kind: 'ready', id, info });
  await expect(next).resolves.toEqual(info);
  compiler.dispose();
});
