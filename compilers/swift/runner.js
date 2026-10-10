const isProgramEntry = (name) => ["_start", "main", "__main_argc_argv"].includes(name);
class ProcessExit extends Error {
  constructor(code) {
    super(`Process exited with status ${code}.`);
    this.code = code;
  }
  code;
}
async function runStandalone(code, path, symbol, signature, args) {
  let instance = null;
  let stdout = "";
  let stderr = "";
  const out = new TextDecoder();
  const err = new TextDecoder();
  const argument = new TextEncoder().encode(path);
  const memory = () => {
    const value2 = instance?.exports.memory;
    if (!(value2 instanceof WebAssembly.Memory)) {
      throw new Error("The standalone program does not export memory.");
    }
    return value2.buffer;
  };
  const write32 = (pointer, value2) => new DataView(memory()).setUint32(pointer >>> 0, value2, true);
  const bytes = (pointer, length) => new Uint8Array(memory(), pointer >>> 0, length >>> 0);
  const copyArgument = (pointer, length) => {
    if (length <= 0) {
      return;
    }
    const count = Math.min(argument.length, length - 1);
    bytes(pointer, count).set(argument.subarray(0, count));
    bytes(pointer + count, 1)[0] = 0;
  };
  const wasi = {
    args_sizes_get(count, size) {
      write32(count, 1);
      write32(size, argument.length + 1);
      return 0;
    },
    args_get(offsets, buffer) {
      write32(offsets, buffer);
      copyArgument(buffer, argument.length + 1);
      return 0;
    },
    proc_exit(code2) {
      throw new ProcessExit(code2 >>> 0);
    },
    fd_write(fd, vectors, count, written) {
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
    fd_read(_fd, _vectors, _count, read) {
      write32(read, 0);
      return 0;
    },
    fd_close() {
      return 0;
    },
    fd_seek(_fd, _offset, _whence, result) {
      new DataView(memory()).setBigUint64(result >>> 0, 0n, true);
      return 0;
    },
    environ_sizes_get(count, size) {
      write32(count, 0);
      write32(size, 0);
      return 0;
    },
    environ_get() {
      return 0;
    },
    random_get(pointer, length) {
      const buffer = bytes(pointer, length);
      for (let offset = 0; offset < buffer.length; offset += 65536) {
        crypto.getRandomValues(buffer.subarray(offset, offset + 65536));
      }
      return 0;
    }
  };
  let value;
  try {
    const result = await WebAssembly.instantiate(code.slice().buffer, {
      wasi_snapshot_preview1: wasi,
      env: {
        _swift_emscripten_getArgCount: () => 1,
        _swift_emscripten_getArgLen: (index) => index === 0 ? argument.length : -1,
        _swift_emscripten_getArg: (index, pointer, size) => {
          if (index === 0) {
            copyArgument(pointer, size);
          }
        }
      }
    });
    instance = result.instance;
    const entry = isProgramEntry(symbol) ? "_start" : symbol;
    const fn = instance.exports[entry];
    if (typeof fn !== "function") {
      throw new Error(`The program does not export ${entry}.`);
    }
    if (!isProgramEntry(symbol) && symbol !== "_start") {
      const initialize = instance.exports.__wasm_call_ctors;
      if (typeof initialize !== "function") {
        throw new Error(
          "The standalone program does not export its initializer."
        );
      }
      initialize();
    }
    const returned = fn(...entry === "_start" ? [] : args);
    if (entry !== "_start" && signature.results.length && typeof returned !== "number") {
      throw new Error("The program returned an invalid scalar value.");
    }
    value = {
      status: "success",
      value: typeof returned === "number" ? returned : 0
    };
  } catch (error) {
    value = error instanceof ProcessExit ? { status: "success", value: error.code } : { status: "failed", message: String(error) };
  }
  return {
    value,
    stdout: stdout + out.decode(),
    stderr: stderr + err.decode()
  };
}
export {
  runStandalone
};
