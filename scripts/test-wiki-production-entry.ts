import { createEditor } from './test-editor-factory';
import { initializeImageHandling, refreshWikiImagePresentations, resolveImageSrc, setImageSrcResolver, settleImageSrcRequest } from '../webview/src/helpers/images';
import { bindTooltips } from '../webview/src/adapters/tooltip';
import { replaceWikiLinkStatuses } from '../webview/src/helpers/wikiLinks';

(window as any).WikiHarness = { createEditor, initializeImageHandling, refreshWikiImagePresentations, resolveImageSrc, setImageSrcResolver, settleImageSrcRequest, bindTooltips, replaceWikiLinkStatuses };
