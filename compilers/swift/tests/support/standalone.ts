type CallSignature = Readonly<{ results: readonly string[] }>;
type RunResult = Readonly<{
  value:
    | Readonly<{ status: 'success'; value: number }>
    | Readonly<{ status: 'failed'; message: string }>;
  stdout: string;
  stderr: string;
}>;
const isProgramEntry = (name: string) =>
  ['_start', 'main', '__main_argc_argv'].includes(name);

class ProcessExit extends Error {
  constructor(readonly code: number) {
    super(`Process exited with status ${code}.`);
  }
}

/** Each standalone invocation owns its memory and Swift metadata registry. */
export async function runStandalone(
  code: Uint8Array,
  path: string,
  symbol: string,
  signature: CallSignature,
  args: readonly number[]
): Promise<RunResult> {
  let instance: WebAssembly.Instance | null = null;
  let stdout = '';
  let stderr = '';
  const out = new TextDecoder();
  const err = new TextDecoder();
  const argument = new TextEncoder().encode(path);
  const memory = () => {
    const value = instance?.exports.memory;
    if (!(value instanceof WebAssembly.Memory)) {
      throw new Error('The standalone program does not export memory.');
    }
    return value.buffer;
  };
  const write32 = (pointer: number, value: number) =>
    new DataView(memory()).setUint32(pointer >>> 0, value, true);
  const bytes = (pointer: number, length: number) =>
    new Uint8Array(memory(), pointer >>> 0, length >>> 0);
  const copyArgument = (pointer: number, length: number) => {
    if (length <= 0) {
      return;
    }
    const count = Math.min(argument.length, length - 1);
    bytes(pointer, count).set(argument.subarray(0, count));
    bytes(pointer + count, 1)[0] = 0;
  };
  const wasi = {
    args_sizes_get(count: number, size: number) {
      write32(count, 1);
      write32(size, argument.length + 1);
      return 0;
    },
    args_get(offsets: number, buffer: number) {
      write32(offsets, buffer);
      copyArgument(buffer, argument.length + 1);
      return 0;
    },
    proc_exit(code: number) {
      throw new ProcessExit(code >>> 0);
    },
    fd_write(fd: number, vectors: number, count: number, written: number) {
      if (fd !== 1 && fd !== 2) {
        return 8;
      }
      let size = 0;
      for (let index = 0; index < count; index++) {
        const view = new DataView(memory());
        const pointer = view.getUint32(vectors + index * 8, true);
        const length = view.getUint32(vectors + index * 8 + 4, true);
        if (fd === 1) {
          stdout += out.decode(bytes(pointer, length), { stream: true });
        } else {
          stderr += err.decode(bytes(pointer, length), { stream: true });
        }
        size += length;
      }
      write32(written, size);
      return 0;
    },
    fd_read(_fd: number, _vectors: number, _count: number, read: number) {
      write32(read, 0);
      return 0;
    },
    fd_close() {
      return 0;
    },
    fd_seek(_fd: number, _offset: bigint, _whence: number, result: number) {
      new DataView(memory()).setBigUint64(result >>> 0, 0n, true);
      return 0;
    },
    environ_sizes_get(count: number, size: number) {
      write32(count, 0);
      write32(size, 0);
      return 0;
    },
    environ_get() {
      return 0;
    },
    random_get(pointer: number, length: number) {
      const buffer = bytes(pointer, length);
      for (let offset = 0; offset < buffer.length; offset += 65536) {
        crypto.getRandomValues(buffer.subarray(offset, offset + 65536));
      }
      return 0;
    }
  };
  let value: RunResult['value'];
  try {
    const result = await WebAssembly.instantiate(code.slice().buffer, {
      wasi_snapshot_preview1: wasi,
      env: {
        _swift_emscripten_getArgCount: () => 1,
        _swift_emscripten_getArgLen: (index: number) =>
          index === 0 ? argument.length : -1,
        _swift_emscripten_getArg: (
          index: number,
          pointer: number,
          size: number
        ) => {
          if (index === 0) {
            copyArgument(pointer, size);
          }
        }
      }
    });
    instance = result.instance;
    const entry = isProgramEntry(symbol) ? '_start' : symbol;
    const fn = instance.exports[entry];
    if (typeof fn !== 'function') {
      throw new Error(`The program does not export ${entry}.`);
    }
    if (!isProgramEntry(symbol) && symbol !== '_start') {
      const initialize = instance.exports.__wasm_call_ctors;
      if (typeof initialize !== 'function') {
        throw new Error(
          'The standalone program does not export its initializer.'
        );
      }
      initialize();
    }
    const returned = fn(...(entry === '_start' ? [] : args));
    if (
      entry !== '_start' &&
      signature.results.length &&
      typeof returned !== 'number'
    ) {
      throw new Error('The program returned an invalid scalar value.');
    }
    value = {
      status: 'success',
      value: typeof returned === 'number' ? returned : 0
    };
  } catch (error) {
    value =
      error instanceof ProcessExit
        ? { status: 'success', value: error.code }
        : { status: 'failed', message: String(error) };
  }
  return {
    value,
    stdout: stdout + out.decode(),
    stderr: stderr + err.decode()
  };
}
