import * as vscode from 'vscode';
import type { DocumentViewsApi } from '../documentViews';
import { decodeExtensionFeaturesRequest, decodeExtensionFeaturesEvent, type ExtensionFeaturesState, type ExtraFeature } from '../protocol/extensionFeatures';
import { decodeReadyMessage } from '../protocol/readyInit';

const extrasId = 'huangko555.meo-extras';
const setting = 'disabledExtraFeatures';
/** Host owns persistent choices and activation; the companion owns each feature's resources. */
export function createExtensionFeatures() {
  const records = new Map<string, { feature: Omit<ExtraFeature, 'enabled' | 'active' | 'failed'>; activate(): { dispose(): void }; owned?: { dispose(): void }; failed: boolean; enabled?: boolean }>();
  const changed = new vscode.EventEmitter<void>();
  const disabled = () => new Set(vscode.workspace.getConfiguration('meoEnhanced').get<readonly string[]>(setting, []));
  const reconcile = () => {
    const off = disabled();
    for (const record of records.values()) {
      const enabled = !off.has(record.feature.id);
      if (record.enabled === enabled) continue;
      record.enabled = enabled;
      if (!enabled) {
        const owned = record.owned; record.owned = undefined;
        try { owned?.dispose(); record.failed = false; } catch (error) { record.failed = true; console.error('Extra feature disposal failed', error); }
      } else if (!record.owned) {
        try { record.owned = record.activate(); record.failed = false; } catch (error) { record.failed = true; console.error('Extra feature activation failed', error); }
      }
    }
    changed.fire();
  };
  const registerFeature: NonNullable<DocumentViewsApi['registerFeature']> = (extensionId, feature, activate) => {
    if (extensionId.toLowerCase() !== extrasId || !vscode.extensions.getExtension(extrasId)
      || !decodeExtensionFeaturesEvent({ type: 'extensionFeaturesChanged', state: { installed: true, version: '', features: [{ ...feature, enabled: true, active: false, failed: false }] } })
      || records.has(feature.id) || typeof activate !== 'function') throw new Error('Invalid extra feature registration');
    const record = { feature, activate, failed: false, owned: undefined as { dispose(): void } | undefined };
    records.set(feature.id, record); reconcile();
    return new vscode.Disposable(() => { if (records.get(feature.id) !== record) return; records.delete(feature.id);
      try { record.owned?.dispose(); } catch (error) { console.error('Extra feature disposal failed', error); }
      changed.fire(); });
  };
  const state = (): ExtensionFeaturesState => {
    const extension = vscode.extensions.getExtension(extrasId), off = disabled();
    return { installed: !!extension, version: extension?.packageJSON.version ?? '', features: [...records.values()].sort((a, b) => (a.feature.orderId ?? Number.MAX_SAFE_INTEGER) - (b.feature.orderId ?? Number.MAX_SAFE_INTEGER) || a.feature.id.localeCompare(b.feature.id, 'en')).map(record => ({ ...record.feature,
      enabled: !off.has(record.feature.id), active: !!record.owned, failed: record.failed })) };
  };
  // Serialize writes from editor panels sharing this extension host.
  let queue = Promise.resolve();
  const update = (id: string, enabled: boolean) => {
    const operation = queue.then(async () => {
      if (!records.has(id)) throw new Error('Unknown extra feature');
      const values = disabled(); enabled ? values.delete(id) : values.add(id);
      await vscode.workspace.getConfiguration('meoEnhanced').update(setting, [...values], vscode.ConfigurationTarget.Global);
      reconcile();
    });
    queue = operation.catch(() => {}); return operation;
  };
  const configuration = vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration(`meoEnhanced.${setting}`)) reconcile(); });
  const extensions = vscode.extensions.onDidChange(() => changed.fire());
  function attach(panel: vscode.WebviewPanel, ensureInit: () => Promise<void>) {
    let ready = false, disposed = false;
    const publish = async () => { if (!ready || disposed) return; await ensureInit(); if (!disposed) await panel.webview.postMessage({ type: 'extensionFeaturesChanged', state: state() }); };
    const subscriptions = [changed.event(() => { void publish().catch(console.error); }), panel.webview.onDidReceiveMessage(raw => {
      if (decodeReadyMessage(raw)) { ready = true; void publish().catch(console.error); return; }
      const request = decodeExtensionFeaturesRequest(raw); if (!request) return;
      void (async () => {
        let failed = false;
        try {
          if (request.action === 'setEnabled') await update(request.id, request.enabled);
          if (request.action === 'openDetails') {
            if (!vscode.extensions.getExtension(extrasId)) throw new Error('MEO Extras is not installed');
            await vscode.commands.executeCommand('extension.open', extrasId);
          }
        }
        catch (error) { failed = true; console.error('Extra feature setting failed', error); }
        await ensureInit();
        if (!disposed) await panel.webview.postMessage({ type: 'extensionFeaturesResult', requestId: request.requestId, state: state(), failed });
      })().catch(console.error);
    })];
    const disposal = panel.onDidDispose(() => { disposed = true; subscriptions.forEach(subscription => subscription.dispose()); disposal.dispose(); });
  }
  return { registerFeature, attach, state, dispose() { configuration.dispose(); extensions.dispose(); for (const record of records.values()) { try { record.owned?.dispose(); } catch (error) { console.error('Extra feature disposal failed', error); } } records.clear(); changed.dispose(); } };
}
