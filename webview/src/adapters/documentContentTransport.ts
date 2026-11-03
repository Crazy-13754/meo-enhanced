import type { DocumentContentRequest, DocumentContentResponse, DocumentContentValue } from '../../../src/protocol/documentContent';

/** Requests are scoped to one mounted view. Closing rejects waiters and ignores late replies. */
export function createDocumentContentTransport(post: (request: DocumentContentRequest) => void, scope = 'content') {
  let counter = 0;
  const pending = new Map<string, { resolve(value: DocumentContentValue): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const cancel = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Document view closed')); }
    pending.clear();
  };
  return {
    render(text: string): Promise<DocumentContentValue> {
      const requestId = `${scope}-${Date.now()}-${counter++}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Document content rendering timed out')); }, 15_000);
        pending.set(requestId, { resolve, reject, timer });
        try { post({ type: 'requestDocumentContent', requestId, text }); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });
    },
    accept(response: DocumentContentResponse) {
      const item = pending.get(response.requestId); if (!item) return;
      pending.delete(response.requestId); clearTimeout(item.timer);
      if (response.result.ok) item.resolve(response.result.value);
      else item.reject(new Error(response.result.error.message));
    },
    cancel
  };
}
