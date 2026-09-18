import type { ClangdInput } from './protocol';

export type ClangdLanguage = 'c' | 'cpp';

export type Position = Readonly<{ line: number; character: number }>;

export type Range = Readonly<{ start: Position; end: Position }>;

export type Diagnostic = Readonly<{
  range: Range;
  message: string;
  severity?: number;
  source?: string;
  code?: number | string;
}>;

export type Diagnostics = Readonly<{
  path: string;
  version?: number;
  diagnostics: readonly Diagnostic[];
}>;

export type CompletionItem = Readonly<{
  label: string;
  detail?: string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
  kind?: number;
  textEdit?: unknown;
  labelDetails?: Readonly<{ detail?: string; description?: string }>;
}>;

export type CompletionList = Readonly<{
  isIncomplete: boolean;
  items: readonly CompletionItem[];
}>;

export type CompletionContext = Readonly<{
  triggerKind?: 1 | 2 | 3;
  triggerCharacter?: string;
}>;

export type RuntimeProgress = Readonly<{ loaded: number; total: number }>;

export interface IClangdWorker {
  postMessage(message: ClangdInput): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export type ClangdOptions = Readonly<{
  workerUrl: URL;
  assetBase: URL;
  createWorker?: () => IClangdWorker;
  requestTimeout?: number;
  onProgress?: (progress: RuntimeProgress) => void;
}>;

export interface IClangdClient {
  initialize(): Promise<void>;
  openDocument(
    path: string,
    contents: string,
    language?: ClangdLanguage
  ): Promise<void>;
  changeDocument(path: string, contents: string): Promise<void>;
  closeDocument(path: string): void;
  completion(
    path: string,
    position: Position,
    context?: CompletionContext
  ): Promise<CompletionList>;
  onDiagnostics(listener: (event: Diagnostics) => void): () => void;
  /** Stop runtime resources while retaining documents for a lazy restart. */
  suspend(): void;
  restart(): Promise<void>;
  dispose(): void;
}
