/** Source languages supported by the explorer. */
export type Language = 'c' | 'cpp' | 'llvm' | 'mlir';

/** Targets exposed when their backend is present in the runtime. */
export type Target =
  | 'wasm32-unknown-emscripten'
  | 'x86_64-unknown-linux-gnu'
  | 'aarch64-unknown-linux-gnu';

export type Optimization = 0 | 1 | 2 | 3;

export type Options = Readonly<{
  language: Language;
  target: Target;
  optimization: Optimization;
  /** Null follows the selected optimization level. */
  llvmPipeline: string | null;
  analysisPipeline: string;
  mlirPipeline: string;
}>;

export type Info = Readonly<{
  version: string;
  resourceDirectory: string;
  targets: readonly Target[];
}>;

/** Decoded asset bytes, measured against the packaged manifest. */
export type Download = Readonly<{
  name: string;
  loaded: number;
  total: number;
}>;

/** Preparation includes integrity checks and runtime initialization. */
export type Progress =
  | Readonly<{ phase: 'downloading'; downloads: readonly Download[] }>
  | Readonly<{ phase: 'preparing' }>
  | Readonly<{ phase: 'working'; stage: string }>;

export type Request = Readonly<{
  id: number;
  source: string;
  sourcePath: string;
  files: readonly File[];
  options: Options;
  /** Stop after producing this representation and its prerequisites. */
  output?: OutputKind;
}>;

export type Diagnostic = Readonly<{
  file: string | null;
  line: number | null;
  column: number | null;
  severity: 'error' | 'warning' | 'note';
  message: string;
}>;

export type OutputKind =
  | 'ast'
  | 'ir'
  | 'optimized'
  | 'analysis'
  | 'graphs'
  | 'assembly'
  | 'object'
  | 'wasm'
  | 'mlir';

/** Buffers belong to their snapshot and must never be mutated or detached. */
export type File = Readonly<{ path: string; data: Uint8Array }>;

export type Artifact = Readonly<{
  build: number;
  kind: OutputKind;
  path: string;
}> &
  (
    | Readonly<{ format: 'text'; text: string }>
    | Readonly<{ format: 'binary'; data: Uint8Array }>
  );

export type Stage = Readonly<{
  name: string;
  status: 'success' | 'failed' | 'skipped';
  commands: readonly string[];
  diagnostics: readonly Diagnostic[];
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}>;

export type Result = Readonly<{
  id: number;
  sourcePath: string;
  artifacts: readonly Artifact[];
  stages: readonly Stage[];
  files: readonly File[];
  diagnostics: readonly Diagnostic[];
  commands: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}>;

export type CommandRequest = Readonly<{
  id: number;
  command: string;
  files: readonly File[];
}>;

export type CommandResult = Readonly<{
  id: number;
  stage: Stage;
  files: readonly File[];
}>;

/** Ordinary compiler errors resolve; runtime failures reject. */
export interface ICompiler {
  /** Progress callbacks are released when initialization settles. */
  initialize(onProgress?: (progress: Progress) => void): Promise<Info>;
  compile(
    request: Request,
    onProgress?: (progress: Progress) => void
  ): Promise<Result>;
  command(
    request: CommandRequest,
    onProgress?: (progress: Progress) => void
  ): Promise<CommandResult>;
  cancel(): void;
  dispose(): void;
}

export const pipelines = {
  llvmPipeline: null,
  analysisPipeline: 'print<domtree>,print<loops>',
  mlirPipeline:
    'builtin.module(canonicalize,cse,convert-arith-to-llvm,' +
    'convert-func-to-llvm,reconcile-unrealized-casts)'
} as const;

export const languageLabels: Readonly<Record<Language, string>> = {
  cpp: 'C++23',
  c: 'C23',
  llvm: 'LLVM IR',
  mlir: 'MLIR'
};

export const outputLabels: Readonly<Record<OutputKind, string>> = {
  assembly: 'Assembly',
  ast: 'AST',
  ir: 'LLVM IR',
  optimized: 'Optimized IR',
  analysis: 'Analysis',
  graphs: 'Graphviz',
  wasm: 'Wasm module',
  mlir: 'MLIR',
  object: 'Object'
};

/** Representations produced by one compilation, in workbench order. */
export function availableOutputs(options: Options): readonly OutputKind[] {
  if (options.language === 'mlir') {
    return ['mlir', 'ir', 'graphs'];
  }
  return [
    ...(options.language === 'llvm' ? [] : (['ast'] as const)),
    'ir',
    'graphs',
    'assembly',
    ...(options.target === 'wasm32-unknown-emscripten'
      ? (['wasm'] as const)
      : [])
  ];
}

export function isLanguage(value: unknown): value is Language {
  return Object.keys(languageLabels).some(language => language === value);
}

export function isOutputKind(value: unknown): value is OutputKind {
  return Object.keys(outputLabels).some(kind => kind === value);
}

export function sourceName(language: Language): string {
  return language === 'llvm'
    ? 'input.ll'
    : language === 'mlir'
      ? 'input.mlir'
      : `snippet.${language === 'cpp' ? 'cpp' : 'c'}`;
}

export const targets: readonly Target[] = [
  'wasm32-unknown-emscripten',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu'
];

export const targetLabels: Readonly<Record<Target, string>> = {
  'wasm32-unknown-emscripten': 'WebAssembly',
  'x86_64-unknown-linux-gnu': 'x86-64',
  'aarch64-unknown-linux-gnu': 'AArch64'
};

export function isTarget(value: unknown): value is Target {
  return targets.some(target => target === value);
}

export function isOptions(value: unknown): value is Options {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'language' in value &&
    isLanguage(value.language) &&
    'target' in value &&
    isTarget(value.target) &&
    'optimization' in value &&
    [0, 1, 2, 3].some(level => level === value.optimization) &&
    'llvmPipeline' in value &&
    (value.llvmPipeline === null || typeof value.llvmPipeline === 'string') &&
    'analysisPipeline' in value &&
    typeof value.analysisPipeline === 'string' &&
    'mlirPipeline' in value &&
    typeof value.mlirPipeline === 'string'
  );
}

export function isRequest(value: unknown): value is Request {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    Number.isSafeInteger(value.id) &&
    'source' in value &&
    typeof value.source === 'string' &&
    'sourcePath' in value &&
    typeof value.sourcePath === 'string' &&
    value.sourcePath.startsWith('/workspace/') &&
    'files' in value &&
    Array.isArray(value.files) &&
    value.files.every(isFile) &&
    'options' in value &&
    isOptions(value.options) &&
    (!('output' in value) ||
      value.output === undefined ||
      isOutputKind(value.output))
  );
}

function isFile(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    value.path.startsWith('/workspace/') &&
    'data' in value &&
    value.data instanceof Uint8Array
  );
}
