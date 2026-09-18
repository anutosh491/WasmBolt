import { spawnSync } from 'node:child_process';

const result = spawnSync('python', ['scripts/packages.py'], {
  stdio: 'inherit'
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
