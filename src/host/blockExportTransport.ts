import type { BlockExportPayload, BlockExportRequest, BlockExportResponse, BlockExportResult } from '../protocol/blockExport';

export function createBlockExportTransport(post: (message: BlockExportRequest) => Promise<boolean>) {
  let sequence = 0, closed = false;
  const pending = new Map<string, { resolve(value: readonly BlockExportResult[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function fail(id: string, message: string) {
    const job = pending.get(id); if (!job) return;
    pending.delete(id); clearTimeout(job.timer); job.reject(new Error(message));
    void post({ type: 'cancelBlockExport', requestId: id }).catch(() => {});
  }
  return {
    request(payload: BlockExportPayload): Promise<readonly BlockExportResult[]> {
      if (closed) return Promise.reject(new Error('The editor was closed before export completed.'));
      const requestId = `block-export-${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(requestId, 'Diagram export timed out.'), Math.min(300_000, 20_000 + payload.blocks.length * 20_000));
        pending.set(requestId, { resolve, reject, timer });
        void post({ type: 'requestBlockExport', requestId, payload }).then(ok => {
          if (!ok) fail(requestId, 'The editor is unavailable for diagram export.');
        }, error => fail(requestId, String(error)));
      });
    },
    accept(message: BlockExportResponse) {
      const job = pending.get(message.requestId); if (!job) return false;
      pending.delete(message.requestId); clearTimeout(job.timer);
      if (message.result.ok) job.resolve(message.result.value); else job.reject(new Error(message.result.error.message));
      return true;
    },
    close() { closed = true; for (const id of pending.keys()) fail(id, 'The editor was closed before export completed.'); }
  };
}
