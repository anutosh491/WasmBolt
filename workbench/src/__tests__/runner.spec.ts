import type { IWorker } from '../compiler/client';
import type { Input, Output } from '../compiler/protocol';
import { createRunner } from '../compiler/runner';

function setup() {
  const workers: (IWorker & { messages: Input[]; terminated: boolean })[] = [];
  const runner = createRunner(new URL('https://example.test/worker.js'), () => {
    const worker = {
      messages: [] as Input[],
      terminated: false,
      onmessage: null as IWorker['onmessage'],
      onerror: null as IWorker['onerror'],
      onmessageerror: null as IWorker['onmessageerror'],
      postMessage(input: Input) {
        this.messages.push(input);
      },
      terminate() {
        this.terminated = true;
      }
    };
    workers.push(worker);
    return worker;
  });
  const request = {
    id: 1,
    module: '/workspace/program.wasm',
    files: [{ path: '/workspace/program.wasm', data: Uint8Array.of(1) }],
    symbol: 'square',
    signatureCode: 1,
    args: [5]
  };
  const reply = (output: Output) =>
    workers.at(-1)?.onmessage?.(new MessageEvent('message', { data: output }));
  const ready = () =>
    reply({
      kind: 'ready',
      id: workers.at(-1)!.messages[0].id,
      info: { version: 'LLVM', resourceDirectory: '/', targets: [] }
    });
  return { runner, workers, request, reply, ready };
}

afterEach(() => jest.useRealTimers());

it('starts its deadline after loading and reuses the module', async () => {
  jest.useFakeTimers();
  const { runner, workers, request, reply, ready } = setup();
  const pending = runner.run(request, 100);
  await jest.advanceTimersByTimeAsync(1000);
  expect(workers[0].terminated).toBe(false);
  ready();
  await jest.advanceTimersByTimeAsync(0);
  const message = workers[0].messages.at(-1)!;
  expect(message.kind).toBe('execute');
  reply({
    kind: 'execution',
    id: message.id,
    result: {
      id: 1,
      status: 'success',
      value: NaN,
      stdout: '',
      stderr: '',
      duration: 1
    }
  });
  expect((await pending).status).toBe('success');
  const next = runner.run({ ...request, id: 2 }, 100);
  await jest.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(1);
  reply({
    kind: 'execution',
    id: workers[0].messages.at(-1)!.id,
    result: {
      id: 2,
      status: 'success',
      value: 25,
      stdout: '',
      stderr: '',
      duration: 1
    }
  });
  await next;
  expect(request.files[0].data.byteLength).toBe(1);
  runner.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

it('terminates timed-out and cancelled generations', async () => {
  jest.useFakeTimers();
  const { runner, workers, request, ready } = setup();
  const first = runner.run(request, 10);
  const rejected = expect(first).rejects.toThrow('timed out');
  ready();
  await jest.advanceTimersByTimeAsync(11);
  await rejected;
  expect(workers[0].terminated).toBe(true);
  const next = runner.run({ ...request, id: 2 }, 10);
  const stopped = expect(next).rejects.toThrow();
  ready();
  runner.reset();
  await stopped;
  expect(workers[1].terminated).toBe(true);
  expect(workers[1].messages).toHaveLength(1);
  runner.dispose();
});
