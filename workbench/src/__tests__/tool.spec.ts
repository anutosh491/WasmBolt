import { createIsolatedTool } from '../compiler/tool';
import type { IToolWorker } from '../compiler/tool';
import type {
  ToolInput,
  ToolOutput,
  ToolRequest
} from '../compiler/tool-protocol';
import {
  commandArgv,
  isToolInput,
  isToolOutput,
  requestCommand
} from '../compiler/tool-protocol';

class Worker implements IToolWorker {
  onmessage: IToolWorker['onmessage'] = null;
  onerror: IToolWorker['onerror'] = null;
  onmessageerror: IToolWorker['onmessageerror'] = null;
  messages: ToolInput[] = [];
  terminated = false;

  postMessage(input: ToolInput): void {
    this.messages.push(input);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(output: ToolOutput): void {
    this.onmessage?.(new MessageEvent('message', { data: output }));
  }
}

const runtime = {
  name: 'mlir-opt',
  loader: 'MlirOpt.js',
  wasm: 'MlirOpt.wasm'
};
const file = {
  path: '/workspace/input.mlir',
  data: Uint8Array.of(1, 2, 3)
};

function request(id: number): ToolRequest {
  return {
    id,
    argv: [
      'mlir-opt',
      '--pass-pipeline=builtin.module(canonicalize,cse)',
      '/workspace/input.mlir',
      '-o',
      '/workspace/output.mlir'
    ],
    files: [file]
  };
}

function result(id: number): Extract<ToolOutput, { kind: 'result' }> {
  return {
    kind: 'result',
    id,
    result: {
      id,
      files: [file],
      stage: {
        name: runtime.name,
        status: 'success',
        commands: [requestCommand(request(id))],
        diagnostics: [],
        stdout: 'module {}',
        stderr: '',
        exitCode: 0,
        duration: 1
      }
    }
  };
}

function setup() {
  const workers: Worker[] = [];
  const tool = createIsolatedTool(
    new URL('https://example.test/compiler/tool-worker.js'),
    new URL('https://example.test/compiler/mlir/'),
    runtime,
    () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    }
  );
  return { tool, workers };
}

it('passes arbitrary tool arguments without knowing their options', () => {
  expect(
    commandArgv(
      "mlir-translate --mlir-to-llvmir 'input module.mlir' -o output.ll"
    )
  ).toEqual([
    'mlir-translate',
    '--mlir-to-llvmir',
    'input module.mlir',
    '-o',
    'output.ll'
  ]);
  expect(
    commandArgv('opt "-passes=default<O2>" input.ll -o output.ll')
  ).toEqual(['opt', '-passes=default<O2>', 'input.ll', '-o', 'output.ll']);
  expect(() => commandArgv('opt input.ll | less')).toThrow('shell syntax');
});

it('creates and terminates a fresh runtime for every invocation', async () => {
  const { tool, workers } = setup();
  const first = tool.run(request(1));
  expect(workers[0].messages[0]).toEqual({
    kind: 'run',
    id: 1,
    base: 'https://example.test/compiler/mlir/',
    runtime,
    request: request(1)
  });
  workers[0].reply(result(1));
  await expect(first).resolves.toEqual(result(1).result);
  expect(workers[0].terminated).toBe(true);

  const second = tool.run({
    id: 2,
    command: 'mlir-opt --help',
    files: []
  });
  expect(workers).toHaveLength(2);
  workers[1].reply({ ...result(2), result: { ...result(2).result, id: 2 } });
  await expect(second).resolves.toMatchObject({ id: 2 });
  expect(workers[1].terminated).toBe(true);
  tool.dispose();
});

it('validates requests, progress and response ownership', async () => {
  const input = {
    kind: 'run',
    id: 4,
    base: 'https://example.test/compiler/mlir/',
    runtime,
    request: request(4)
  };
  expect(isToolInput(input)).toBe(true);
  expect(
    isToolInput({ ...input, runtime: { ...runtime, wasm: '../x.wasm' } })
  ).toBe(false);
  expect(isToolInput({ ...input, request: { ...request(4), argv: [] } })).toBe(
    false
  );
  expect(isToolOutput(result(4))).toBe(true);

  const { tool, workers } = setup();
  const progress = jest.fn();
  const pending = tool.run(request(1), progress);
  workers[0].reply({
    kind: 'progress',
    id: 1,
    progress: { phase: 'working', stage: runtime.name }
  });
  expect(progress).toHaveBeenCalledWith({
    phase: 'working',
    stage: runtime.name
  });
  workers[0].reply({ kind: 'error', id: 1, message: 'runtime failed' });
  await expect(pending).rejects.toThrow('runtime failed');
  expect(workers[0].terminated).toBe(true);
});

it('cancels a poisoned runtime without affecting the next one', async () => {
  const { tool, workers } = setup();
  const first = tool.run(request(1));
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  tool.cancel();
  await rejected;
  expect(workers[0].terminated).toBe(true);

  const second = tool.run(request(2));
  workers[1].reply(result(2));
  await expect(second).resolves.toMatchObject({ id: 2 });
  tool.dispose();
  await expect(tool.run(request(3))).rejects.toThrow('disposed');
});
