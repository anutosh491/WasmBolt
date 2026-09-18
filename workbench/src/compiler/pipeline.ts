import { createIsolatedTool } from './tool';
import type { IIsolatedTool, IToolWorker } from './tool';
import type { CommandResult, File, Progress } from './types';

const runtimes = {
  opt: {
    name: 'opt',
    loader: 'opt/opt.js',
    wasm: 'opt/opt.wasm'
  },
  llc: {
    name: 'llc',
    loader: 'llc/llc.js',
    wasm: 'llc/llc.wasm'
  },
  'mlir-opt': {
    name: 'mlir-opt',
    loader: 'mlir/mlir-opt.js',
    wasm: 'mlir/mlir-opt.wasm'
  },
  'mlir-translate': {
    name: 'mlir-translate',
    loader: 'mlir/mlir-translate.js',
    wasm: 'mlir/mlir-translate.wasm'
  }
} as const;

export type PipelineTool = keyof typeof runtimes;

export interface IPipelineTools {
  run(
    id: number,
    argv: readonly string[],
    files: readonly File[],
    onProgress?: (progress: Progress) => void
  ): Promise<CommandResult | null>;
  cancel(): void;
  dispose(): void;
}

/**
 * Keep LLVM's process-global command-line registries out of the compiler
 * instance. Every opt or llc invocation receives a fresh Worker and runtime.
 */
export function createPipelineTools(
  assetBase: URL,
  available: readonly PipelineTool[],
  create: () => IToolWorker = () =>
    new Worker(new URL('tool-worker.js', assetBase), { type: 'module' })
): IPipelineTools {
  const workerUrl = new URL('tool-worker.js', assetBase);
  const enabled = new Set(available);
  const tools: Readonly<Record<keyof typeof runtimes, IIsolatedTool>> = {
    opt: createIsolatedTool(workerUrl, assetBase, runtimes.opt, create),
    llc: createIsolatedTool(workerUrl, assetBase, runtimes.llc, create),
    'mlir-opt': createIsolatedTool(
      workerUrl,
      assetBase,
      runtimes['mlir-opt'],
      create
    ),
    'mlir-translate': createIsolatedTool(
      workerUrl,
      assetBase,
      runtimes['mlir-translate'],
      create
    )
  };

  return {
    run(id, argv, files, onProgress) {
      const name = argv[0];
      const tool = Object.hasOwn(tools, name)
        ? tools[name as keyof typeof tools]
        : null;
      if (!tool) {
        return Promise.resolve(null);
      }
      if (!enabled.has(name as PipelineTool)) {
        const message =
          `${name} is not available in this compiler build; ` +
          'install its genuine Emscripten driver assets.';
        return Promise.resolve({
          id,
          files,
          stage: {
            name,
            status: 'failed',
            commands: [],
            diagnostics: [],
            stdout: '',
            stderr: message,
            exitCode: 127,
            duration: 0
          }
        });
      }
      return tool.run({ id, argv, files }, onProgress);
    },
    cancel() {
      tools.opt.cancel();
      tools.llc.cancel();
      tools['mlir-opt'].cancel();
      tools['mlir-translate'].cancel();
    },
    dispose() {
      tools.opt.dispose();
      tools.llc.dispose();
      tools['mlir-opt'].dispose();
      tools['mlir-translate'].dispose();
    }
  };
}
