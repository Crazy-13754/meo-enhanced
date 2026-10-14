import { createRequestPrefix } from './requestIdentity';
import type { PreviewFontsRequest, PreviewFontsResponse } from '../../../src/protocol/previewFonts';
import type { PreviewFont } from '../../../src/foundation/previewFonts';

export function createPreviewFontsTransport(post: (request: PreviewFontsRequest) => void) {
  const prefix = createRequestPrefix();
  let sequence = 0;
  let disposed = false;
  const pending = new Map<string, { resolve: (fonts: readonly PreviewFont[] | null) => void; timer: ReturnType<typeof setTimeout> }>();
  return {
    request(refresh: boolean): Promise<readonly PreviewFont[] | null> {
      if (disposed) return Promise.resolve(null);
      const requestId = `${prefix}-${++sequence}`;
      return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(requestId); resolve(null); }, 12000);
        pending.set(requestId, { resolve, timer });
        try { post({ type: 'getPreviewFonts', requestId, refresh }); }
        catch { clearTimeout(timer); pending.delete(requestId); resolve(null); }
      });
    },
    accept(message: PreviewFontsResponse) {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId); clearTimeout(entry.timer);
      entry.resolve(message.result.ok ? message.result.value : null);
    },
    dispose() {
      disposed = true;
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(null); }
      pending.clear();
    }
  };
}
