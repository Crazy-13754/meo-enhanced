import { createElement, Code, Maximize2, X } from 'lucide';
import type { DocumentViewInstance, DocumentViewModule } from '../../src/documentViews';
import type { DocumentViewDescriptor } from '../../src/protocol/documentViews';
import type { DocumentBlockInput, DocumentBlocksPort } from './editor/documentBlocks';
import { createLoadingPresentation, loadingPresentationStyles } from './adapters/loadingPresentation';
import { documentContentStyles } from './documentContentStyles';
import { applyDocumentViewPalette } from './helpers/uiTheme';
import { createRenderedBlockImageButton, refreshRenderedBlockImageLabel } from './helpers/renderedBlockImage';
import { previewCodeSource } from './helpers/previewCodeSource';
import { getUiStrings, type UiLanguage } from './application/uiLanguage';

const styles = `
:host{display:block;position:relative;color:var(--meo-view-foreground);background:var(--meo-view-background)}
*{box-sizing:border-box} .meo-contributed-canvas{position:relative;height:360px;overflow:hidden;background:var(--meo-view-background);color:var(--meo-view-foreground)}
.meo-contributed-content{position:absolute;inset:0} .meo-contributed-content[data-static]{pointer-events:none}
.bar{position:absolute;top:4px;right:6px;display:flex;gap:4px;align-items:center;z-index:2;background:var(--meo-ui-surface);color:var(--meo-ui-text);border-radius:5px;padding:3px}
.language{position:absolute;top:8px;left:10px;z-index:2;font:12px system-ui;color:var(--meo-view-muted-foreground)}
button,.meo-copy-image-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:4px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
button:hover,.meo-copy-image-btn:hover{background:var(--meo-ui-surface-hover)} button:focus-visible,.meo-copy-image-btn:focus-visible{outline:2px solid var(--meo-ui-focus)}
button:disabled,[aria-disabled=true]{opacity:.4;cursor:default}.bar svg{width:16px;height:16px}
${loadingPresentationStyles}
.surface-loading{color:var(--meo-view-foreground);background:var(--meo-view-background);font-family:system-ui;--meo-ui-focus:var(--meo-view-focus)}
[hidden]{display:none!important}
.failure{padding:50px 16px;font:13px system-ui;white-space:pre-wrap;overflow:auto;height:100%}.meo-preview-action-status{font:12px system-ui}
`;

type Host = {
  renderContent(text: string): Promise<{ html: string }>;
  getLanguage(): UiLanguage;
  getState(): unknown;
  saveState(state: unknown): void;
};

