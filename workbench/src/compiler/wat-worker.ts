import { renderWat } from './wat-runtime';
import { isWatInput } from './wat';
import type { WatOutput } from './wat';

const scope: DedicatedWorkerGlobalScope = self;
let consumed = false;

scope.addEventListener('message', event => {
  const value: unknown = event.data;
  const id =
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    Number.isSafeInteger(value.id)
      ? Number(value.id)
      : 0;
  if (!isWatInput(value)) {
    reply({ kind: 'error', id, message: 'Invalid WAT request.' });
    return;
  }
  if (consumed) {
    reply({ kind: 'error', id, message: 'This WAT worker is already used.' });
    return;
  }
  consumed = true;
  void renderWat(value.data)
    .then(text => reply({ kind: 'result', id, text }))
    .catch(error => {
      reply({
        kind: 'error',
        id,
        message: error instanceof Error ? error.message : String(error)
      });
    });
});

function reply(output: WatOutput): void {
  scope.postMessage(output);
}
