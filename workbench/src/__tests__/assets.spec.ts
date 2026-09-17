import { createHash, webcrypto } from 'node:crypto';
import * as streams from 'node:stream/web';

import { assets } from '../compiler/assets';
import type { Progress } from '../compiler/types';

const base = 'https://example.test/nested/compiler/';
const data = Uint8Array.of(1, 2, 3, 4);
const wasm = Uint8Array.of(5, 6, 7, 8);
// Supply the worker APIs absent from Jupyter's DOM test environment.
Object.assign(globalThis, {
  ReadableStream: streams.ReadableStream,
  TransformStream: streams.TransformStream
});
Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle });
const files = Object.fromEntries(
  (
    [
      ['Compiler.data', data],
      ['Compiler.wasm', wasm]
    ] as const
  ).map(([name, bytes]) => [
    name,
    {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
  ])
);

afterEach(() => jest.restoreAllMocks());

it('reports and verifies streamed asset bytes', async () => {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const wasmStream = new TransformStream<Uint8Array, Uint8Array>();
  const wasmWriter = wasmStream.writable.getWriter();
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async url => {
      return new Response(
        String(url).endsWith('.data') ? stream.readable : wasmStream.readable
      );
    });
  const progress: Progress[] = [];
  const pending = assets(base, files, value => progress.push(value));
  await writer.write(data.slice(0, 2));
  expect(progress).toContainEqual({
    phase: 'downloading',
    downloads: [
      { name: 'Compiler.data', loaded: 0, total: 4 },
      { name: 'Compiler.wasm', loaded: 0, total: 4 }
    ]
  });
  expect(
    progress.some(
      value => value.phase === 'downloading' && value.downloads[0].loaded === 2
    )
  ).toBe(true);
  expect(progress).not.toContainEqual({ phase: 'preparing' });
  await writer.write(data.slice(2));
  await writer.close();
  await wasmWriter.write(wasm);
  await wasmWriter.close();
  await expect(pending).resolves.toEqual({
    data: data.buffer,
    wasm: wasm.buffer
  });
  expect(progress.at(-2)).toEqual({
    phase: 'downloading',
    downloads: [
      { name: 'Compiler.data', loaded: 4, total: 4 },
      { name: 'Compiler.wasm', loaded: 4, total: 4 }
    ]
  });
  expect(progress.at(-1)).toEqual({ phase: 'preparing' });
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    `${base}Compiler.data`,
    `${base}Compiler.wasm`
  ]);
});

it.each([
  [Uint8Array.of(1, 2), 'file size'],
  [Uint8Array.of(1, 2, 3, 4, 5), 'exceeds'],
  [Uint8Array.of(4, 3, 2, 1), 'integrity']
])(
  'rejects truncated, oversized, or corrupt bytes: %p',
  async (bytes, error) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      return new Response(String(url).endsWith('.data') ? bytes : wasm);
    });
    await expect(assets(base, files, jest.fn())).rejects.toThrow(
      new RegExp(`Compiler.data.*${error}`)
    );
  }
);

it('aborts the sibling download when an asset fails', async () => {
  let aborted = false;
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).endsWith('.data')) {
      return new Response('Missing', { status: 404 });
    }
    return new Promise((_, reject) => {
      options?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    });
  });
  await expect(assets(base, files, jest.fn())).rejects.toThrow(
    'Compiler.data could not load: Error: HTTP 404'
  );
  expect(aborted).toBe(true);
});

it('rejects interrupted streams without reporting preparation', async () => {
  const progress = jest.fn();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('connection lost'));
        }
      })
    );
  });
  await expect(assets(base, files, progress)).rejects.toThrow(
    'connection lost'
  );
  expect(progress).not.toHaveBeenCalledWith({ phase: 'preparing' });
});

it.each([0, -1, 1.5, NaN, Infinity])(
  'rejects an invalid manifest size before downloading: %p',
  async bytes => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    await expect(
      assets(
        base,
        { ...files, 'Compiler.data': { ...files['Compiler.data'], bytes } },
        jest.fn()
      )
    ).rejects.toThrow('manifest does not describe Compiler.data');
    expect(fetch).not.toHaveBeenCalled();
  }
);
