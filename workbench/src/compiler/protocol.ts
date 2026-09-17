import type { RunRequest, RunResult } from './execution';
import type {
  CommandRequest,
  CommandResult,
  File,
  Info,
  Progress,
  Request,
  Result,
  Stage
} from './types';
import { isOutputKind, isRequest, isTarget } from './types';

export type Input =
  | Readonly<{ kind: 'initialize'; id: number; base: string }>
  | Readonly<{ kind: 'compile'; id: number; request: Request }>
  | Readonly<{ kind: 'command'; id: number; request: CommandRequest }>
  | Readonly<{ kind: 'execute'; id: number; request: RunRequest }>;

export type Output =
  | Readonly<{ kind: 'progress'; id: number; progress: Progress }>
  | Readonly<{ kind: 'ready'; id: number; info: Info }>
  | Readonly<{ kind: 'result'; id: number; result: Result }>
  | Readonly<{ kind: 'command'; id: number; result: CommandResult }>
  | Readonly<{ kind: 'execution'; id: number; result: RunResult }>
  | Readonly<{ kind: 'error'; id: number; message: string }>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

export function isFiles(value: unknown): value is readonly File[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const paths = new Set<string>();
  return value.every(file => {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      !file.path.startsWith('/workspace/') ||
      file.path
        .split('/')
        .slice(1)
        .some(part => !part || part === '..' || part === '.') ||
      file.path.includes('\0') ||
      !isUint8Array(file.data) ||
      paths.has(file.path)
    ) {
      return false;
    }
    paths.add(file.path);
    return true;
  });
}

export function isInput(value: unknown): value is Input {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) {
    return false;
  }
  if (value.kind === 'initialize') {
    return typeof value.base === 'string';
  }
  if (value.kind === 'compile') {
    return isRequest(value.request);
  }
  const request = value.request;
  if (
    !isRecord(request) ||
    !Number.isSafeInteger(request.id) ||
    !isFiles(request.files)
  ) {
    return false;
  }
  if (value.kind === 'command') {
    return typeof request.command === 'string';
  }
  return (
    value.kind === 'execute' &&
    typeof request.module === 'string' &&
    request.files.some(file => file.path === request.module) &&
    typeof request.symbol === 'string' &&
    request.symbol.length > 0 &&
    !request.symbol.includes('\0') &&
    typeof request.signatureCode === 'number' &&
    Number.isInteger(request.signatureCode) &&
    request.signatureCode >= 0 &&
    request.signatureCode <= 6 &&
    Array.isArray(request.args) &&
    request.args.length === [0, 1, 2, 0, 1, 2, 0][request.signatureCode] &&
    request.args.every(
      arg =>
        typeof arg === 'number' &&
        Number.isFinite(arg) &&
        (Number(request.signatureCode) > 2 ||
          (Number.isInteger(arg) && arg >= -2147483648 && arg <= 2147483647))
    )
  );
}

export function isProgress(value: unknown): value is Progress {
  return (
    isRecord(value) &&
    (value.phase === 'preparing' ||
      (value.phase === 'working' && typeof value.stage === 'string') ||
      (value.phase === 'downloading' &&
        Array.isArray(value.downloads) &&
        value.downloads.length > 0 &&
        value.downloads.every(
          download =>
            isRecord(download) &&
            typeof download.name === 'string' &&
            typeof download.loaded === 'number' &&
            Number.isSafeInteger(download.loaded) &&
            download.loaded >= 0 &&
            typeof download.total === 'number' &&
            Number.isSafeInteger(download.total) &&
            download.total > 0 &&
            download.loaded <= download.total
        )))
  );
}

function diagnostics(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      diagnostic =>
        isRecord(diagnostic) &&
        (diagnostic.file === null || typeof diagnostic.file === 'string') &&
        (diagnostic.line === null || Number.isInteger(diagnostic.line)) &&
        (diagnostic.column === null || Number.isInteger(diagnostic.column)) &&
        ['error', 'warning', 'note'].includes(String(diagnostic.severity)) &&
        typeof diagnostic.message === 'string'
    )
  );
}

function streams(value: Record<string, unknown>): boolean {
  return (
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string' &&
    typeof value.duration === 'number' &&
    Number.isFinite(value.duration) &&
    value.duration >= 0
  );
}

function isStage(value: unknown): value is Stage {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    streams(value) &&
    ['success', 'failed', 'skipped'].includes(String(value.status)) &&
    Array.isArray(value.commands) &&
    value.commands.every(command => typeof command === 'string') &&
    diagnostics(value.diagnostics) &&
    Number.isInteger(value.exitCode)
  );
}

export function isOutput(value: unknown): value is Output {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) {
    return false;
  }
  if (value.kind === 'error') {
    return typeof value.message === 'string';
  }
  if (value.kind === 'progress') {
    return isProgress(value.progress);
  }
  if (value.kind === 'ready') {
    const info = value.info;
    return (
      isRecord(info) &&
      typeof info.version === 'string' &&
      typeof info.resourceDirectory === 'string' &&
      Array.isArray(info.targets) &&
      info.targets.every(isTarget)
    );
  }
  const result = value.result;
  if (!isRecord(result) || !Number.isSafeInteger(result.id)) {
    return false;
  }
  if (value.kind === 'execution') {
    return (
      streams(result) &&
      ((result.status === 'success' &&
        (result.value === null || typeof result.value === 'number')) ||
        (result.status === 'failed' && typeof result.message === 'string'))
    );
  }
  if (value.kind === 'command') {
    return isStage(result.stage) && isFiles(result.files);
  }
  return (
    value.kind === 'result' &&
    streams(result) &&
    typeof result.sourcePath === 'string' &&
    Number.isInteger(result.exitCode) &&
    diagnostics(result.diagnostics) &&
    Array.isArray(result.commands) &&
    result.commands.every(command => typeof command === 'string') &&
    Array.isArray(result.stages) &&
    result.stages.every(isStage) &&
    isFiles(result.files) &&
    Array.isArray(result.artifacts) &&
    result.artifacts.every(
      artifact =>
        isRecord(artifact) &&
        artifact.build === result.id &&
        isOutputKind(artifact.kind) &&
        typeof artifact.path === 'string' &&
        ((artifact.format === 'text' && typeof artifact.text === 'string') ||
          (artifact.format === 'binary' && artifact.data instanceof Uint8Array))
    )
  );
}
