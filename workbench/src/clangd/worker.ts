import { installClangdWorker } from './runtime';
import type { IClangdWorkerScope } from './runtime';

installClangdWorker(globalThis as unknown as IClangdWorkerScope);
