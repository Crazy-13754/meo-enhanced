import { UI_COLORS_TIMEOUT_MS, type UpdateUiColorsRequest, type UiColorsResult } from '../../../src/protocol/uiColors';

/** Correlated save acknowledgements; expired or duplicate replies cannot complete another save. */
export function createUiColorsTransport(post: (request: UpdateUiColorsRequest) => void) {
  const session = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
  let counter = 0;
  let disposed = false;
  const pending = new Map<string, { resolve: (result: UiColorsResult['result']) => void; timer: ReturnType<typeof setTimeout> }>();
  const failure = (message: string): UiColorsResult['result'] => ({ ok: false, error: { code: 'operation-failed', message } });
  return {
    update(colors: UpdateUiColorsRequest['colors']): Promise<UiColorsResult['result']> {
      if (disposed) return Promise.resolve(failure('Appearance settings are closed.'));
      const requestId = 'ui-colors-' + session + '-' + counter++;
      return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: { code: 'timeout', message: 'Appearance settings request timed out.' } }); }, UI_COLORS_TIMEOUT_MS);
        pending.set(requestId, { resolve, timer });
        try { post({ type: 'updateUiColors', requestId, colors }); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); resolve(failure(String(error))); }
      });
    },
    accept(response: UiColorsResult) {
      const request = pending.get(response.requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(response.requestId); request.resolve(response.result);
    },
    dispose() {
      disposed = true;
      for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(failure('Appearance settings are closed.')); }
      pending.clear();
    }
  };
}