/** Owns renderer loading, static blocks and the one fullscreen viewer across both reading surfaces. */
export function createDocumentBlocks(host: Host) {
  let views: readonly DocumentViewDescriptor[] = [];
  const modules = new Map<string, Promise<DocumentViewModule>>();
  const mounted = new Set<() => void>();
  const appearanceObserver = new MutationObserver(() => { for (const refresh of mounted) refresh(); });
  appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'lang', 'data-meo-ui-contrast'] });
  const memories = new Map<string, unknown>();
  const restored = host.getState();
  if (Array.isArray(restored)) for (const entry of restored.slice(-100)) {
    if (Array.isArray(entry) && typeof entry[0] === 'string') memories.set(entry[0], entry[1]);
  }
  let closeFullscreen: (() => void) | undefined;
  let previewDocument: Document | undefined, previewObserver: MutationObserver | undefined;
  const previewBlocks = new Map<HTMLElement, { source: string; element: HTMLElement; dispose(): void }>();
  const descriptor = (language: string) => views.find(view => view.codeBlockLanguages?.includes(language));
  const label = (view: DocumentViewDescriptor) => host.getLanguage() === 'zh-CN' ? view.labelZh ?? view.label : view.label;
  // Only identical authored blocks share viewing memory. Editing the source always wins.
  async function memoryKey(input: DocumentBlockInput, id: string) {
    const text = input.language + '\n' + input.text.replace(/\n$/, '');
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
    return `${id}:${input.line}:${text.length}:${a >>> 0}:${b >>> 0}`;
  }
  function save(key: string, state: unknown) {
    try {
      const json = JSON.stringify(state);
      if (!json || json.length > 32768) return;
      memories.delete(key); memories.set(key, JSON.parse(json));
      while (memories.size > 100) memories.delete(memories.keys().next().value!);
      host.saveState([...memories]);
    } catch { /* Viewing memory is optional; malformed extension state cannot break the editor. */ }
  }
  function appearance(surface: HTMLElement, owner: HTMLElement) {
    const doc = owner.ownerDocument, win = doc.defaultView!;
    const reading = doc.querySelector<HTMLElement>('.meo-export-doc') ?? document.body;
    const style = win.getComputedStyle(reading);
    const background = win.getComputedStyle(doc.body).backgroundColor;
    applyDocumentViewPalette(surface, { background, foreground: style.color });
    // Typography is always the ordinary document's, including in preset iframes.
    const root = getComputedStyle(document.documentElement);
    for (const role of ['surface', 'text', 'surface-hover', 'focus']) surface.style.setProperty('--meo-ui-' + role, root.getPropertyValue('--meo-ui-' + role));
    for (const [role, value] of Object.entries({
      'font-family': root.getPropertyValue('--meo-font-live') || root.getPropertyValue('--vscode-editor-font-family') || 'monospace',
      'font-size': root.getPropertyValue('--meo-user-editor-font-size') || root.getPropertyValue('--meo-font-live-size') || '16px',
      'font-weight': root.getPropertyValue('--meo-font-live-weight') || '400',
      'code-font-family': root.getPropertyValue('--meo-font-source') || 'monospace'
    })) surface.style.setProperty('--meo-view-' + role, value);
  }
  function button(doc: Document, icon: Parameters<typeof createElement>[0], title: string, run: () => void) {
    const button = doc.createElement('button'); button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
    button.append(doc.importNode(createElement(icon, { width: 16, height: 16 }), true));
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(); });
    return button;
  }
  function mount(container: HTMLElement, input: DocumentBlockInput, edit?: () => void, interactive = false,
    paletteOwner = container, controls?: HTMLElement) {
    const view = descriptor(input.language);
    if (!view) return { dispose() {} };
    const doc = container.ownerDocument;
    const element = doc.createElement('div'); element.className = 'meo-contributed-block';
    const shadow = element.attachShadow({ mode: 'open' });
    const sheet = doc.createElement('style'); sheet.textContent = styles + documentContentStyles;
    const canvas = doc.createElement('div'); canvas.className = 'meo-contributed-canvas';
    if (interactive) { element.style.height = '100%'; element.style.width = '100%'; canvas.style.height = '100%'; }
    const content = doc.createElement('div'); content.className = 'meo-contributed-content';
    if (!interactive) { content.dataset.static = ''; content.inert = true; }
    const loading = createLoadingPresentation('document-block-loading');
    const strings = getUiStrings(host.getLanguage());
    loading.setLabel(host.getLanguage() === 'zh-CN' ? '正在加载…' : 'Loading…');
    const toolbar = controls ?? doc.createElement('div'); if (!controls) toolbar.className = 'bar';
    const name = doc.createElement('span'); name.className = 'language'; name.textContent = input.language;
    canvas.append(content, loading.element); shadow.append(sheet, canvas);
    if (!interactive) {
      shadow.append(name, toolbar);
      if (edit) toolbar.append(button(doc, Code, host.getLanguage() === 'zh-CN' ? '编辑源码' : 'Edit source', edit));
    }
    container.append(element); appearance(element, paletteOwner);
    let disposed = false, instance: DocumentViewInstance | undefined, ready = false, failure: HTMLElement | undefined;
    let editButton: HTMLButtonElement | undefined;
    // The first control was added above to retain source/fullscreen/image ordering.
    if (edit) editButton = toolbar.querySelector('button') ?? undefined;
    const copy = !interactive ? createRenderedBlockImageButton(() => ready ? canvas : null, host.getLanguage(), doc) : null;
    if (copy) { copy.title = strings.copyImage; toolbar.append(copy); }
    const full = !interactive ? button(doc, Maximize2, strings.fullscreen, () => openFullscreen(input, full!, paletteOwner)) : null;
    if (full) { full.disabled = true; toolbar.append(full); }
    loading.begin(() => !disposed && element.isConnected, () => element.setAttribute('aria-busy', 'true'));
    void (async () => {
      let promise = modules.get(view.entryUri);
      if (!promise) { promise = import(view.entryUri); modules.set(view.entryUri, promise); }
      const [module, key] = await Promise.all([promise, memoryKey(input, view.id)]);
      if (disposed) return;
      if (module.apiVersion !== 1 || !module.mountBlock) throw new Error('The extension does not support code blocks');
      instance = module.mountBlock(content, {
        language: host.getLanguage(), contentClass: 'meo-document-content', interactive,
        viewState: interactive ? memories.get(key) : undefined,
        saveViewState: state => { if (interactive && !disposed) save(key, state); },
        renderContent: snapshot => host.renderContent(snapshot.text), revealLine() {},
        getAvailableViewport() { return { x: 16, y: 36, width: Math.max(0, content.clientWidth - 32), height: Math.max(0, content.clientHeight - (interactive ? 104 : 52)) }; }
      });
      await instance.update({ text: input.text, revision: 1 });
      if (disposed) return;
      ready = true; loading.finish(); element.removeAttribute('aria-busy');
      copy?.setAttribute('aria-disabled', 'false');
      if (full) full.disabled = false;
      if (interactive) for (const action of instance.actions ?? []) {
        const title = host.getLanguage() === 'zh-CN' ? action.labelZh ?? action.label : action.label;
        const control = doc.createElement('button'); control.type = 'button'; control.className = 'meo-visual-control-btn';
        control.title = title; control.setAttribute('aria-label', title);
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
        for (const d of action.iconPaths) { const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
        control.dataset.action = action.id;
        control.append(svg); control.onclick = () => { void Promise.resolve(action.run()).catch(console.error); }; toolbar.insertBefore(control, toolbar.lastElementChild);
      }
    })().catch(error => {
      if (disposed) return;
      console.error('Contributed block failed', error); loading.finish(); element.removeAttribute('aria-busy');
      modules.delete(view.entryUri);
      instance?.dispose(); instance = undefined;
      const fallback = doc.createElement('pre'); fallback.className = 'failure';
      failure = fallback;
      fallback.textContent = (host.getLanguage() === 'zh-CN' ? '渲染失败，源码保留如下：\n\n' : 'Rendering failed. Original source:\n\n') + input.text;
      content.replaceChildren(fallback);
    });
    const refresh = () => {
      appearance(element, paletteOwner); instance?.setLanguage?.(host.getLanguage());
      const language = host.getLanguage(), strings = getUiStrings(language);
      loading.setLabel(language === 'zh-CN' ? '正在加载…' : 'Loading…');
      if (failure) failure.textContent = (language === 'zh-CN' ? '渲染失败，源码保留如下：\n\n' : 'Rendering failed. Original source:\n\n') + input.text;
      for (const [control, title] of [[editButton, language === 'zh-CN' ? '编辑源码' : 'Edit source'], [full, strings.fullscreen]] as const) {
        if (control) { control.title = title; control.setAttribute('aria-label', title); }
      }
      if (copy) { refreshRenderedBlockImageLabel(copy, language); copy.title = strings.copyImage; }
      for (const control of toolbar.querySelectorAll<HTMLButtonElement>('[data-action]')) {
        const action = instance?.actions?.find(action => action.id === control.dataset.action);
        const title = action ? language === 'zh-CN' ? action.labelZh ?? action.label : action.label : strings.exitFullscreen;
        control.title = title; control.setAttribute('aria-label', title);
      }
    };
    mounted.add(refresh);
    return { dispose() { if (disposed) return; instance?.dispose(); disposed = true; loading.finish(); mounted.delete(refresh); element.remove(); } };
  }
  function openFullscreen(input: DocumentBlockInput, trigger: HTMLElement, paletteOwner: HTMLElement) {
    closeFullscreen?.();
    const overlay = document.createElement('div'); overlay.className = 'meo-mermaid-fullscreen-scrim';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', label(descriptor(input.language)!)); overlay.tabIndex = -1;
    const canvas = document.createElement('div'); canvas.className = 'meo-mermaid-fullscreen';
    const toolbar = document.createElement('div'); toolbar.className = 'meo-visual-controls meo-mermaid-fullscreen-controls';
    toolbar.style.cssText = 'top:auto;right:auto;bottom:16px;left:50%;transform:translateX(-50%);flex-wrap:nowrap';
    canvas.style.position = 'relative'; overlay.append(canvas, toolbar); document.body.append(overlay);
    const events = new AbortController();
    const close = () => { events.abort(); rendered.dispose(); overlay.remove(); closeFullscreen = undefined; trigger.focus({ preventScroll: true }); };
    closeFullscreen = close;
    const exit = button(document, X, getUiStrings(host.getLanguage()).exitFullscreen, close); exit.className = 'meo-visual-control-btn'; exit.dataset.action = 'close'; toolbar.append(exit);
    const rendered = mount(canvas, input, undefined, true, paletteOwner, toolbar);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === 'Tab') {
        const shadow = canvas.querySelector('.meo-contributed-block')?.shadowRoot;
        const targets = [...(shadow?.querySelectorAll<HTMLElement>('[tabindex="0"]') ?? []), ...toolbar.querySelectorAll<HTMLButtonElement>('button')];
        const active = shadow?.activeElement ?? document.activeElement;
        const index = targets.indexOf(active as HTMLElement);
        event.preventDefault(); targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus();
      }
    }, { capture: true, signal: events.signal });
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); }, { signal: events.signal });
    overlay.focus({ preventScroll: true });
  }
  function refreshPreview(doc: Document) {
    if (previewDocument !== doc) {
      previewObserver?.disconnect(); for (const block of previewBlocks.values()) block.dispose(); previewBlocks.clear();
      previewDocument = doc;
      let queued = false;
      previewObserver = new MutationObserver(() => {
        if (queued) return; queued = true;
        queueMicrotask(() => { queued = false; if (previewDocument === doc) refreshPreview(doc); });
      });
      previewObserver.observe(doc.body, { childList: true, subtree: true });
    }
    for (const [block, record] of previewBlocks) if (!block.isConnected || !record.element.isConnected) { record.dispose(); previewBlocks.delete(block); }
    if (doc.documentElement.dataset.meoPreviewRenderer === 'github-readme') return;
    for (const code of doc.querySelectorAll<HTMLElement>('pre > code')) {
      const source = previewCodeSource(code);
      const language = source?.language ?? [...code.classList].find(name => name.startsWith('language-'))?.slice(9) ?? '';
      if (!descriptor(language)) continue;
      const block = code.closest<HTMLElement>('.meo-export-code-block-wrap'); if (!block) continue;
      const lines = code.querySelectorAll('.meo-export-code-line-source');
      const text = source?.source ?? (lines.length ? [...lines].map(line => line.textContent ?? '').join('\n') : code.textContent ?? '');
      const previous = previewBlocks.get(block); if (previous?.source === text) continue;
      previous?.dispose(); previewBlocks.delete(block);
      const rect = block.getBoundingClientRect(); if (rect.bottom < -800 || rect.top > (doc.defaultView?.innerHeight ?? 1000) + 800) continue;
      const holder = doc.createElement('div'); block.append(holder);
      const originals = Array.from(block.children).filter(child => child !== holder) as HTMLElement[];
      const displays = originals.map(child => child.style.display); originals.forEach(child => { child.style.display = 'none'; });
      const rendered = mount(holder, { language, text, line: Number(block.dataset.sourceLine) || 1 });
      previewBlocks.set(block, { source: text, element: holder, dispose() { rendered.dispose(); holder.remove(); originals.forEach((child, i) => { child.style.display = displays[i]; }); } });
    }
  }
  const port: DocumentBlocksPort = { supports: language => !!descriptor(language), mount };
  return {
    port, refreshPreview,
    setViews(next: readonly DocumentViewDescriptor[]) {
      closeFullscreen?.(); views = next;
      for (const block of previewBlocks.values()) block.dispose(); previewBlocks.clear();
      if (previewDocument) refreshPreview(previewDocument);
    },
    refreshAppearance() { for (const refresh of mounted) refresh(); },
    closeFullscreen() { closeFullscreen?.(); },
    dispose() { closeFullscreen?.(); appearanceObserver.disconnect(); previewObserver?.disconnect(); previewDocument = undefined; for (const record of previewBlocks.values()) record.dispose(); previewBlocks.clear(); modules.clear(); }
  };
}
