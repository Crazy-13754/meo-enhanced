import * as vscode from 'vscode';
import { decodeReadyMessage } from '../protocol/readyInit';
import type { SidebarOutlineHeading, SidebarOutlineHostEvent, SidebarOutlineMessage } from '../protocol/sidebarOutline';

export const SIDEBAR_OUTLINE_VIEW_ID = 'meoEnhanced.outline';
export const SIDEBAR_OUTLINE_REVEAL_COMMAND = 'meoEnhanced.outline.revealHeading';
export const SIDEBAR_OUTLINE_CONTEXT_KEY = 'meoEnhanced.outline.hasEditor';

type Entry = {
  readonly id: number;
  readonly panel: vscode.WebviewPanel;
  readonly document: vscode.TextDocument;
  roots: OutlineNode[];
  nodes: OutlineNode[];
  activeIndex: number;
  post(event: SidebarOutlineHostEvent): void;
};

export type OutlineNode = SidebarOutlineTreeNode<SidebarOutlineHeading, { readonly entry: Entry }>;

export type SidebarOutlineTreeNode<T, E> = E & {
  readonly heading: T;
  readonly id: string;
  readonly parent: SidebarOutlineTreeNode<T, E> | null;
  readonly children: SidebarOutlineTreeNode<T, E>[];
};

/** Same nesting and stable keys as the in-editor outline, so collapse state survives edits. */
export function buildSidebarOutlineTree<T extends { level: number; text: string }, E extends object>(
  headings: readonly T[], prefix: string, extra: E
) {
  type Node = SidebarOutlineTreeNode<T, E>;
  const roots: Node[] = [];
  const nodes: Node[] = [];
  const stack: Node[] = [];
  const occurrences = new Map<string, number>();
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1].heading.level >= heading.level) stack.pop();
    const parent = stack.at(-1) ?? null;
    const base = `${parent?.id ?? prefix}/h${heading.level}:${heading.text.trim().toLowerCase()}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const node: Node = { ...extra, heading, id: `${base}:${occurrence}`, parent, children: [] };
    (parent ? parent.children : roots).push(node);
    nodes.push(node);
    stack.push(node);
  }
  return { roots, nodes };
}

function documentName(document: vscode.TextDocument): string {
  const path = document.uri.path;
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

/**
 * Explorer view mirroring the outline of the most recently active MEO editor.
 * Webviews publish headings only while this view is visible.
 */
export function createVscodeSidebarOutline(language: () => string) {
  const entries = new Set<Entry>();
  let current: Entry | null = null;
  let nextId = 0;
  const changed = new vscode.EventEmitter<OutlineNode | undefined>();
  const zh = () => language() === 'zh-CN';

  const provider: vscode.TreeDataProvider<OutlineNode> = {
    onDidChangeTreeData: changed.event,
    getChildren: node => node ? node.children : current?.roots ?? [],
    getParent: node => node.parent ?? undefined,
    getTreeItem: node => {
      const item = new vscode.TreeItem(
        node.heading.text || (zh() ? '（空标题）' : '(empty heading)'),
        node.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
      );
      item.id = node.id;
      item.iconPath = new vscode.ThemeIcon('symbol-string');
      item.tooltip = zh() ? `H${node.heading.level} · 第 ${node.heading.line} 行` : `H${node.heading.level} · Line ${node.heading.line}`;
      item.command = { command: SIDEBAR_OUTLINE_REVEAL_COMMAND, title: zh() ? '跳转到标题' : 'Go to Heading', arguments: [node] };
      return item;
    }
  };
  const view = vscode.window.createTreeView(SIDEBAR_OUTLINE_VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });

  const presentHeader = () => {
    view.description = current ? documentName(current.document) : undefined;
    view.message = !current
      ? (zh() ? '没有活动的 MEO 编辑器。' : 'No active MEO editor.')
      : current.nodes.length === 0
        ? (zh() ? '当前文档没有标题。' : 'The document has no headings.')
        : undefined;
  };
  const revealActive = () => {
    if (!current || !view.visible) return;
    const node = current.nodes[current.activeIndex];
    if (node) void Promise.resolve(view.reveal(node, { select: true, focus: false })).catch(() => undefined);
  };
  const show = (entry: Entry | null) => {
    current = entry;
    presentHeader();
    changed.fire(undefined);
    revealActive();
  };
  const updateContext = () => {
    void vscode.commands.executeCommand('setContext', SIDEBAR_OUTLINE_CONTEXT_KEY, entries.size > 0);
  };

  const subscriptions: vscode.Disposable[] = [
    view,
    changed,
    view.onDidChangeVisibility(() => {
      for (const entry of entries) entry.post({ type: 'sidebarOutlineSubscription', enabled: view.visible });
      if (view.visible) revealActive();
    }),
    vscode.commands.registerCommand(SIDEBAR_OUTLINE_REVEAL_COMMAND, (node?: OutlineNode) => {
      if (!node || !entries.has(node.entry)) return;
      const { panel } = node.entry;
      // Keep focus in the tree, like the native Outline: arrow keys continue to navigate.
      if (!panel.visible) panel.reveal(panel.viewColumn, true);
      node.entry.post({ type: 'revealOutlineHeading', line: node.heading.line });
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('meoEnhanced.language')) { presentHeader(); changed.fire(undefined); }
    })
  ];
  presentHeader();

  function attach(panel: vscode.WebviewPanel, document: vscode.TextDocument, ensureInit: () => Promise<void>) {
    let ready = false;
    let disposed = false;
    const deliver = async (event: SidebarOutlineHostEvent) => {
      if (!ready || disposed) return;
      await ensureInit();
      if (!disposed) await panel.webview.postMessage(event);
    };
    const entry: Entry = {
      id: ++nextId,
      panel,
      document,
      roots: [],
      nodes: [],
      activeIndex: -1,
      post: event => { void deliver(event).catch(error => console.error('MEO outline message could not be delivered', error)); }
    };
    entries.add(entry);
    updateContext();
    if (panel.active || !current) show(entry);

    const panelSubscriptions = [
      // Every ready, including a reloaded Webview, starts unsubscribed.
      panel.webview.onDidReceiveMessage(raw => {
        if (!decodeReadyMessage(raw)) return;
        ready = true;
        entry.post({ type: 'sidebarOutlineSubscription', enabled: view.visible });
      }),
      panel.onDidChangeViewState(() => {
        if (panel.active && current !== entry) show(entry);
      })
    ];

    return {
      update(message: SidebarOutlineMessage) {
        if (disposed) return;
        if (message.headings) {
          ({ roots: entry.roots, nodes: entry.nodes } = buildSidebarOutlineTree(message.headings, `${entry.id}`, { entry }));
        }
        if (message.activeIndex >= entry.nodes.length) return;
        const headingsChanged = message.headings !== undefined;
        const activeChanged = entry.activeIndex !== message.activeIndex;
        entry.activeIndex = message.activeIndex;
        if (entry !== current) return;
        if (headingsChanged) { presentHeader(); changed.fire(undefined); }
        if (headingsChanged || activeChanged) revealActive();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        panelSubscriptions.forEach(subscription => subscription.dispose());
        entries.delete(entry);
        updateContext();
        if (current === entry) {
          const remaining = [...entries];
          show(remaining.find(other => other.panel.active) ?? remaining.find(other => other.panel.visible) ?? remaining.at(-1) ?? null);
        }
      }
    };
  }

  return {
    attach,
    dispose() { subscriptions.forEach(subscription => subscription.dispose()); entries.clear(); current = null; }
  };
}
