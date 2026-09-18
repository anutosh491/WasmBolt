import { diagnostics, uniqueDiagnostics } from './diagnostics';
import { files, restore } from './files';
import type { IModuleRuntime } from './module';
import type { IPipelineTools } from './pipeline';
import { invocation, serialize } from './request';
import type { Step } from './request';
import { command } from './terminal';
import type {
  Artifact,
  CommandRequest,
  CommandResult,
  Info,
  OutputKind,
  Progress,
  Request,
  Result,
  Stage
} from './types';
import { outputLabels } from './types';

export interface IRuntime {
  readonly info: Info;
  compile(
    request: Request,
    onProgress: (progress: Progress) => void
  ): Promise<Result>;
  command(
    request: CommandRequest,
    onProgress: (progress: Progress) => void
  ): Promise<CommandResult>;
}

/** Execute a pure build plan against an instance-owned virtual filesystem. */
export function runtime(
  module: IModuleRuntime,
  pipeline: IPipelineTools
): IRuntime {
  const { info, fs } = module;
  return {
    info,
    async compile(request, onProgress) {
      if (!info.targets.includes(request.options.target)) {
        throw new Error('This compiler does not include the selected target.');
      }
      const start = performance.now();
      const plan = invocation(request, info, '/workspace');
      restore(fs, request.files);
      fs.writeFile(plan.source, request.source);
      const stages: Stage[] = [];
      const paths = new Map<string, OutputKind>();
      for (const step of plan.steps) {
        if (
          step.requires.some(
            name =>
              !stages.some(
                stage => stage.name === name && stage.status === 'success'
              )
          )
        ) {
          stages.push({
            name: step.name,
            status: 'skipped',
            commands: [],
            diagnostics: [],
            stdout: '',
            stderr: 'A required stage failed.',
            exitCode: 1,
            duration: 0
          });
          continue;
        }
        onProgress({
          phase: 'working',
          stage:
            step.name === 'wasm'
              ? 'Linking Wasm module'
              : outputLabels[step.name]
        });
        const stage = await execute(
          request.id,
          module,
          pipeline,
          step,
          onProgress
        );
        stages.push(stage);
        if (step.graphs) {
          for (const file of files(fs)) {
            if (/\.(dot|svg)$/.test(file.path)) {
              paths.set(file.path, 'graphs');
            }
          }
        } else {
          paths.set(step.path, step.name);
        }
      }
      const workspace = files(fs);
      const artifacts = workspace.flatMap((file): Artifact[] => {
        const kind = paths.get(file.path);
        if (!kind) {
          return [];
        }
        const base = { build: request.id, kind, path: file.path };
        return [
          kind === 'wasm' || kind === 'object'
            ? { ...base, format: 'binary', data: file.data }
            : {
                ...base,
                format: 'text',
                text: new TextDecoder().decode(file.data)
              }
        ];
      });
      return {
        id: request.id,
        sourcePath: plan.source,
        artifacts,
        files: workspace,
        stages,
        diagnostics: uniqueDiagnostics(
          stages.flatMap(stage => stage.diagnostics)
        ),
        commands: stages.flatMap(stage => stage.commands),
        stdout: stages
          .map(stage => stage.stdout)
          .filter(Boolean)
          .join('\n'),
        stderr: stages
          .map(stage => stage.stderr)
          .filter(Boolean)
          .join('\n'),
        exitCode: stages.some(stage => stage.status === 'failed') ? 1 : 0,
        duration: performance.now() - start
      };
    },
    async command(request, onProgress) {
      restore(fs, request.files);
      const parsed = command(request.command);
      onProgress({ phase: 'working', stage: parsed.tool });
      const start = performance.now();
      if (
        parsed.tool === 'wasm-ld' &&
        parsed.args.some(arg => arg.startsWith('/lib/wasm32-emscripten/'))
      ) {
        await module.prepareDebugSysroot(onProgress);
      }
      const isolated = await pipeline.run(
        request.id,
        parsed.args,
        files(fs),
        onProgress
      );
      if (isolated) {
        restore(fs, isolated.files);
      }
      const captured = isolated
        ? {
            value: isolated.stage.exitCode,
            stdout: isolated.stage.stdout,
            stderr: isolated.stage.stderr
          }
        : module.run(parsed.args);
      if (parsed.stdout) {
        fs.writeFile(parsed.stdout, captured.stdout);
      }
      if (parsed.stderr) {
        fs.writeFile(parsed.stderr, captured.stderr);
      }
      return {
        id: request.id,
        files: files(fs),
        stage: {
          name: parsed.tool,
          status: captured.value === 0 ? 'success' : 'failed',
          commands: [request.command],
          stdout: captured.stdout,
          stderr: captured.stderr,
          diagnostics: diagnostics(captured.stderr),
          exitCode: captured.value,
          duration: performance.now() - start
        }
      };
    }
  };
}

async function execute(
  id: number,
  module: IModuleRuntime,
  pipeline: IPipelineTools,
  step: Step,
  onProgress: (progress: Progress) => void
): Promise<Stage> {
  const start = performance.now();
  const commands: string[] = [];
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  const run = async (args: readonly string[]) => {
    const command = serialize(args);
    commands.push(command);
    const isolated = await pipeline.run(id, args, files(module.fs), onProgress);
    if (isolated) {
      restore(module.fs, isolated.files);
    }
    const captured = isolated
      ? {
          value: isolated.stage.exitCode,
          stdout: isolated.stage.stdout,
          stderr: isolated.stage.stderr
        }
      : module.run(args);
    stdout += captured.stdout;
    stderr += captured.stderr;
    if (captured.value !== 0) {
      exitCode = captured.value;
    }
  };
  for (const args of step.commands) {
    await run(args);
    if (exitCode !== 0) {
      break;
    }
  }
  if (step.capture && (stdout || stderr || exitCode === 0)) {
    const text =
      step.capture === 'stdout'
        ? stdout
        : step.capture === 'stderr'
          ? stderr
          : stdout + stderr;
    module.fs.writeFile(step.path, text);
  }
  if (step.graphs && exitCode === 0) {
    for (const file of files(module.fs)) {
      if (file.path.endsWith('.dot')) {
        onProgress({
          phase: 'working',
          stage: `Rendering ${file.path.slice('/workspace/'.length)}`
        });
        await run(['dot', '-Tsvg', file.path, '-o', file.path + '.svg']);
      }
    }
  }
  return {
    name: step.name,
    status: exitCode === 0 ? 'success' : 'failed',
    commands,
    stdout,
    stderr,
    diagnostics: diagnostics(stderr),
    exitCode,
    duration: performance.now() - start
  };
}
