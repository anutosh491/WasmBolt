import { createClient } from './client';
import type { IWorker } from './client';
import type { IRunner } from './execution';
import { isTimeout } from './execution';
import type { File } from './types';

/** A stopped program cannot invalidate compiler state or newer executions. */
export function createRunner(url: URL, create?: () => IWorker): IRunner {
  const client = createClient(url, create);
  let current: readonly File[] | null = null;
  let path: string | null = null;
  let generation = 0;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function reset() {
    generation += 1;
    current = null;
    path = null;
    busy = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    client.cancel();
  }
  return {
    async run(request, timeout, onProgress) {
      if (busy) {
        throw new Error('A program is already running.');
      }
      if (!isTimeout(timeout)) {
        throw new Error(
          'Execution timeout is outside the browser timer range.'
        );
      }
      if (current !== request.files || path !== request.module) {
        reset();
        current = request.files;
        path = request.module;
      }
      busy = true;
      const token = generation;
      let expired = false;
      try {
        await client.initialize(onProgress);
        if (generation !== token) {
          throw new Error('Execution stopped.');
        }
        onProgress?.({ phase: 'working', stage: 'Running program' });
        timer = setTimeout(() => {
          expired = true;
          reset();
        }, timeout);
        const result = await client.execute(request);
        if (result.status === 'failed') {
          reset();
        }
        return result;
      } catch (error) {
        if (token === generation) {
          reset();
        }
        throw expired ? new Error('Execution timed out.') : error;
      } finally {
        if (token === generation) {
          busy = false;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
        }
      }
    },
    reset,
    dispose() {
      reset();
      client.dispose();
    }
  };
}
