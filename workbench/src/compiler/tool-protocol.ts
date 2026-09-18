import type { CommandResult, File, Progress } from './types';
import { isFiles, isOutput, isProgress, isRecord } from './protocol';

/** Assets for one genuine Emscripten command-line program. */
export type ToolRuntime = Readonly<{
  /** Human-readable stage name; it does not affect argument parsing. */
  name: string;
  loader: string;
  wasm: string;
  manifest?: string;
}>;

type RequestBase = Readonly<{
  id: number;
  files: readonly File[];
}>;

/**
 * Prefer argv for compiler pipelines. Command text is a terminal convenience;
 * it is split into words only and is never interpreted per tool.
 */
export type ToolRequest = RequestBase &
  (
    | Readonly<{ argv: readonly string[]; command?: never }>
    | Readonly<{ command: string; argv?: never }>
  );

export type ToolInput = Readonly<{
  kind: 'run';
  id: number;
  base: string;
  runtime: ToolRuntime;
  request: ToolRequest;
}>;

export type ToolOutput =
  | Readonly<{ kind: 'progress'; id: number; progress: Progress }>
  | Readonly<{ kind: 'result'; id: number; result: CommandResult }>
  | Readonly<{ kind: 'error'; id: number; message: string }>;

/** Split one direct command into argv without emulating a shell. */
export function commandArgv(command: string): readonly string[] {
  const argv: string[] = [];
  let word = '';
  let started = false;
  let quote = '';
  const finish = () => {
    if (started) {
      argv.push(word);
      word = '';
      started = false;
    }
  };
  for (let i = 0; i < command.length; i++) {
    const character = command[i];
    if (character === '\0') {
      throw new Error('Commands cannot contain null bytes.');
    }
    if (character === '\\' && quote !== "'") {
      if (++i === command.length) {
        throw new Error('A command cannot end with an escape.');
      }
      word += command[i];
      started = true;
    } else if (quote) {
      if (character === quote) {
        quote = '';
      } else {
        word += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      finish();
    } else if ('|;&<>'.includes(character)) {
      throw new Error('Tool workers accept one command, not shell syntax.');
    } else {
      word += character;
      started = true;
    }
  }
  if (quote) {
    throw new Error('Unclosed quote in command.');
  }
  finish();
  return validateArgv(argv);
}

export function requestArgv(request: ToolRequest): readonly string[] {
  return request.argv !== undefined
    ? validateArgv(request.argv)
    : commandArgv(request.command!);
}

export function requestCommand(request: ToolRequest): string {
  if (request.command !== undefined) {
    return request.command;
  }
  return request.argv!.map(quoteArgument).join(' ');
}

export function isToolInput(value: unknown): value is ToolInput {
  if (
    !isRecord(value) ||
    value.kind !== 'run' ||
    !Number.isSafeInteger(value.id) ||
    typeof value.base !== 'string' ||
    !isToolRuntime(value.runtime) ||
    !isRecord(value.request)
  ) {
    return false;
  }
  const request = value.request;
  if (!Number.isSafeInteger(request.id) || !isFiles(request.files)) {
    return false;
  }
  const hasArgv = Array.isArray(request.argv);
  const hasCommand = typeof request.command === 'string';
  if (hasArgv === hasCommand) {
    return false;
  }
  try {
    requestArgv(request as ToolRequest);
    return true;
  } catch {
    return false;
  }
}

export function isToolOutput(value: unknown): value is ToolOutput {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) {
    return false;
  }
  if (value.kind === 'error') {
    return typeof value.message === 'string';
  }
  if (value.kind === 'progress') {
    return isProgress(value.progress);
  }
  return (
    value.kind === 'result' &&
    isOutput({ kind: 'command', id: value.id, result: value.result })
  );
}

function isToolRuntime(value: unknown): value is ToolRuntime {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    !value.name.includes('\0') &&
    isAssetPath(value.loader, '.js') &&
    isAssetPath(value.wasm, '.wasm') &&
    (value.manifest === undefined || isAssetPath(value.manifest, '.json'))
  );
}

function isAssetPath(value: unknown, extension: string): value is string {
  return (
    typeof value === 'string' &&
    value.endsWith(extension) &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('?') &&
    !value.includes('#') &&
    value.split('/').every(part => part && part !== '.' && part !== '..')
  );
}

function validateArgv(value: readonly string[]): readonly string[] {
  if (
    value.length === 0 ||
    value.some(
      argument => typeof argument !== 'string' || argument.includes('\0')
    )
  ) {
    throw new Error('A tool invocation requires a valid argv array.');
  }
  if (!value[0]) {
    throw new Error('A tool invocation requires argv[0].');
  }
  return value;
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_./:=+,-]+$/.test(argument)
    ? argument
    : `"${argument.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
