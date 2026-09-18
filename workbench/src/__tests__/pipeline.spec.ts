import { createPipelineTools } from '../compiler/pipeline';

const source = {
  path: '/workspace/input.ll',
  data: Uint8Array.of(1, 2, 3)
};

it('fails honestly when genuine pipeline assets are not staged', async () => {
  const tools = createPipelineTools(
    new URL('https://example.test/compiler/'),
    [],
    () => {
      throw new Error('must not create a worker for an unavailable tool');
    }
  );

  await expect(
    tools.run(1, ['opt', '/workspace/input.ll'], [source])
  ).resolves.toMatchObject({
    files: [source],
    stage: {
      name: 'opt',
      status: 'failed',
      exitCode: 127,
      stderr: expect.stringContaining('genuine Emscripten driver assets')
    }
  });
  await expect(
    tools.run(2, ['clang', '/workspace/input.c'], [source])
  ).resolves.toBeNull();
  tools.dispose();
});
