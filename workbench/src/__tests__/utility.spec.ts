import { createUtilityRunner } from '../compiler/utility';
import type {
  IUtilityWorker,
  UtilityInput,
  UtilityOutput
} from '../compiler/utility';

class UtilityWorker implements IUtilityWorker {
  onmessage: IUtilityWorker['onmessage'] = null;
  onerror: IUtilityWorker['onerror'] = null;
  onmessageerror: IUtilityWorker['onmessageerror'] = null;
  messages: UtilityInput[] = [];
  terminated = false;
  postMessage(input: UtilityInput): void {
    this.messages.push(input);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(output: UtilityOutput): void {
    this.onmessage?.(new MessageEvent('message', { data: output }));
  }
}

it('runs each LLVM utility in a fresh multicall worker', async () => {
  const workers: UtilityWorker[] = [];
  const runner = createUtilityRunner(
    new URL('https://example.test/compiler/worker.js'),
    () => {
      const worker = new UtilityWorker();
      workers.push(worker);
      return worker;
    }
  );
  const request = {
    id: 7,
    command: 'llvm-nm --demangle /workspace/output.o',
    files: [{ path: '/workspace/output.o', data: Uint8Array.of(1) }]
  };
  const first = runner.command(request);
  expect(workers[0].messages[0]).toMatchObject({
    args: ['nm', '--demangle', '/workspace/output.o']
  });
  workers[0].reply({
    kind: 'result',
    id: 7,
    files: request.files,
    stdout: 'symbol',
    stderr: '',
    exitCode: 0,
    duration: 2
  });
  await expect(first).resolves.toMatchObject({
    stage: { name: 'llvm-nm', stdout: 'symbol', status: 'success' }
  });
  expect(workers[0].terminated).toBe(true);

  const second = runner.command({ ...request, id: 8 });
  expect(workers).toHaveLength(2);
  workers[1].reply({
    kind: 'result',
    id: 8,
    files: request.files,
    stdout: 'symbol',
    stderr: '',
    exitCode: 0,
    duration: 1
  });
  await second;
  expect(workers[1].terminated).toBe(true);
  runner.dispose();
});

it('leaves compiler and linker commands to the persistent worker', async () => {
  const runner = createUtilityRunner(
    new URL('https://example.test/compiler/worker.js'),
    () => {
      throw new Error('must not create a utility worker');
    }
  );
  await expect(
    runner.command({ id: 1, command: 'clang -c input.c', files: [] })
  ).resolves.toBeNull();
});
