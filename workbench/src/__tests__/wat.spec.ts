import { renderWat } from '../compiler/wat-runtime';
import { createWatRenderer, isWatInput, isWatOutput } from '../compiler/wat';
import type { IWatWorker, WatInput, WatOutput } from '../compiler/wat';

class WatWorker implements IWatWorker {
  onmessage: IWatWorker['onmessage'] = null;
  onerror: IWatWorker['onerror'] = null;
  onmessageerror: IWatWorker['onmessageerror'] = null;
  messages: WatInput[] = [];
  transfers: Transferable[][] = [];
  terminated = false;

  postMessage(input: WatInput, transfer: Transferable[] = []): void {
    this.messages.push(input);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(output: WatOutput): void {
    this.onmessage?.(new MessageEvent('message', { data: output }));
  }
}

function setup() {
  const workers: WatWorker[] = [];
  const renderer = createWatRenderer(
    new URL('https://example.test/wat-worker.js'),
    () => {
      const worker = new WatWorker();
      workers.push(worker);
      return worker;
    }
  );
  return { renderer, workers };
}

it('renders in a disposable worker and preserves stored bytes', async () => {
  const { renderer, workers } = setup();
  const data = Uint8Array.of(0, 97, 115, 109);
  const pending = renderer.render(data);
  const input = workers[0].messages[0];

  expect(input.data).not.toBe(data);
  expect(Array.from(input.data)).toEqual(Array.from(data));
  expect(workers[0].transfers).toEqual([[input.data.buffer]]);
  workers[0].reply({ kind: 'result', id: input.id, text: '(module)' });

  await expect(pending).resolves.toBe('(module)');
  expect(data).toEqual(Uint8Array.of(0, 97, 115, 109));
  expect(workers[0].terminated).toBe(true);
  renderer.dispose();
});

it('terminates invalid, cancelled, and disposed requests', async () => {
  const { renderer, workers } = setup();
  const invalid = renderer.render(Uint8Array.of(1));
  const invalidId = workers[0].messages[0].id;
  workers[0].reply({ kind: 'result', id: invalidId + 1, text: '' });
  await expect(invalid).rejects.toThrow('invalid response');
  expect(workers[0].terminated).toBe(true);

  const failed = renderer.render(Uint8Array.of(0));
  const failedId = workers[1].messages[0].id;
  workers[1].reply({
    kind: 'error',
    id: failedId,
    message: 'invalid WebAssembly'
  });
  await expect(failed).rejects.toThrow('invalid WebAssembly');
  expect(workers[1].terminated).toBe(true);

  const controller = new AbortController();
  const cancelled = renderer.render(Uint8Array.of(2), controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  expect(workers[2].terminated).toBe(true);

  const disposed = renderer.render(Uint8Array.of(3));
  renderer.dispose();
  await expect(disposed).rejects.toThrow('disposed');
  expect(workers[3].terminated).toBe(true);
  await expect(renderer.render(Uint8Array.of(4))).rejects.toThrow('disposed');
});

it('validates the worker protocol', () => {
  expect(isWatInput({ kind: 'wat', id: 1, data: Uint8Array.of(0) })).toBe(true);
  expect(isWatInput({ kind: 'wat', id: 1, data: [0] })).toBe(false);
  expect(isWatOutput({ kind: 'result', id: 1, text: '(module)' })).toBe(true);
  expect(isWatOutput({ kind: 'error', id: 1, message: 'bad' })).toBe(true);
  expect(isWatOutput({ kind: 'result', id: 1, message: 'bad' })).toBe(false);
});

it('prints a genuine Emscripten side module as WebAssembly text', async () => {
  const data = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0, 0, 15, 8, 100, 121, 108, 105, 110, 107, 46, 48,
    1, 4, 0, 0, 0, 0, 1, 10, 2, 96, 0, 0, 96, 2, 127, 127, 1, 127, 3, 3, 2, 0,
    1, 7, 27, 2, 17, 95, 95, 119, 97, 115, 109, 95, 99, 97, 108, 108, 95, 99,
    116, 111, 114, 115, 0, 0, 3, 97, 100, 100, 0, 1, 10, 12, 2, 2, 0, 11, 7, 0,
    32, 0, 32, 1, 106, 11
  ]);
  const original = data.slice();
  const wat = await renderWat(data);

  expect(wat).toContain('(module');
  expect(wat).toContain('(export "add"');
  expect(wat).toContain('local.get');
  expect(wat).toContain('i32.add');
  expect(wat).not.toContain('file format wasm');
  expect(data).toEqual(original);
});

it('rejects malformed WebAssembly', async () => {
  await expect(renderWat(Uint8Array.of(1))).rejects.toThrow();
});
