import { lldbInvocation } from '../lldb/protocol';
import type { LldbInput, LldbOutput } from '../lldb/protocol';
import { createLldbStaticInspector } from '../lldb/service';
import type { ILldbWorker } from '../lldb/service';

class Worker implements ILldbWorker {
  onmessage: ILldbWorker['onmessage'] = null;
  onerror: ILldbWorker['onerror'] = null;
  onmessageerror: ILldbWorker['onmessageerror'] = null;
  messages: LldbInput[] = [];
  terminated = false;

  postMessage(input: LldbInput): void {
    this.messages.push(input);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(output: LldbOutput): void {
    this.onmessage?.(new MessageEvent('message', { data: output }));
  }
}

const file = {
  path: '/workspace/program.wasm',
  data: Uint8Array.of(0, 97, 115, 109)
};

const command =
  'lldb -b -o "image list" -o "image lookup -n main" program.wasm';

it('parses ordinary LLDB batch inspection commands', () => {
  expect(lldbInvocation(command)).toEqual({
    target: '/workspace/program.wasm',
    commands: ['image list', 'image lookup -n main']
  });
  expect(() => lldbInvocation('lldb program.wasm')).toThrow('lldb -b');
  expect(() => lldbInvocation('lldb -b /tmp/program.wasm')).toThrow(
    '/workspace'
  );
  expect(() => lldbInvocation('lldb -b program.wasm')).toThrow(
    'at least one -o'
  );
});

it('uses the selected workspace artifact in a disposable worker', async () => {
  const workers: Worker[] = [];
  const inspector = createLldbStaticInspector(
    new URL('https://example.test/compiler/lldb-worker.js'),
    () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    }
  );
  const request = { id: 7, command, files: [file] };
  const pending = inspector.run(request);
  expect(workers[0].messages).toEqual([
    {
      kind: 'run',
      id: 7,
      base: 'https://example.test/compiler/',
      request
    }
  ]);
  workers[0].reply({
    kind: 'result',
    id: 7,
    result: {
      id: 7,
      files: [file],
      stage: {
        name: 'lldb',
        status: 'success',
        commands: [command],
        diagnostics: [],
        stdout: 'target modules list',
        stderr: '',
        exitCode: 0,
        duration: 1
      }
    }
  });
  await expect(pending).resolves.toMatchObject({
    stage: { name: 'lldb', status: 'success' }
  });
  expect(workers[0].terminated).toBe(true);
  inspector.dispose();
});

it('rejects a command whose selected artifact is absent', async () => {
  const inspector = createLldbStaticInspector(
    new URL('https://example.test/compiler/lldb-worker.js'),
    () => new Worker()
  );
  await expect(inspector.run({ id: 8, command, files: [] })).rejects.toThrow(
    'not in the workspace'
  );
  inspector.dispose();
});
