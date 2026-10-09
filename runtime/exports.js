export function publicFunctionExports(exports) {
  const hidden = new Set(["__wasm_call_ctors", "__wasm_apply_data_relocs", "__dso_handle"]);
  return exports
    .filter((entry) => entry.kind === "function" && !hidden.has(entry.name) &&
      (!entry.name.startsWith("_") || /^_Z\d/.test(entry.name)))
    .map((entry) => entry.name);
}

export function displayFunctionExport(name) {
  const match = name.match(/^_Z(\d+)/);
  if (!match) return name;
  const start = match[0].length;
  const length = Number(match[1]);
  const sourceName = name.slice(start, start + length);
  return sourceName ? `${sourceName} (C++: ${name})` : name;
}

export function parseWasmFunctionSignatures(bytes) {
  let offset = 8;
  const types = [];
  const importedTypes = [];
  const definedTypes = [];
  const exportedFunctions = new Map();
  const valueTypes = new Map([[0x7f, "i32"], [0x7e, "i64"], [0x7d, "f32"], [0x7c, "f64"], [0x70, "funcref"], [0x6f, "externref"]]);
  const uleb = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 0x7f) * (2 ** shift); shift += 7; } while (byte & 0x80);
    return value;
  };
  const name = () => { const size = uleb(); const value = new TextDecoder().decode(bytes.subarray(offset, offset + size)); offset += size; return value; };
  const limits = () => { const flags = uleb(); uleb(); if (flags & 1) uleb(); };
  const vector = (read) => { const count = uleb(); return Array.from({ length: count }, read); };

  while (offset < bytes.length) {
    const id = bytes[offset++];
    const size = uleb();
    const end = offset + size;
    if (id === 1) {
      for (const _ of vector(() => 0)) {
        if (bytes[offset++] !== 0x60) throw new Error("Unsupported Wasm export function type");
        const params = vector(() => valueTypes.get(bytes[offset++]) || "?");
        const results = vector(() => valueTypes.get(bytes[offset++]) || "?");
        types.push({ params, results });
      }
    } else if (id === 2) {
      for (const _ of vector(() => 0)) {
        name(); name();
        const kind = bytes[offset++];
        if (kind === 0) importedTypes.push(uleb());
        else if (kind === 1) { offset++; limits(); }
        else if (kind === 2) limits();
        else if (kind === 3) offset += 2;
        else if (kind === 4) { uleb(); uleb(); }
        else throw new Error(`Unsupported Wasm import kind ${kind}`);
      }
    } else if (id === 3) {
      definedTypes.push(...vector(() => uleb()));
    } else if (id === 7) {
      for (const _ of vector(() => 0)) {
        const exportName = name();
        const kind = bytes[offset++];
        const index = uleb();
        if (kind === 0) exportedFunctions.set(exportName, index);
      }
    }
    offset = end;
  }

  const signatures = new Map();
  for (const [exportName, index] of exportedFunctions) {
    const typeIndex = index < importedTypes.length ? importedTypes[index] : definedTypes[index - importedTypes.length];
    const type = types[typeIndex];
    if (type) signatures.set(exportName, `${type.results[0] || "void"}(${type.params.join(", ")})`);
  }
  return signatures;
}

