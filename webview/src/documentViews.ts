import { createElement, FileText, X, Maximize2, Columns2, ArrowLeft, FileSearch } from 'lucide';
import type { DocumentViewInstance, DocumentViewModule } from '../../src/documentViews';
import type { DocumentViewDescriptor } from '../../src/protocol/documentViews';
import { documentViewStyles } from './documentViewStyles';
import { documentContentStyles } from './documentContentStyles';
import { createLoadingPresentation } from './adapters/loadingPresentation';
import { applyDocumentViewPalette, type DocumentSurfacePaletteInput } from './helpers/uiTheme';
import { graphCameraIcon } from './helpers/graphBlockControls';

type Host = {
  root: HTMLElement; editorSurface: HTMLElement; contentSurface: HTMLElement; entryContainer: HTMLElement;
  disableSidePreview(): void;
  renderContent?(text: string): Promise<{ html: string }>;
  cancelContent?(): void;
  getPalette(): DocumentSurfacePaletteInput;
  getText(): string; getReadingLine(): number; revealLine(line: number): void; preserveReading(): () => void; getLanguage(): string;
};

/** Fit the artwork, rather than its supplied whitespace, to the shared toolbar size. */
function fitEntryIcon(svg: SVGSVGElement, offset?: DocumentViewDescriptor['iconOffset']) {
  const bounds = svg.getBBox();
  const extent = Math.max(bounds.width, bounds.height);
  if (!Number.isFinite(extent) || extent <= 0) return;
  // A 20px box with 18px visible artwork, including the shared 1.5px stroke.
  const size = extent * 20 / (18 - 1.5);
  svg.setAttribute('viewBox', `${bounds.x + bounds.width / 2 - size / 2} ${bounds.y + bounds.height / 2 - size / 2} ${size} ${size}`);
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  for (const path of svg.querySelectorAll('path')) path.setAttribute('vector-effect', 'non-scaling-stroke');
  if (offset) svg.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
}

