import { isRecord } from './compiler/protocol';
import type { Session } from './model';
import { session } from './persistence';

/** Shared links include editing inputs, never execution or generated files. */
export function encodeShare(value: Session): string {
  const text = JSON.stringify({
    version: 2,
    source: value.source,
    options: value.options
  });
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function decodeShare(value: string): Session {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid Fortitudo share link.');
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const decoded: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  );
  const saved = isRecord(decoded)
    ? session({
        version: decoded.version,
        source: decoded.source,
        options: decoded.options,
        layout: null,
        outputs: { primary: 'assembly', comparison: 'optimized' },
        timeout: 10000
      })
    : null;
  if (!saved) {
    throw new Error('Invalid Fortitudo share link.');
  }
  return saved;
}
