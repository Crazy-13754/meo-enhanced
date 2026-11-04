import { DomUtils, parseDocument } from 'htmlparser2';
import type { ReadingSnapshot } from '../protocol/exportSnapshot';
import type { BlockExportPayload, BlockExportResult } from '../protocol/blockExport';

/** Uses markers emitted by the Markdown fence rule, including nested/duplicate fences. */
export async function materializeContributedBlocks(html: string, snapshot: ReadingSnapshot, target: BlockExportPayload['target'],
  render: (payload: BlockExportPayload) => Promise<readonly BlockExportResult[]>) {
  if (!snapshot.blockRenderers?.length) return { html, warnings: [] as string[] };
  const document = parseDocument(html, { decodeEntities: true });
  const elements = DomUtils.findAll(e => !!e.attribs['data-meo-export-language'], document.children);
  if (!elements.length) return { html, warnings: [] as string[] };
  if (elements.length > 1000) throw new Error('A single export supports up to 1000 contributed diagrams.');
  const blocks = elements.map((e, i) => ({ id: String(i), language: e.attribs['data-meo-export-language']!,
    text: Buffer.from(e.attribs['data-meo-export-source'] ?? '', 'base64').toString('utf8') }));
  const environment = snapshot.environment;
  const results = await render({ blocks, renderers: snapshot.blockRenderers, target, language: snapshot.uiLanguage,
    styles: DomUtils.findAll(e => e.name === 'style', document.children).map(e => DomUtils.textContent(e)).join('\n'),
    fontFamily: environment.editorFontFamily || 'system-ui', fontSize: environment.editorFontSizePx || 16,
    fontWeight: environment.liveFontWeight || '400', codeFontFamily: environment.previewCodeFontFamily || environment.editorFontFamily || 'monospace' });
  const byId = new Map(results.map(result => [result.id, result]));
  const warnings: string[] = [];
  for (const [index, element] of elements.entries()) {
    const result = byId.get(String(index));
    delete element.attribs['data-meo-export-language']; delete element.attribs['data-meo-export-source'];
    if (!result || 'error' in result) {
      const message = result && 'error' in result ? result.error : 'Missing diagram result';
      warnings.push(`${blocks[index]!.language} (${element.attribs['data-source-line'] ?? index + 1}): ${message}`);
      continue;
    }
    const { artifact } = result;
    // SVG stays in its own image document: CSS/IDs cannot leak into other graphs or the page.
    const data = artifact.kind === 'svg' ? Buffer.from(artifact.data, 'utf8').toString('base64') : artifact.data;
    const mime = artifact.kind === 'svg' ? 'image/svg+xml' : 'image/png';
    const image = parseDocument(`<div class="meo-export-contributed meo-export-graph" style="break-inside:avoid;margin:1em 0;text-align:center"><img alt="Diagram" src="data:${mime};base64,${data}" width="${artifact.width}" height="${artifact.height}" style="display:block;max-width:100%;height:auto;margin:auto" /></div>`).children[0]!;
    DomUtils.replaceElement(element, image);
  }
  return { html: DomUtils.getOuterHTML(document), warnings };
}