/** Owns the shared layout and document lifecycle. Renderers own only their canvas. */
export function mountDocumentViews(host: Host) {
  const t = (zh: string, en: string) => host.getLanguage().startsWith('zh') ? zh : en;
  const label = (v: { label: string; labelZh?: string }) => host.getLanguage().startsWith('zh') ? v.labelZh ?? v.label : v.label;
  const sheet = document.createElement('style'); sheet.textContent = documentViewStyles + documentContentStyles; document.head.append(sheet);
  const entries = document.createElement('span'); entries.style.display = 'contents'; host.entryContainer.prepend(entries);
  const panel = document.createElement('section'); panel.className = 'mm-view-panel'; panel.hidden = true; host.root.append(panel);
  const toolbar = document.createElement('div'); toolbar.className = 'document-view-toolbar'; toolbar.setAttribute('role', 'toolbar');
  const canvas = document.createElement('div'); canvas.className = 'mm-view-canvas'; panel.append(canvas, toolbar);
  const loading = createLoadingPresentation('document-view-loading'); panel.append(loading.element);
  // Contributed canvases own their gestures; suppressing pointerdown here would
  // also suppress the compatibility mouse events used by renderers such as D3.
  canvas.setAttribute('data-editor-focus-transfer', ''); canvas.tabIndex = -1;
  const original = { visibility: host.editorSurface.style.visibility, inert: host.editorSurface.inert };
  let views: readonly DocumentViewDescriptor[] = [];
  let active: DocumentViewDescriptor | undefined, side = false, disposed = false;
  let instance: DocumentViewInstance | undefined, generation = 0, transition = 0, revision = 0;
  let restoreReading = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, dirty = false;
  const modules = new Map<string, Promise<DocumentViewModule>>();
  let selectedLine: number | null = null;
  let locate: HTMLButtonElement | undefined;
  let actionButtons: HTMLButtonElement[] = [];
  let status: 'loading' | 'failure' | null = null;
  function presentStatus() {
    if (!status) return;
    if (status === 'loading') {
      loading.setLabel(t(`正在加载${active ? label(active) : '视图'}…`, `Loading ${active ? label(active) : 'view'}…`));
      return;
    }
    const message = document.createElement('p'); message.className = 'mm-view-empty';
    message.textContent = t('视图加载失败，请关闭后重新打开。', 'The view could not load. Close it and try again.');
    canvas.replaceChildren(message);
  }
  function finishLoading() {
    loading.finish(); panel.removeAttribute('aria-busy'); canvas.inert = false;
  }
  function refreshAppearance() {
    if (active && !disposed) applyDocumentViewPalette(panel, host.getPalette());
  }
  const alignment = document.createElement('div'); alignment.className = 'meo-preview-viewport-alignment'; alignment.hidden = true;
  const toView = button(t('按正文定位侧边视图', 'Locate in side view'), ArrowLeft, () => {
    if (!instance?.revealLine || running || dirty) return;
    void Promise.resolve(instance.revealLine(host.getReadingLine())).catch(console.error);
  });
  const toDocument = button(t('按所选内容定位正文', 'Locate selection in document'), ArrowLeft, () => {
    const line = selectedLine;
    if (line !== null) afterLayout(() => host.revealLine(line));
  });
  toView.dataset.meoAlignViewport = 'preview'; toDocument.dataset.meoAlignViewport = 'source';
  for (const control of [toView, toDocument]) {
    control.removeAttribute('title');
    control.dataset.tooltipLiveUpdate = 'true';
    control.className = 'format-button meo-preview-viewport-align-button';
    control.dataset.tooltipPlacement = 'left';
    control.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
  }
  alignment.append(toView, toDocument); panel.append(alignment);
  function updateAlignment() {
    alignment.hidden = !active || !side || !instance?.revealLine;
    toView.disabled = running || dirty || !instance?.revealLine;
    const viewHint = t('按正文定位侧边视图', 'Locate in side view');
    toView.dataset.tooltip = viewHint;
    toView.setAttribute('aria-label', viewHint);
    toDocument.disabled = running || dirty || selectedLine === null;
    const selectionHint = selectedLine === null ? t('请先选择', 'Select an item first') : t('按所选内容定位正文', 'Locate selection in document');
    toDocument.dataset.tooltip = selectionHint;
    toDocument.setAttribute('aria-label', selectionHint);
    if (locate) {
      locate.disabled = running || dirty || selectedLine === null;
      const hint = selectedLine === null ? t('先选择内容，再定位正文', 'Select an item to locate in the document') : t('在正文中查看', 'Show in document');
      locate.dataset.tooltip = hint; locate.setAttribute('aria-label', hint);
    }
    for (const action of actionButtons) action.disabled = running || dirty;
  }

  function button(title: string, icon: Parameters<typeof createElement>[0], run: () => void, text = false) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'format-button document-view-tool'; b.title = title; b.setAttribute('aria-label', title);
    b.append(createElement(icon, { width: 16, height: 16 }));
    if (text) { const span = document.createElement('span'); span.textContent = title; b.append(span); }
    b.addEventListener('click', run); return b;
  }
  function afterLayout(restore: () => void) {
    const current = ++transition;
    requestAnimationFrame(() => { if (!disposed && current === transition) restore(); });
  }
  function layout() {
    if (active) panel.setAttribute('aria-label', label(active));
    panel.hidden = !active; panel.classList.toggle('is-side', side);
    const parent = active && side ? host.contentSurface : host.root;
    if (panel.parentElement !== parent) parent.append(panel);
    host.contentSurface.toggleAttribute('data-document-view-side', !!active && side);
    host.editorSurface.style.visibility = active && !side ? 'hidden' : original.visibility;
    host.editorSurface.inert = !!active && !side || original.inert;
    for (const entry of entries.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = entry.dataset.viewId === active?.id;
      entry.classList.toggle('is-active', selected); entry.setAttribute('aria-pressed', String(selected));
    }
    renderToolbar();
    refreshAppearance();
    updateAlignment();
  }
  function close(restore = true) {
    if (!active) return;
    const id = active.id;
    if (side) restoreReading = host.preserveReading();
    ++generation; ++transition; clearTimeout(timer); dirty = false; running = false;
    host.cancelContent?.();
    finishLoading();
    try { instance?.dispose(); } catch (error) { console.error('Document view disposal failed', error); }
    instance = undefined; active = undefined; selectedLine = null; status = null; canvas.replaceChildren(); layout();
    if (restore) afterLayout(restoreReading);
    entries.querySelector<HTMLButtonElement>(`[data-view-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }
  function failure(error: unknown) {
    console.error('Document view failed', error);
    finishLoading();
    canvas.replaceChildren();
    renderToolbar();
    status = 'failure'; presentStatus();
  }
  async function flush() {
    if (!active || !instance || running || !dirty) return;
    const current = generation, target = instance;
    dirty = false; running = true; selectedLine = null; updateAlignment();
    try {
      await target.update({ text: host.getText(), revision: ++revision });
      if (status === 'loading' && current === generation) await new Promise(requestAnimationFrame);
    }
    catch (error) { if (current === generation) {
      try { target.dispose(); } catch (disposeError) { console.error('Document view disposal failed', disposeError); }
      instance = undefined; failure(error);
    } }
    finally { if (current === generation) {
      running = false; updateAlignment();
      if (dirty) void flush();
      else if (status === 'loading') { status = null; finishLoading(); }
    } }
  }
  function documentChanged() {
    if (!active) return;
    ++transition; dirty = true; selectedLine = null; updateAlignment(); clearTimeout(timer); timer = setTimeout(() => { void flush(); }, 180);
  }
  async function open(view: DocumentViewDescriptor, inSide = true) {
    if (disposed) return;
    const previousReading = active && !side ? restoreReading : host.preserveReading();
    if (active) close(false);
    restoreReading = previousReading; host.disableSidePreview();
    active = view; side = inSide; const current = ++generation;
    panel.setAttribute('aria-label', label(view)); layout();
    status = 'loading'; presentStatus();
    loading.begin(() => current === generation && !disposed && !!active, () => {
      panel.setAttribute('aria-busy', 'true'); canvas.inert = true;
    });
    if (side) afterLayout(restoreReading);
    try {
      let module = modules.get(view.entryUri);
      if (!module) { module = import(view.entryUri); modules.set(view.entryUri, module); }
      const renderer = await module;
      if (current !== generation || disposed) return;
      if (renderer.apiVersion !== 1 || typeof renderer.mount !== 'function') throw new Error('Unsupported document view API');
      canvas.replaceChildren();
      instance = renderer.mount(canvas, { language: host.getLanguage(), contentClass: 'meo-document-content',
        ...(host.renderContent ? { renderContent: async (snapshot: { text: string; revision: number }) => {
          if (disposed || current !== generation) throw new Error('Document view closed');
          const content = await host.renderContent!(snapshot.text);
          if (disposed || current !== generation) throw new Error('Document view closed');
          return content;
        } } : {}), getAvailableViewport() {
        if (disposed || current !== generation) return { x: 0, y: 0, width: 0, height: 0 };
        const bounds = canvas.getBoundingClientRect();
        const bottom = toolbar.hidden ? bounds.height : toolbar.getBoundingClientRect().top - bounds.top - 8;
        return { x: 0, y: 0, width: bounds.width, height: Math.max(0, Math.min(bounds.height, bottom)) };
      }, revealLine(line) {
        if (current !== generation || running || dirty || !Number.isInteger(line) || line < 1) return;
        revealDocumentLine(line);
      }, selectionChanged(line) {
        if (current !== generation) return;
        selectedLine = Number.isInteger(line) && line! > 0 ? line : null; updateAlignment();
      } });
      if (!instance || typeof instance.update !== 'function' || typeof instance.dispose !== 'function') throw new Error('Invalid document view instance');
      renderToolbar(); dirty = true; void flush();
    } catch (error) { modules.delete(view.entryUri); if (current === generation) failure(error); }
  }
  function revealDocumentLine(line: number) {
    if (!side) { side = true; layout(); }
    afterLayout(() => host.revealLine(line));
  }
  function renderToolbar() {
    toolbar.replaceChildren(); toolbar.hidden = !active; locate = undefined; actionButtons = [];
    if (!active) return;
    toolbar.setAttribute('aria-label', label(active));
    const separator = () => {
      const element = document.createElement('span'); element.className = 'document-view-tool-separator'; element.setAttribute('aria-hidden', 'true'); toolbar.append(element);
    };
    locate = button(t('在正文中查看', 'Show in document'), FileSearch, () => {
      if (selectedLine !== null) revealDocumentLine(selectedLine);
    });
    locate.dataset.viewAction = 'locate';
    const target = instance, current = generation;
    for (const action of target?.actions ?? []) {
      const control = button(label(action), graphCameraIcon(action.id) ?? action.iconPaths.map(d => ['path', { d }]), () => {
        void Promise.resolve().then(() => {
          if (current === generation && instance === target) return action.run();
        }).catch(error => console.error('Document view action failed', error));
      });
      if (action.id === 'fit') {
        const text = document.createElement('span'); text.textContent = t('适应', 'Fit'); control.append(text); control.classList.add('has-label');
      }
      control.dataset.viewAction = action.id; actionButtons.push(control); toolbar.append(control);
    }
    if (actionButtons.length) separator();
    const layoutButton = button(side ? t('全屏查看', 'Fullscreen') : t('左右分栏', 'Split view'), side ? Maximize2 : Columns2, () => {
      if (side) restoreReading = host.preserveReading();
      side = !side; layout(); if (side) afterLayout(restoreReading);
    });
    layoutButton.dataset.viewAction = 'layout';
    const closeButton = button(t('关闭', 'Close'), X, () => close()); closeButton.dataset.viewAction = 'close';
    toolbar.append(locate, layoutButton); separator(); toolbar.append(closeButton);
    for (const control of toolbar.querySelectorAll<HTMLButtonElement>('button')) {
      control.dataset.tooltip = control.title; control.dataset.tooltipPlacement = 'top'; control.dataset.tooltipLiveUpdate = 'true'; control.removeAttribute('title');
      control.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    }
    updateAlignment();
  }
  function setViews(next: readonly DocumentViewDescriptor[]) {
    if (active && !next.some(v => v.id === active!.id && v.entryUri === active!.entryUri)) close();
    views = next; entries.replaceChildren();
    for (const view of views) {
      const icon: Parameters<typeof createElement>[0] = view.iconPaths?.map(d => ['path', { d }]) ?? FileText;
      const entry = button(label(view), icon, () => { if (active?.id === view.id) close(); else void open(view); });
      entry.className = 'format-button document-view-entry mm-view-entry'; entry.dataset.viewId = view.id; entries.append(entry);
      fitEntryIcon(entry.querySelector<SVGSVGElement>('svg')!, view.iconOffset);
    }
    layout();
  }
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && active) { event.preventDefault(); close(); } };
  const onMode = (event: Event) => { if (!side && (event.target as Element).closest('button[data-mode]')) close(false); };
  document.addEventListener('keydown', onKey); host.root.addEventListener('click', onMode, true);
  const languageObserver = new MutationObserver(() => {
    try { instance?.setLanguage?.(host.getLanguage()); } catch (error) { console.error('Document view language update failed', error); }
    setViews(views); presentStatus();
  }); languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return { close, setViews, documentChanged, refreshAppearance, dispose() {
    close(false); disposed = true; ++transition; clearTimeout(timer); languageObserver.disconnect();
    document.removeEventListener('keydown', onKey); host.root.removeEventListener('click', onMode, true);
    entries.remove(); panel.remove(); sheet.remove(); modules.clear();
  } };
}
