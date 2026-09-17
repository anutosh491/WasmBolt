import { DebuggerSessionPhase, isDebuggerRuntimeLog } from '../lldb/phase';

it('buffers an initial stopped event until DAP configuration completes', () => {
  const phase = new DebuggerSessionPhase();
  phase.begin();
  expect(phase.stopped({ threadId: 7, reason: 'breakpoint' })).toBeNull();
  expect(phase.startRunning()).toBe(false);
  expect(phase.configure()).toEqual({ threadId: 7, reason: 'breakpoint' });
  expect(phase.startRunning()).toBe(false);
});

it('delivers later stopped events immediately', () => {
  const phase = new DebuggerSessionPhase();
  phase.begin();
  expect(phase.configure()).toBeNull();
  expect(phase.startRunning()).toBe(true);
  expect(phase.stopped({ threadId: 2, reason: 'step' })).toEqual({
    threadId: 2,
    reason: 'step'
  });
});

it('separates native transport logs from program output', () => {
  expect(isDebuggerRuntimeLog('[DAP/recv] stopped')).toBe(true);
  expect(isDebuggerRuntimeLog('[WAMR debug] packet')).toBe(true);
  expect(isDebuggerRuntimeLog('[RSP/send] g')).toBe(true);
  expect(isDebuggerRuntimeLog('program output')).toBe(false);
});
