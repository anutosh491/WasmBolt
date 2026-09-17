import type { File, Progress } from './types';

/** Browser timers use a signed 32-bit delay in milliseconds. */
export function isTimeout(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 2147483647
  );
}

export type RunRequest = Readonly<{
  id: number;
  module: string;
  files: readonly File[];
  symbol: string;
  /** Use the selected WasmFunction's signatureCode from inspectWasm. */
  signatureCode: number;
  args: readonly number[];
}>;

export type RunResult = Readonly<{
  id: number;
  stdout: string;
  stderr: string;
  duration: number;
}> &
  (
    | Readonly<{ status: 'success'; value: number | null }>
    | Readonly<{ status: 'failed'; message: string }>
  );

/** A runner owns a separate worker and one lazily loaded module. */
export interface IRunner {
  run(
    request: RunRequest,
    timeout: number,
    onProgress?: (progress: Progress) => void
  ): Promise<RunResult>;
  reset(): void;
  dispose(): void;
}
