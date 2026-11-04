import type { ExtensionFeaturesEvent, ExtensionFeaturesRequest, ExtensionFeaturesState } from '../../../src/protocol/extensionFeatures';
import type { UiLanguage } from '../../../src/foundation/uiLanguage';
import { createMenuSwitch } from './menuSwitch';
import { createRequestPrefix } from './requestIdentity';

/** Settings presentation and request correlation; activation and preferences belong to Host. */
export function createExtensionFeatureSettings(post: (request: ExtensionFeaturesRequest) => void, changed: () => void) {
  let state: ExtensionFeaturesState | undefined, revision = 0, failed = false, disposed = false, sequence = 0;
  const pending = new Map<string, { id?: string; timer: ReturnType<typeof setTimeout> }>();
  const session = createRequestPrefix();
  const notify = () => { revision++; changed(); };
  const request = (action: { action: 'get' | 'openDetails' } | { action: 'setEnabled'; id: string; enabled: boolean }) => {
    if (disposed) return;
    const requestId = `extra-${session}-${sequence++}`;
    const timer = setTimeout(() => { pending.delete(requestId); failed = true; notify(); }, 15000);
    pending.set(requestId, { timer, id: action.action === 'setEnabled' ? action.id : undefined });
    failed = false; notify();
    try { post({ type: 'extensionFeaturesRequest', requestId, ...action }); }
    catch { clearTimeout(timer); pending.delete(requestId); failed = true; notify(); }
  };
  const node = (tag: string, className: string, text = '') => { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; };
  const matches = (query: string, ...texts: (string | undefined)[]) => query.split(/\s+/).filter(Boolean).every(term => texts.join(' ').toLowerCase().includes(term.toLowerCase()));
  return {
    revision: () => revision,
    count: (query: string) => matches(query, '扩展 功能 安装 开关 MEO Extras extensions features install enable disable', ...state?.features.flatMap(f => [f.label, f.labelZh, f.description, f.descriptionZh]) ?? []) ? 1 : 0,
    refresh() { request({ action: 'get' }); },
    accept(event: ExtensionFeaturesEvent) {
      if (disposed) return;
      if (event.type === 'extensionFeaturesResult') {
        const operation = pending.get(event.requestId); if (!operation) return;
        clearTimeout(operation.timer); pending.delete(event.requestId); failed = event.failed;
      }
      state = event.state; notify();
    },
    render(language: UiLanguage, query: string) {
      const t = (zh: string, en: string) => language === 'zh-CN' ? zh : en;
      const section = node('section', 'settings-section'); section.id = 'meo-settings-extras';
      const row = node('div', 'settings-item'); const text = node('div', 'settings-item-text');
      const heading = node('h3', 'settings-section-title', 'MEO Extras');
      const titleRow = node('div', 'settings-extension-heading');
      titleRow.append(heading, node('span', 'settings-extension-version', state?.installed ? state.version : state ? t('未安装', 'Not installed') : t('正在读取…', 'Loading…')));
      text.append(titleRow);
      text.append(node('p', 'settings-description', state?.installed
        ? t('为编辑器提供可选功能，独立开关对所有文档生效。', 'Optional editor features, with individual switches that apply to all documents.')
        : t('为编辑器提供可选功能。尚未发布到扩展市场。', 'Optional editor features. Not yet published to the Marketplace.')));
      const install = document.createElement('button'); install.type = 'button'; install.className = 'settings-button';
      install.textContent = state?.installed ? t('使用说明', 'User guide') : t('尚未发布', 'Not published');
      install.disabled = !state?.installed;
      install.addEventListener('click', () => request({ action: 'openDetails' }));
      row.append(text, install); section.append(row);
      for (const feature of state?.installed ? state.features : []) {
        if (!matches(query, '扩展 功能 MEO Extras extensions features', feature.id, feature.label, feature.labelZh, feature.description, feature.descriptionZh)) continue;
        const title = language === 'zh-CN' ? feature.labelZh ?? feature.label : feature.label;
        const description = language === 'zh-CN' ? feature.descriptionZh ?? feature.description : feature.description;
        const item = node('div', 'settings-item'); item.dataset.extraFeature = feature.id;
        item.dataset.featureOrder = String(feature.orderId ?? '');
        const words = node('div', 'settings-item-text'); words.append(node('div', 'settings-item-title', title));
        if (description) words.append(node('p', 'settings-description', description));
        if (feature.failed) words.append(node('p', 'settings-description', feature.enabled
          ? t('启用失败，可关闭后重试；其他功能不受影响。', 'Activation failed. Turn off and on to retry; other features are unaffected.')
          : t('关闭时未能完全释放资源，请重新加载窗口。', 'Some resources could not be released. Reload the window.')));
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'settings-switch'; toggle.setAttribute('role', 'switch');
        toggle.setAttribute('aria-label', title); toggle.setAttribute('aria-checked', String(feature.enabled)); toggle.append(createMenuSwitch());
        toggle.disabled = [...pending.values()].some(operation => operation.id === feature.id);
        toggle.addEventListener('click', () => request({ action: 'setEnabled', id: feature.id, enabled: !feature.enabled }));
        item.append(words, toggle); section.append(item);
      }
      const unavailable = state?.installed && !state.features.length;
      if (failed || unavailable) {
        const error = node('p', 'settings-description', unavailable
          ? t('功能尚未就绪。可先刷新；若仍无功能，请重新加载窗口并检查扩展是否启用。', 'Features are not ready. Refresh first; if none appear, reload the window and check that the extension is enabled.')
          : t('操作未完成，请重试。', 'The operation did not complete. Please retry.')); error.setAttribute('role', 'status');
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'settings-button'; retry.textContent = t('刷新', 'Refresh'); retry.addEventListener('click', () => request({ action: 'get' }));
        section.append(error, retry);
      }
      return section;
    },
    dispose() { disposed = true; for (const operation of pending.values()) clearTimeout(operation.timer); pending.clear(); }
  };
}
