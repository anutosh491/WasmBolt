export type BufferedStop = Readonly<{ threadId: number; reason: string }>;

export function isDebuggerRuntimeLog(text: string): boolean {
  return /^\[(?:DAP|WAMR|RSP)(?:\/| )/.test(text);
}

/** Tracks DAP launch ordering, including a stop that precedes configuration. */
export class DebuggerSessionPhase {
  private phase: 'idle' | 'starting' | 'running' | 'stopped' | 'exited' =
    'idle';
  private configured = false;
  private pending: BufferedStop | null = null;

  begin(): void {
    this.phase = 'starting';
    this.configured = false;
    this.pending = null;
  }

  configure(): BufferedStop | null {
    this.configured = true;
    const pending = this.pending;
    this.pending = null;
    return pending;
  }

  startRunning(): boolean {
    if (this.phase !== 'starting') {
      return false;
    }
    this.phase = 'running';
    return true;
  }

  continued(): void {
    this.phase = 'running';
  }

  stopped(value: BufferedStop): BufferedStop | null {
    this.phase = 'stopped';
    if (this.configured) {
      return value;
    }
    this.pending = value;
    return null;
  }

  exited(): void {
    this.phase = 'exited';
  }
}
