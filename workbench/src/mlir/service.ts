import { diagnostics, uniqueDiagnostics } from '../compiler/diagnostics';
import { isRecord } from '../compiler/protocol';
import { createIsolatedTool } from '../compiler/tool';
import type { IIsolatedTool, IToolWorker } from '../compiler/tool';
import { commandArgv } from '../compiler/tool-protocol';
import type { ToolRequest, ToolRuntime } from '../compiler/tool-protocol';
import type {
  Artifact,
  CommandResult,
  File,
  ICompiler,
  Info,
  OutputKind,
  Progress,
  Stage
} from '../compiler/types';

const optRuntime: ToolRuntime = {
  name: 'mlir-opt',
  loader: 'mlir/mlir-opt.js',
  wasm: 'mlir/mlir-opt.wasm'
};

const translateRuntime: ToolRuntime = {
  name: 'mlir-translate',
  loader: 'mlir/mlir-translate.js',
  wasm: 'mlir/mlir-translate.wasm'
};

/** MLIR's real CLIs run in fresh process-equivalent Workers. */
export function createMlirCompiler(
  workerUrl: URL,
  assetBase: URL,
  create: () => IToolWorker = () => new Worker(workerUrl, { type: 'module' })
): ICompiler {
  const opt = createIsolatedTool(workerUrl, assetBase, optRuntime, create);
  const translate = createIsolatedTool(
    workerUrl,
    assetBase,
    translateRuntime,
    create
  );
  let ready: Promise<Info> | null = null;
  let disposed = false;

  function initialize(): Promise<Info> {
    if (disposed) {
      return Promise.reject(new Error('The MLIR tools are disposed.'));
    }
    ready ??= fetch(new URL('manifest.json', assetBase))
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Tool manifest could not load (${response.status}).`);
        }
        const manifest: unknown = await response.json();
        if (
          !isRecord(manifest) ||
          manifest.format !== 1 ||
          manifest.mlirOrigin !== 'source' ||
          !isRecord(manifest.files) ||
          !isRecord(manifest.llvmServices) ||
          typeof manifest.llvmServices.revision !== 'string' ||
          typeof manifest.llvmServices.emscripten !== 'string'
        ) {
          throw new Error('The manifest does not describe the MLIR tools.');
        }
        const manifestFiles = manifest.files;
        if (
          ![
            optRuntime.loader,
            optRuntime.wasm,
            translateRuntime.loader,
            translateRuntime.wasm
          ].every(name => isRecord(manifestFiles[name]))
        ) {
          throw new Error('The manifest does not describe the MLIR tools.');
        }
        const revision = manifest.llvmServices.revision.slice(0, 12);
        return {
          version: `MLIR main (${revision})`,
          resourceDirectory: '',
          targets: ['wasm32-unknown-emscripten']
        } as Info;
      })
      .catch(error => {
        ready = null;
        throw error;
      });
    return ready;
  }

  async function run(
    tool: IIsolatedTool,
    request: ToolRequest,
    onProgress?: (progress: Progress) => void
  ): Promise<CommandResult> {
    await initialize();
    return tool.run(request, onProgress);
  }

  return {
    initialize,
    async compile(request, onProgress) {
      if (request.options.language !== 'mlir') {
        throw new Error('The MLIR worker only accepts MLIR source.');
      }
      const start = performance.now();
      const sourcePath = request.sourcePath;
      const loweredPath = '/workspace/optimized.mlir';
      const llvmPath = '/workspace/source.ll';
      let workspace: readonly File[] = [
        ...request.files.filter(file => file.path !== sourcePath),
        { path: sourcePath, data: new TextEncoder().encode(request.source) }
      ];
      const stages: Stage[] = [];

      const optimized = await run(
        opt,
        {
          id: request.id,
          argv: [
            'mlir-opt',
            `--pass-pipeline=${request.options.mlirPipeline}`,
            sourcePath,
            '-o',
            loweredPath
          ],
          files: workspace
        },
        onProgress
      );
      workspace = optimized.files;
      stages.push({ ...optimized.stage, name: 'mlir' });

      const output = request.output ?? 'ir';
      if (optimized.stage.exitCode === 0 && output === 'ir') {
        const translated = await run(
          translate,
          {
            id: request.id,
            argv: [
              'mlir-translate',
              '--mlir-to-llvmir',
              loweredPath,
              '-o',
              llvmPath
            ],
            files: workspace
          },
          onProgress
        );
        workspace = translated.files;
        stages.push({ ...translated.stage, name: 'ir' });
      }

      const paths: Partial<Record<OutputKind, string>> = {
        mlir: loweredPath,
        ir: llvmPath
      };
      const wanted: readonly OutputKind[] =
        output === 'ir' ? ['mlir', 'ir'] : ['mlir'];
      const artifacts = wanted.flatMap(kind => {
        const path = paths[kind];
        const file =
          path && workspace.find(candidate => candidate.path === path);
        if (!path || !file) {
          return [];
        }
        return [
          {
            build: request.id,
            kind,
            path,
            format: 'text' as const,
            text: new TextDecoder().decode(file.data)
          } satisfies Artifact
        ];
      });
      const stderr = stages
        .map(stage => stage.stderr)
        .filter(Boolean)
        .join('\n');
      return {
        id: request.id,
        sourcePath,
        artifacts,
        stages,
        files: workspace,
        diagnostics: uniqueDiagnostics(
          stages.flatMap(stage => stage.diagnostics)
        ),
        commands: stages.flatMap(stage => stage.commands),
        stdout: stages
          .map(stage => stage.stdout)
          .filter(Boolean)
          .join('\n'),
        stderr,
        exitCode: stages.some(stage => stage.exitCode !== 0) ? 1 : 0,
        duration: performance.now() - start
      };
    },
    async command(request, onProgress) {
      const argv = commandArgv(request.command);
      const tool =
        argv[0] === 'mlir-opt'
          ? opt
          : argv[0] === 'mlir-translate'
            ? translate
            : null;
      if (!tool) {
        throw new Error('Choose mlir-opt or mlir-translate.');
      }
      const result = await run(tool, request, onProgress);
      if (
        result.stage.exitCode !== 0 &&
        result.stage.diagnostics.length === 0
      ) {
        return {
          ...result,
          stage: {
            ...result.stage,
            diagnostics: diagnostics(result.stage.stderr)
          }
        };
      }
      return result;
    },
    cancel() {
      opt.cancel();
      translate.cancel();
    },
    dispose() {
      disposed = true;
      opt.dispose();
      translate.dispose();
    }
  };
}
