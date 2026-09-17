import type { Session } from './model';
import { decodeShare, encodeShare } from './sharing';

/** Hosts provide their own location; the shared workbench owns no routing. */
export interface ISharing {
  read(): Session | null;
  copy(session: Session): Promise<void>;
}

export function createSharing(location: URL): ISharing {
  let restored = false;
  return {
    read() {
      if (restored) {
        return null;
      }
      restored = true;
      const value = location.searchParams.get('fortitudo');
      return value === null ? null : decodeShare(value);
    },
    async copy(session) {
      const url = new URL(location.href);
      url.searchParams.set('fortitudo', encodeShare(session));
      await navigator.clipboard.writeText(url.href);
    }
  };
}
