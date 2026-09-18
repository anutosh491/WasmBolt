import { reduce } from './model';
import type { Action, State } from './model';

export interface IStore {
  readonly state: State;
  dispatch(action: Action): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Keep snapshots stable between changes, as external-store readers require. */
export function createStore(initial: State): IStore {
  let state = initial;
  let disposed = false;
  const listeners = new Set<() => void>();
  return {
    get state() {
      return state;
    },
    dispatch(action) {
      if (disposed) {
        return;
      }
      const next = reduce(state, action);
      if (next !== state) {
        state = next;
        for (const listener of listeners) {
          listener();
        }
      }
    },
    subscribe(listener) {
      if (!disposed) {
        listeners.add(listener);
      }
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    }
  };
}
