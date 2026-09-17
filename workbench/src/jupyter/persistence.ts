import type { IStateDB } from '@jupyterlab/statedb';

import type { IPersistence } from '../persistence';

const stateId = 'fortitudo:session';

/** Protect recent edits while Jupyter's workspace persistence is deferred. */
export function createPersistence(state: IStateDB, key: string): IPersistence {
  return {
    async load() {
      let cached: string | null = null;
      try {
        cached = localStorage.getItem(key);
      } catch {
        // The host remains usable when browser storage is unavailable.
      }
      return cached === null ? state.fetch(stateId) : JSON.parse(cached);
    },
    async save(value) {
      let failure: unknown = null;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        failure = error;
      }
      await state.save(stateId, value);
      if (failure) {
        throw new Error(`Recent edits could not be cached: ${String(failure)}`);
      }
    }
  };
}
