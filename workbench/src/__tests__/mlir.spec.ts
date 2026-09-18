import type { IToolWorker } from '../compiler/tool';
import type { ToolInput, ToolOutput } from '../compiler/tool-protocol';
import { requestCommand } from '../compiler/tool-protocol';
import type { File, Stage } from '../compiler/types';
import { createMlirCompiler } from '../mlir/service';
import { options } from '../model';

const decoder = new TextDecoder();

function bytes(text: string): Uint8Array {
  return Uint8Array.from([...text].map(character => character.charCodeAt(0)));
}

class Worker implements IToolWorker {
  onmessage: IToolWorker['onmessage'] = null;
  onerror: IToolWorker['onerror'] = null;
  onmessageerror: IToolWorker['onmessageerror'] = null;
  readonly messages: ToolInput[] = [];
  terminated = false;

  constructor(private readonly respond: (input: ToolInput) => ToolOutput) {}

  postMessage(input: ToolInput): void {
    this.messages.push(input);
    queueMicrotask(() => {
      const output = this.respond(input);
      this.onmessage?.(new MessageEvent('message', { data: output }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function stage(input: ToolInput, exitCode = 0): Stage {
  return {
    name: input.runtime.name,
    status: exitCode === 0 ? 'success' : 'failed',
    commands: [requestCommand(input.request)],
    diagnostics: [],
    stdout: '',
    stderr: exitCode === 0 ? '' : 'mlir-opt: pipeline failed',
    exitCode,
    duration: 1
  };
}

function replace(files: readonly File[], file: File): readonly File[] {
  return [...files.filter(candidate => candidate.path !== file.path), file];
}

function reply(input: ToolInput): ToolOutput {
  const argv = input.request.argv ?? [];
  const inputFiles = input.request.files.map(file => ({
    path: file.path,
    data: Uint8Array.from(file.data)
  }));
  if (input.runtime.name === 'mlir-opt') {
    const failed = argv.some(argument => argument.includes('fail'));
    const files = failed
      ? inputFiles
      : replace(inputFiles, {
          path: '/workspace/optimized.mlir',
          data: bytes('module { llvm.func @add() }\n')
        });
    return {
      kind: 'result',
      id: input.id,
      result: {
        id: input.request.id,
        files,
        stage: stage(input, failed ? 1 : 0)
      }
    };
  }
  const lowered = inputFiles.find(
    file => file.path === '/workspace/optimized.mlir'
  );
  if (!lowered || !decoder.decode(lowered.data).includes('llvm.func')) {
    return { kind: 'error', id: input.id, message: 'missing lowered MLIR' };
  }
  return {
    kind: 'result',
    id: input.id,
    result: {
      id: input.request.id,
      files: replace(inputFiles, {
        path: '/workspace/source.ll',
        data: bytes('define void @add() { ret void }\n')
      }),
      stage: stage(input)
    }
  };
}

function setup() {
  const workers: Worker[] = [];
  const compiler = createMlirCompiler(
    new URL('https://example.test/compiler/tool-worker.js'),
    new URL('https://example.test/compiler/'),
    () => {
      const worker = new Worker(reply);
      workers.push(worker);
      return worker;
    }
  );
  return { compiler, workers };
}

beforeEach(() => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      format: 1,
      mlirOrigin: 'source',
      llvmServices: {
        revision: '1c1edc2d34e181ac8cdd5aa81e218464e1e2a642',
        emscripten: '4.0.9'
      },
      files: {
        'mlir/mlir-opt.js': {},
        'mlir/mlir-opt.wasm': {},
        'mlir/mlir-translate.js': {},
        'mlir/mlir-translate.wasm': {}
      }
    })
  } as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('runs only the real mlir-opt CLI for the MLIR representation', async () => {
  const { compiler, workers } = setup();
  const result = await compiler.compile({
    id: 7,
    source: 'module {}',
    sourcePath: '/workspace/input.mlir',
    files: [],
    options: { ...options, language: 'mlir' },
    output: 'mlir'
  });

  expect(workers).toHaveLength(1);
  expect(workers[0].messages[0].request).toMatchObject({
    id: 7,
    argv: [
      'mlir-opt',
      `--pass-pipeline=${options.mlirPipeline}`,
      '/workspace/input.mlir',
      '-o',
      '/workspace/optimized.mlir'
    ]
  });
  expect(workers[0].messages[0].request.files).toHaveLength(1);
  expect(workers[0].messages[0].request.files[0].path).toBe(
    '/workspace/input.mlir'
  );
  expect(Array.from(workers[0].messages[0].request.files[0].data)).toEqual(
    Array.from(bytes('module {}'))
  );
  expect(result.stages.map(item => item.name)).toEqual(['mlir']);
  expect(result.artifacts.map(item => item.kind)).toEqual(['mlir']);
  expect(workers[0].terminated).toBe(true);
  compiler.dispose();
});

it('hands the complete opt workspace to a fresh mlir-translate CLI', async () => {
  const { compiler, workers } = setup();
  const compile = (id: number) =>
    compiler.compile({
      id,
      source: 'module {}',
      sourcePath: '/workspace/input.mlir',
      files: [],
      options: { ...options, language: 'mlir' },
      output: 'ir'
    });

  const first = await compile(8);
  expect(workers).toHaveLength(2);
  expect(workers[1].messages[0].request).toMatchObject({
    id: 8,
    argv: [
      'mlir-translate',
      '--mlir-to-llvmir',
      '/workspace/optimized.mlir',
      '-o',
      '/workspace/source.ll'
    ]
  });
  expect(
    workers[1].messages[0].request.files.some(
      file => file.path === '/workspace/optimized.mlir'
    )
  ).toBe(true);
  expect(
    first.artifacts.find(artifact => artifact.kind === 'ir')
  ).toMatchObject({
    format: 'text',
    text: expect.stringContaining('define void @add')
  });

  await compile(9);
  expect(workers).toHaveLength(4);
  expect(workers.every(worker => worker.terminated)).toBe(true);
  compiler.dispose();
});

it('does not translate when the genuine mlir-opt invocation fails', async () => {
  const { compiler, workers } = setup();
  const result = await compiler.compile({
    id: 10,
    source: 'module {}',
    sourcePath: '/workspace/input.mlir',
    files: [],
    options: { ...options, language: 'mlir', mlirPipeline: 'fail' },
    output: 'ir'
  });

  expect(workers).toHaveLength(1);
  expect(result.exitCode).toBe(1);
  expect(result.stages).toHaveLength(1);
  expect(result.artifacts).toEqual([]);
  compiler.dispose();
});
