import type { HostToWebviewMessage, WebviewToHostMessage } from '../../../src/protocol/messages';
import type { BlockExportPayload, BlockExportResult } from '../../../src/protocol/blockExport';

export function createBlockExportAdapter(post: (message: WebviewToHostMessage) => void,
  render: (payload: BlockExportPayload, signal: AbortSignal) => Promise<readonly BlockExportResult[]>) {
  const pending = new Map<string, AbortController>();
  let disposed = false;
  return {
    accept(message: HostToWebviewMessage) {
      if (message.type === 'cancelBlockExport') { pending.get(message.requestId)?.abort(); return true; }
      if (message.type !== 'requestBlockExport') return false;
      if (disposed || pending.has(message.requestId)) return true;
      const controller = new AbortController(); pending.set(message.requestId, controller);
      void render(message.payload, controller.signal).then(value => {
        if (!disposed) post({ type: 'blockExportResult', requestId: message.requestId, result: { ok: true, value } });
      }, error => {
        if (!disposed) post({ type: 'blockExportResult', requestId: message.requestId,
          result: { ok: false, error: { code: 'operation-failed', message: String(error) } } });
      }).finally(() => pending.delete(message.requestId));
      return true;
    },
    dispose() { disposed = true; for (const controller of pending.values()) controller.abort(); pending.clear(); }
  };
}
