import { isFiles, isOutput, isProgress, isRecord } from '../compiler/protocol';
import type {
  CommandRequest,
  CommandResult,
  Progress
} from '../compiler/types';

export type LldbInvocation = Readonly<{
  target: string;
  commands: readonly string[];
}>;

export type LldbInput = Readonly<{
  kind: 'run';
  id: number;
  base: string;
  request: CommandRequest;
}>;

export type LldbOutput =
  | Readonly<{ kind: 'progress'; id: number; progress: Progress }>
  | Readonly<{ kind: 'result'; id: number; result: CommandResult }>
  | Readonly<{ kind: 'error'; id: number; message: string }>;

/** Parse the small, ordinary LLDB batch surface supported by this worker. */
export function lldbInvocation(command: string): LldbInvocation {
  const tokens = shellWords(command);
  if (tokens[0] !== 'lldb') {
    throw new Error('Expected an lldb command.');
  }
  const commands: string[] = [];
  let target = '';
  let batch = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-b' || token === '--batch') {
      batch = true;
    } else if (token === '--no-lldbinit') {
      continue;
    } else if (token === '-o' || token === '--one-line') {
      const value = tokens[++index];
      if (!value) {
        throw new Error(`${token} requires an LLDB command.`);
      }
      commands.push(value);
    } else if (token.startsWith('--one-line=')) {
      commands.push(token.slice('--one-line='.length));
    } else if (token.startsWith('-')) {
      throw new Error(`Unsupported LLDB batch option: ${token}`);
    } else if (target) {
      throw new Error('LLDB static inspection accepts one Wasm file.');
    } else {
      target = token.startsWith('/') ? token : `/workspace/${token}`;
    }
  }
  if (!batch) {
    throw new Error('Use lldb -b for the current static-inspection worker.');
  }
  if (!target.startsWith('/workspace/') || !target.endsWith('.wasm')) {
    throw new Error('Choose a .wasm file from /workspace.');
  }
  if (commands.length === 0) {
    throw new Error('Add at least one -o "LLDB command".');
  }
  return { target, commands };
}

export function isLldbInput(value: unknown): value is LldbInput {
  if (
    !isRecord(value) ||
    value.kind !== 'run' ||
    !Number.isSafeInteger(value.id) ||
    typeof value.base !== 'string' ||
    !isRecord(value.request)
  ) {
    return false;
  }
  return (
    Number.isSafeInteger(value.request.id) &&
    typeof value.request.command === 'string' &&
    isFiles(value.request.files)
  );
}

export function isLldbOutput(value: unknown): value is LldbOutput {
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

function shellWords(command: string): string[] {
  const tokens: string[] = [];
  let word = '';
  let started = false;
  let quote = '';
  const finish = () => {
    if (started) {
      tokens.push(word);
      word = '';
      started = false;
    }
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\0') {
      throw new Error('Commands cannot contain null bytes.');
    }
    if (character === '\\' && quote !== "'") {
      if (++index === command.length) {
        throw new Error('A command cannot end with an escape.');
      }
      word += command[index];
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
      throw new Error('LLDB batch commands do not support shell syntax.');
    } else {
      word += character;
      started = true;
    }
  }
  if (quote) {
    throw new Error('Unclosed quote in command.');
  }
  finish();
  return tokens;
}
