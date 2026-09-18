/** Metadata describes the Wasm ABI, not C pointer or aggregate semantics. */
export type WasmFunction = Readonly<{
  name: string;
  params: readonly string[];
  results: readonly string[];
  signature: string;
  /** True when the browser runner can represent this scalar signature. */
  callable: boolean;
}>;

export type WasmInfo = Readonly<{
  bytes: number;
  imports: readonly Readonly<{ module: string; name: string; kind: string }>[];
  exports: readonly Readonly<{ name: string; kind: string }>[];
  functions: readonly WasmFunction[];
}>;

const kinds = ['function', 'table', 'memory', 'global', 'tag'];
const scalarTypes = new Set(['i32', 'f32', 'f64']);

/** Inspect bounded sections without instantiating or executing the module. */
export function inspectWasm(bytes: Uint8Array): WasmInfo {
  const reader = new Reader(bytes);
  for (const expected of [0, 97, 115, 109, 1, 0, 0, 0]) {
    if (reader.byte() !== expected) {
      throw new Error('Invalid WebAssembly header or version.');
    }
  }
  const types: { params: string[]; results: string[] }[] = [];
  const functions: number[] = [];
  const imports: { module: string; name: string; kind: string }[] = [];
  const exports: { name: string; kind: string; index: number }[] = [];
  const seen = new Set<number>();
  while (!reader.done) {
    const id = reader.byte();
    const section = reader.section();
    if (id !== 0 && seen.has(id)) {
      throw new Error('Duplicate WebAssembly section.');
    }
    seen.add(id);
    if (id === 1) {
      for (let count = section.count(); count > 0; count--) {
        if (section.byte() !== 0x60) {
          throw new Error('This Wasm function type is not supported.');
        }
        types.push({
          params: section.vector().map(() => section.type()),
          results: section.vector().map(() => section.type())
        });
      }
    } else if (id === 2) {
      for (let count = section.count(); count > 0; count--) {
        const module = section.name();
        const name = section.name();
        const kind = section.byte();
        if (!kinds[kind]) {
          throw new Error('Invalid Wasm import kind.');
        }
        imports.push({ module, name, kind: kinds[kind] });
        switch (kind) {
          case 0:
            functions.push(section.uint());
            break;
          case 1:
            section.type();
            section.limits();
            break;
          case 2:
            section.limits();
            break;
          case 3:
            section.type();
            section.byte();
            break;
          case 4:
            section.uint();
            section.uint();
            break;
        }
      }
    } else if (id === 3) {
      functions.push(...section.vector().map(() => section.uint()));
    } else if (id === 7) {
      for (let count = section.count(); count > 0; count--) {
        const name = section.name();
        const kind = kinds[section.byte()];
        if (!kind || exports.some(entry => entry.name === name)) {
          throw new Error('Invalid Wasm export.');
        }
        exports.push({ name, kind, index: section.uint() });
      }
    }
    if ([1, 2, 3, 7].includes(id) && !section.done) {
      throw new Error('Unexpected bytes in WebAssembly section.');
    }
  }
  return {
    bytes: bytes.length,
    imports,
    exports: exports.map(({ name, kind }) => ({ name, kind })),
    functions: exports
      .filter(entry => entry.kind === 'function')
      .map(entry => {
        const type = types[functions[entry.index]];
        if (!type) {
          throw new Error('Invalid Wasm function type index.');
        }
        const signature =
          `${type.results.join(', ') || 'void'}` +
          `(${type.params.join(', ')})`;
        return {
          name: entry.name,
          ...type,
          signature,
          callable:
            !entry.name.startsWith('__') &&
            type.results.length <= 1 &&
            [...type.params, ...type.results].every(type =>
              scalarTypes.has(type)
            )
        };
      })
  };
}

/** Own the cursor and enforce section bounds before every read/allocation. */
class Reader {
  constructor(private readonly bytes: Uint8Array) {}
  private offset = 0;
  get done(): boolean {
    return this.offset === this.bytes.length;
  }
  byte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error('Truncated WebAssembly module.');
    }
    return this.bytes[this.offset++];
  }
  uint(): number {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = this.byte();
      if (shift === 28 && byte > 15) {
        throw new Error('Invalid WebAssembly integer.');
      }
      value += (byte & 127) * 2 ** shift;
      if (byte < 128) {
        return value;
      }
    }
    throw new Error('Invalid WebAssembly integer.');
  }
  section(): Reader {
    const size = this.uint();
    if (size > this.bytes.length - this.offset) {
      throw new Error('Truncated WebAssembly section.');
    }
    const section = new Reader(
      this.bytes.subarray(this.offset, this.offset + size)
    );
    this.offset += size;
    return section;
  }
  name(): string {
    const section = this.section();
    return new TextDecoder('utf-8', { fatal: true }).decode(section.bytes);
  }
  count(): number {
    const size = this.uint();
    if (size > this.bytes.length - this.offset) {
      throw new Error('Invalid WebAssembly vector size.');
    }
    return size;
  }
  vector(): undefined[] {
    return Array.from({ length: this.count() });
  }
  type(): string {
    const type = this.byte();
    const names: Readonly<Record<number, string>> = {
      127: 'i32',
      126: 'i64',
      125: 'f32',
      124: 'f64',
      123: 'v128',
      112: 'funcref',
      111: 'externref'
    };
    if (!names[type]) {
      throw new Error('Unsupported WebAssembly value type.');
    }
    return names[type];
  }
  limits(): void {
    const flags = this.uint();
    if (flags > 3) {
      throw new Error('Unsupported WebAssembly memory limits.');
    }
    this.uint();
    if (flags & 1) {
      this.uint();
    }
  }
}
