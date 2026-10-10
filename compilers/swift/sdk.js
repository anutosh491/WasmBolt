// Extract regular SDK files only; preserve no archive links or parent paths.
export async function installSdk(FS) {
  const response = await fetch(new URL('./runtime.tar.gz', import.meta.url));
  if (!response.ok) throw new Error(`Swift SDK download failed (${response.status})`);
  const archive = new Uint8Array(await new Response(response.body.pipeThrough(
    new DecompressionStream('gzip'))).arrayBuffer());
  const decoder = new TextDecoder();
  const text = bytes => decoder.decode(bytes).replace(/\0.*$/s, '');
  let extendedPath = null;
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) return;
    const sizeText = text(header.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid SDK entry size');
    const size = parseInt(sizeText, 8);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    if (body.length !== size) throw new Error('Truncated Swift SDK');
    const type = header[156];
    if (type === 120) {
      extendedPath = text(body).match(/(?:^|\n)\d+ path=([^\n]+)/)?.[1] || null;
    } else {
      const name = extendedPath || [text(header.subarray(345, 500)),
        text(header.subarray(0, 100))].filter(Boolean).join('/');
      extendedPath = null;
      const parts = name.replace(/^\.\//, '').split('/').filter(Boolean);
      if (!parts.length || parts.some(part => part === '.' || part === '..'))
        throw new Error('Unsafe Swift SDK path');
      const path = '/' + parts.join('/');
      if (type === 0 || type === 48) {
        FS.mkdirTree(path.slice(0, path.lastIndexOf('/')) || '/');
        FS.writeFile(path, body);
      } else if (type === 53) FS.mkdirTree(path);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Swift SDK has no terminating block');
}
