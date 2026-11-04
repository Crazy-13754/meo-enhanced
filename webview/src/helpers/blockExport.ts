import type { DocumentBlockExportArtifact, DocumentBlockExportRenderer, DocumentViewModule } from '../../../src/documentViews';
import { isBlockExportArtifact, type BlockExportPayload, type BlockExportResult } from '../../../src/protocol/blockExport';
import { documentContentStyles } from '../documentContentStyles';
import { cloneRenderedElement } from './renderedBlockImage';
import { applyDocumentViewPalette } from './uiTheme';

/** Static SVG must be self-contained. Preserve safe foreignObject labels used by Markmap. */
export function validateExportArtifact(artifact: DocumentBlockExportArtifact): DocumentBlockExportArtifact {
  if (!isBlockExportArtifact(artifact)) throw new Error('Invalid diagram artifact or dimensions');
  if (artifact.kind === 'png') return artifact;
  const doc = new DOMParser().parseFromString(artifact.data, 'image/svg+xml');
  if (doc.documentElement.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Invalid diagram SVG');
  for (const element of doc.querySelectorAll('*')) {
    if (['script', 'iframe', 'object', 'embed', 'image', 'audio', 'video', 'link', 'animate', 'set', 'a'].includes(element.localName.toLowerCase())) throw new Error('Diagram SVG contains active or external content');
    for (const attr of element.attributes) {
      if (/^on/i.test(attr.name) || /^(?:href|xlink:href|src)$/i.test(attr.name) && !attr.value.startsWith('#')
        || /url\(\s*['"]?(?!#)[^)'"\s]/i.test(attr.value)) throw new Error('Diagram SVG contains external resources');
    }
    if (element.localName === 'style' && /@import|url\(\s*['"]?(?!#)[^)'"\s]/i.test(element.textContent ?? '')) throw new Error('Diagram SVG contains external styles');
  }
  return artifact;
}

export function captureExportSvg(source: SVGSVGElement): DocumentBlockExportArtifact {
  const original = source.querySelector<SVGGElement>('[data-meo-image-content]');
  const box = original?.getBBox() ?? source.getBBox();
  const clone = cloneRenderedElement(source);
  const group = clone.querySelector<SVGGElement>('[data-meo-image-content]');
  group?.removeAttribute('transform'); if (group) group.style.transform = 'none';
  const padding = 8, width = box.width + padding * 2, height = box.height + padding * 2;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${box.x - padding} ${box.y - padding} ${width} ${height}`);
  clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height));
  Object.assign(clone.style, { width: `${width}px`, height: `${height}px`, maxWidth: 'none', maxHeight: 'none', transform: 'none', overflow: 'visible' });
  clone.querySelectorAll('.markmap-highlight').forEach(node => node.remove());
  return validateExportArtifact({ kind: 'svg', data: new XMLSerializer().serializeToString(clone), width, height });
}

function bounded<T>(task: Promise<T>, signal: AbortSignal, ms = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error('Diagram export cancelled')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Diagram rendering timed out')); }, ms);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Full-document export owns its rendering environment; it never reads visible block instances. */
export async function renderExportBlocks(payload: BlockExportPayload, renderContent: (text: string) => Promise<{ html: string }>,
  signal: AbortSignal, load: (uri: string) => Promise<DocumentViewModule> = uri => import(uri)): Promise<BlockExportResult[]> {
  const frame = document.createElement('iframe');
  const svgRenderers = new Map<string, ReturnType<NonNullable<DocumentViewModule['createSvgRenderer']>>>();
  frame.setAttribute('sandbox', 'allow-same-origin'); frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1000px;height:800px;pointer-events:none';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    doc.open(); doc.write('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; font-src data:"></head><body><div class="meo-export-page"><main class="meo-export-doc"><div class="meo-export-graph"><div class="meo-contributed-canvas"></div></div></main></div></body></html>'); doc.close();
    doc.documentElement.dataset.meoExportTarget = payload.target; doc.body.dataset.meoExportTarget = payload.target;
    const sheet = doc.createElement('style'); sheet.textContent = payload.styles + '\n' + documentContentStyles; doc.head.append(sheet);
    const container = doc.querySelector<HTMLElement>('.meo-contributed-canvas')!;
    container.style.cssText = 'position:relative;width:1000px;height:800px';
    const computed = frame.contentWindow!.getComputedStyle(doc.querySelector('.meo-export-doc')!);
    const surface = frame.contentWindow!.getComputedStyle(doc.querySelector('.meo-export-graph')!);
    const background = surface.backgroundColor === 'rgba(0, 0, 0, 0)' || surface.backgroundColor === 'transparent'
      ? frame.contentWindow!.getComputedStyle(doc.body).backgroundColor : surface.backgroundColor;
    applyDocumentViewPalette(container, { background, foreground: computed.color });
    for (const [name, value] of Object.entries({ 'font-family': payload.fontFamily, 'font-size': `${payload.fontSize}px`, 'font-weight': payload.fontWeight, 'code-font-family': payload.codeFontFamily })) container.style.setProperty('--meo-view-' + name, value);
    // Shared palette resolves modern CSS color() / color-mix() to the RGB contract used by engines.
    const resolved = frame.contentWindow!.getComputedStyle(container);
    const exportBackground = resolved.getPropertyValue('--meo-view-background').trim();
    const exportForeground = resolved.getPropertyValue('--meo-view-foreground').trim();
    const rgb = exportBackground.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
    const appearance = { language: payload.language, fontFamily: payload.fontFamily, fontSize: payload.fontSize,
      foreground: exportForeground, background: exportBackground, dark: rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722 < 140 };
    const results: BlockExportResult[] = [];
    let artifactCharacters = 0;
    const modules = new Map<string, Promise<DocumentViewModule>>();
    // Hold SVG renderers through the batch so their worker remains warm. Custom layout adapters own one block.
    for (const [revision, block] of payload.blocks.entries()) {
      if (signal.aborted) throw new Error('Diagram export cancelled');
      const owner = payload.renderers.find(view => view.codeBlockLanguages?.includes(block.language));
      let renderer: DocumentBlockExportRenderer | undefined;
      const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
      try {
        if (!owner) throw new Error('Diagram renderer unavailable');
        let modulePromise = modules.get(owner.entryUri);
        if (!modulePromise) { modulePromise = load(owner.entryUri); modules.set(owner.entryUri, modulePromise); }
        const module = await bounded(modulePromise, controller.signal);
        if (module.apiVersion !== 1) throw new Error('Unsupported diagram renderer version');
        const snapshot = { text: block.text, language: block.language, revision };
        let artifact: DocumentBlockExportArtifact;
        if (module.createBlockExportRenderer) {
          renderer = module.createBlockExportRenderer({ container, appearance, signal: controller.signal, contentClass: 'meo-document-content',
            renderContent: value => bounded(renderContent(value.text), controller.signal), captureSvg: captureExportSvg });
          artifact = await bounded(renderer.render(snapshot), controller.signal);
        } else if (module.createSvgRenderer) {
          let svg = svgRenderers.get(owner.id);
          if (!svg) { svg = module.createSvgRenderer(); svgRenderers.set(owner.id, svg); }
          const data = await bounded(svg.render(snapshot, appearance), controller.signal);
          const root = new DOMParser().parseFromString(data, 'image/svg+xml').documentElement;
          const bounds = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
          artifact = { kind: 'svg', data, width: bounds?.[2] ?? parseFloat(root.getAttribute('width') ?? ''), height: bounds?.[3] ?? parseFloat(root.getAttribute('height') ?? '') };
        } else throw new Error('This renderer does not support static export');
        results.push({ id: block.id, artifact: validateExportArtifact(artifact) });
      } catch (error) {
        if (owner) {
          try { svgRenderers.get(owner.id)?.dispose(); } catch { /* Preserve the original rendering diagnostic. */ }
          svgRenderers.delete(owner.id);
        }
        results.push({ id: block.id, error: String(error).slice(0, 4000) });
      } finally {
        controller.abort(); signal.removeEventListener('abort', abort);
        try { renderer?.dispose(); } catch (error) {
          results[results.length - 1] = { id: block.id, error: String(error).slice(0, 4000) };
        } finally { container.replaceChildren(); }
      }
      const result = results.at(-1)!;
      if ('artifact' in result) artifactCharacters += result.artifact.data.length;
      if (artifactCharacters > 32_000_000) throw new Error('Diagram export exceeds the 32 MB artifact limit.');
    }
    if (signal.aborted) throw new Error('Diagram export cancelled');
    return results;
  } finally {
    for (const renderer of svgRenderers.values()) { try { renderer.dispose(); } catch { /* Other owners still need cleanup. */ } }
    frame.remove();
  }
}
