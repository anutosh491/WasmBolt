import wabtFactory from 'wabt';

const features = {
  exceptions: true,
  mutable_globals: true,
  sat_float_to_int: true,
  sign_extension: true,
  simd: true,
  threads: true,
  function_references: true,
  multi_value: true,
  tail_call: true,
  bulk_memory: true,
  reference_types: true,
  annotations: true,
  code_metadata: true,
  gc: true,
  memory64: true,
  multi_memory: true,
  extended_const: true,
  relaxed_simd: true
};

/** Convert one binary with WABT's genuine WebAssembly text printer. */
export async function renderWat(data: Uint8Array): Promise<string> {
  const wabt = await wabtFactory();
  const module = wabt.readWasm(data.slice(), {
    ...features,
    readDebugNames: true
  });
  try {
    module.generateNames();
    module.applyNames();
    return module.toText({ foldExprs: false, inlineExport: true });
  } finally {
    module.destroy();
  }
}
