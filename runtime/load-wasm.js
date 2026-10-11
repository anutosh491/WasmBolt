// Large compiler binaries can be split into static assets for Pages' file limit.
const read = (response, compile) => compile
  ? WebAssembly.compileStreaming(new Response(response.body, {
      headers: { 'Content-Type': 'application/wasm' },
    })) : response.arrayBuffer();

async function loadAsset(url, compile = false) {
  const manifest = await fetch(`${url}.parts.json`);
  if (manifest.status === 404) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Wasm download failed (${response.status})`);
    return read(response, compile);
  }
  if (!manifest.ok) throw new Error(`Wasm manifest failed (${manifest.status})`);
  const parts = await manifest.json();
  if (!Array.isArray(parts) || !parts.length ||
      parts.some(name => typeof name !== 'string' || !/^[\w.+-]+$/.test(name) || name === '.' || name === '..'))
    throw new Error('Invalid Wasm download manifest');
  // Large payloads can exceed the browser's automatic HTTP cache limits.
  // Only content-hashed assets are safe to retain across deployments.
  const cache = parts.every(name => /\.[a-f0-9]{16}$/.test(name))
    ? await globalThis.caches?.open('wasmbolt-build-assets').catch(() => null) : null;
  const urls = parts.map(name => new URL(name, url).href);
  if (cache) {
    const prefix = new URL(url).href;
    for (const entry of await cache.keys().catch(() => []))
      if (entry.url.startsWith(prefix + '.') && !urls.includes(entry.url))
        await cache.delete(entry);
  }
  const streaming = compile && parts.length === 1;
  const buffers = await Promise.all(parts.map(async name => {
    const partUrl = new URL(name, url);
    const stored = await cache?.match(partUrl).catch(() => null);
    if (stored) return read(stored, streaming);
    const response = await fetch(partUrl);
    if (!response.ok) throw new Error(`Wasm part failed (${response.status})`);
    const storedResponse = cache && cache.put(partUrl, response.clone()).catch(() => {});
    const [buffer] = await Promise.all([read(response, streaming), storedResponse]);
    return buffer;
  }));
  if (streaming) return buffers[0];
  const bytes = await new Blob(buffers).arrayBuffer();
  return compile ? WebAssembly.compile(bytes) : bytes;
}
export const downloadWasm = url => loadAsset(url);
export const compileWasm = url => loadAsset(url, true);
