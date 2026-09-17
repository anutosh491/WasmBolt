import { StateDB } from '@jupyterlab/statedb';

import { createPersistence } from '../jupyter/persistence';
import { initial, snapshot } from '../model';

it('restores recent edits before the host flushes its workspace', async () => {
  const state = new StateDB();
  const initialValue = snapshot(initial());
  await state.save('fortitudo:session', initialValue);
  const persistence = createPersistence(state, 'test:workspace');
  expect(await persistence.load()).toEqual(initialValue);
  const latest = { ...initialValue, source: 'latest edits' };
  await persistence.save(latest);
  // A new page can receive the host's older, debounced workspace snapshot.
  await state.save('fortitudo:session', initialValue);
  expect(await createPersistence(state, 'test:workspace').load()).toEqual(
    latest
  );
  expect(await createPersistence(state, 'test:other-workspace').load()).toEqual(
    initialValue
  );
  localStorage.clear();
});
