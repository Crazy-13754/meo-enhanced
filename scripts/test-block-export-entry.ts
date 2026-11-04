import { createBlockExportAdapter } from '../webview/src/adapters/blockExportAdapter';
import { decodeHostToWebviewMessage } from '../src/protocol/messages';
import { renderExportBlocks } from '../webview/src/helpers/blockExport';
Object.assign(window, { createBlockExportAdapter, decodeHostToWebviewMessage, renderExportBlocks });
