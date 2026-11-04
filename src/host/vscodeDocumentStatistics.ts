import * as vscode from 'vscode';
import type { DocumentStatistics } from '../protocol/documentStatistics';

export function createVscodeDocumentStatistics(panel: vscode.WebviewPanel, language: () => string) {
  const item = vscode.window.createStatusBarItem('meoEnhanced.documentStatistics', vscode.StatusBarAlignment.Right, 100);
  item.name = 'MEO Enhanced: Document Statistics';
  let statistics: DocumentStatistics | null = null;
  const refresh = () => {
    if (!panel.active || !statistics) { item.hide(); return; }
    const s = statistics, zh = language() === 'zh-CN';
    const n = (value: number) => value.toLocaleString(zh ? 'zh-CN' : 'en-US');
    const position = s.line === null ? `${n(s.lines)} ${zh ? '行' : 'lines'}` : `${zh ? '行' : 'Ln'} ${n(s.line)}/${n(s.lines)}`;
    const count = s.hasSelection
      ? zh ? `选中 ${n(s.selectedWords)} / 共 ${n(s.words)} 字` : `${n(s.selectedWords)} selected / ${n(s.words)} words`
      : `${zh ? '字数' : 'Words'} ${n(s.words)}`;
    item.text = `${position} · ${count}`;
    item.tooltip = zh
      ? `MEO Enhanced\n${s.line === null ? '预览模式' : `当前第 ${n(s.line)} 行`}，共 ${n(s.lines)} 行\n源码字符数：${n(s.characters)}（含空白和标记）\n中文逐字、英文逐词；包含代码文字，排除 Markdown 标记、链接地址、HTML 标签和 frontmatter。行数按源码换行计算。`
      : `MEO Enhanced\n${s.line === null ? 'Preview' : `Line ${n(s.line)}`} / ${n(s.lines)} lines\nSource characters: ${n(s.characters)} (including whitespace and markup)\nCJK characters and other-language words, including code text. Excludes Markdown markup, link destinations, HTML tags and frontmatter. Lines follow source line breaks.`;
    item.accessibilityInformation = { label: `MEO Enhanced: ${item.text}` };
    item.show();
  };
  const subscription = panel.onDidChangeViewState(refresh);
  const configuration = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('meoEnhanced.language')) refresh();
  });
  return { update(value: DocumentStatistics | null) { statistics = value; refresh(); }, refresh,
    dispose() { subscription.dispose(); configuration.dispose(); item.dispose(); } };
}
