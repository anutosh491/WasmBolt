// Large compiler binaries can be split into static assets for Pages' file limit.
export async function downloadWasm(url) {
  const manifest = await fetch(`${url}.parts.json`);
  if (manifest.status === 404) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Wasm download failed (${response.status})`);
    return response.arrayBuffer();
  }
  if (!manifest.ok) throw new Error(`Wasm manifest failed (${manifest.status})`);
  const parts = await manifest.json();
  if (!Array.isArray(parts) || !parts.length ||
      parts.some(name => typeof name !== 'string' || !/^[\w.-]+$/.test(name)))
    throw new Error('Invalid Wasm download manifest');
  const buffers = await Promise.all(parts.map(async name => {
    const response = await fetch(new URL(name, url));
    if (!response.ok) throw new Error(`Wasm part failed (${response.status})`);
    return response.arrayBuffer();
  }));
  return new Blob(buffers).arrayBuffer();
}
export async function compileWasm(url) {
  return WebAssembly.compile(await downloadWasm(url));
}
