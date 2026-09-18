export type JsonRpcId = number | string;

export type JsonRpcError = Readonly<{
  code: number;
  message: string;
  data?: unknown;
}>;

export type JsonRpcMessage = Readonly<{
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}>;

export type ClangdInput =
  | Readonly<{ kind: 'start'; base: string }>
  | Readonly<{ kind: 'lsp'; message: JsonRpcMessage }>
  | Readonly<{ kind: 'sync'; path: string; contents: string }>;

export type ClangdOutput =
  | Readonly<{ kind: 'ready' }>
  | Readonly<{
      kind: 'progress';
      loaded: number;
      total: number;
    }>
  | Readonly<{ kind: 'lsp'; message: JsonRpcMessage }>
  | Readonly<{ kind: 'log'; message: string }>
  | Readonly<{ kind: 'error'; message: string }>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!record(value) || value.jsonrpc !== '2.0') {
    return false;
  }
  return (
    value.id === undefined ||
    typeof value.id === 'string' ||
    Number.isSafeInteger(value.id)
  );
}

export function isClangdInput(value: unknown): value is ClangdInput {
  if (!record(value)) {
    return false;
  }
  if (value.kind === 'start') {
    return typeof value.base === 'string';
  }
  if (value.kind === 'lsp') {
    return isJsonRpcMessage(value.message);
  }
  return (
    value.kind === 'sync' &&
    typeof value.path === 'string' &&
    typeof value.contents === 'string'
  );
}

export function isClangdOutput(value: unknown): value is ClangdOutput {
  if (!record(value) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'ready') {
    return true;
  }
  if (value.kind === 'lsp') {
    return isJsonRpcMessage(value.message);
  }
  if (value.kind === 'error' || value.kind === 'log') {
    return typeof value.message === 'string';
  }
  return (
    value.kind === 'progress' &&
    Number.isSafeInteger(value.loaded) &&
    Number(value.loaded) >= 0 &&
    Number.isSafeInteger(value.total) &&
    Number(value.total) >= 0
  );
}
