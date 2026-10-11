import type { PreviewPresetAction, PreviewPresetRequest, PreviewPresetResponse } from '../../../src/protocol/previewPresets';

export function createPreviewPresetTransport(post: (request: PreviewPresetRequest) => void) {
  const session = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
  let counter = 0;
  let disposed = false;
  const pending = new Map<string, { resolve: (result: PreviewPresetResponse['result']) => void; timer: ReturnType<typeof setTimeout> }>();
  const failure = (message: string): PreviewPresetResponse['result'] => ({ ok: false, error: { code: 'operation-failed', message } });
  return {
    request(action: PreviewPresetAction): Promise<PreviewPresetResponse['result']> {
      if (disposed) return Promise.resolve(failure('Preset settings are closed.'));
      const requestId = `preview-preset-${session}-${counter++}`;
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          pending.delete(requestId); resolve({ ok: false, error: { code: 'timeout', message: 'Preset operation timed out.' } });
        }, action.action === 'setEnabled' || action.action === 'guide' ? 15000 : 120000);
        pending.set(requestId, { resolve, timer });
        try { post({ ...action, type: 'previewPresetRequest', requestId }); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); resolve(failure(String(error))); }
      });
    },
    accept(response: PreviewPresetResponse) {
      const request = pending.get(response.requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(response.requestId); request.resolve(response.result);
    },
    dispose() {
      disposed = true;
      for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(failure('Preset settings are closed.')); }
      pending.clear();
    }
  };
}
