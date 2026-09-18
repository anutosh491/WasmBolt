import { restore } from './files';
import { initialize } from './module';
import type { IModuleRuntime } from './module';
import { createPipelineTools } from './pipeline';
import type { IPipelineTools } from './pipeline';
import { isInput } from './protocol';
import type { Output } from './protocol';
import type { Progress } from './types';
import { runtime } from './runtime';
import { inspectWasm } from './wasm';

let module: IModuleRuntime | null = null;
let pipeline: IPipelineTools | null = null;
let program: string | null = null;
let pending: Promise<void> = Promise.resolve();

function reply(output: Output): void {
  // These snapshots were allocated for this reply. Transfer each buffer once.
  const buffers = new Set<ArrayBuffer>();
  if (output.kind === 'result' || output.kind === 'command') {
    for (const file of output.result.files) {
      if (file.data.buffer instanceof ArrayBuffer) {
        buffers.add(file.data.buffer);
      }
    }
  }
  self.postMessage(output, { transfer: [...buffers] });
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const input = event.data;
  if (!isInput(input)) {
    throw new Error('Invalid compiler request.');
  }
  pending = pending.then(async () => {
    const progress = (progress: Progress) => {
      reply({ kind: 'progress', id: input.id, progress });
    };
    try {
      if (input.kind === 'initialize') {
        module = await initialize(input.base, progress);
        pipeline?.dispose();
        pipeline = createPipelineTools(
          new URL(input.base),
          module.isolatedTools
        );
        program = null;
        reply({ kind: 'ready', id: input.id, info: module.info });
        return;
      }
      if (!module || !pipeline) {
        throw new Error('The compiler is not initialized.');
      }
      if (input.kind === 'execute') {
        const request = input.request;
        const file = request.files.find(file => file.path === request.module);
        const fn =
          file &&
          inspectWasm(file.data).functions.find(
            fn => fn.name === request.symbol
          );
        if (
          !fn ||
          !fn.callable ||
          fn.params.length !== request.signature.params.length ||
          fn.results.length !== request.signature.results.length ||
          fn.params.some(
            (type, index) => type !== request.signature.params[index]
          ) ||
          fn.results.some(
            (type, index) => type !== request.signature.results[index]
          )
        ) {
          throw new Error(
            'The requested call does not match an exported signature.'
          );
        }
        if (program !== request.module) {
          restore(module.fs, request.files);
          program = request.module;
        }
        const start = performance.now();
        const captured = module.call(
          request.module,
          request.symbol,
          request.signature,
          request.args
        );
        const value = captured.value;
        reply({
          kind: 'execution',
          id: input.id,
          result: {
            id: request.id,
            stdout: captured.stdout,
            stderr: captured.stderr,
            duration: performance.now() - start,
            ...(value.status === 'failed'
              ? value
              : {
                  status: 'success',
                  value:
                    request.signature.results.length === 0 ? null : value.value
                })
          }
        });
      } else if (input.kind === 'compile') {
        const result = await runtime(module, pipeline).compile(
          input.request,
          progress
        );
        reply({ kind: 'result', id: input.id, result });
      } else {
        const result = await runtime(module, pipeline).command(
          input.request,
          progress
        );
        reply({ kind: 'command', id: input.id, result });
      }
    } catch (error) {
      pipeline?.dispose();
      pipeline = null;
      module = null;
      reply({
        kind: 'error',
        id: input.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
});
