import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { decodeHostToWebviewMessage, decodeWebviewToHostMessage } from '../src/protocol/messages';
import { MAX_SIDEBAR_OUTLINE_HEADINGS, MAX_SIDEBAR_OUTLINE_TEXT_LENGTH } from '../src/protocol/sidebarOutline';
import { createSidebarOutlineReporter, findActiveHeadingIndex, type SidebarOutlineSource } from '../webview/src/adapters/sidebarOutline';

// Protocol: both directions validate shape and bounds.
const heading = (level: number, text: string, line: number) => ({ level, text, line });
assert.deepEqual(decodeWebviewToHostMessage({ type: 'sidebarOutline', headings: [heading(1, 'A', 1)], activeIndex: 0 }),
  { type: 'sidebarOutline', headings: [heading(1, 'A', 1)], activeIndex: 0 });
assert.deepEqual(decodeWebviewToHostMessage({ type: 'sidebarOutline', activeIndex: -1 }), { type: 'sidebarOutline', activeIndex: -1 });
for (const invalid of [
  { type: 'sidebarOutline', headings: [heading(7, 'A', 1)], activeIndex: 0 },
  { type: 'sidebarOutline', headings: [heading(1, 'A', 0)], activeIndex: 0 },
  { type: 'sidebarOutline', headings: [heading(1, 'x'.repeat(MAX_SIDEBAR_OUTLINE_TEXT_LENGTH + 1), 1)], activeIndex: 0 },
  { type: 'sidebarOutline', headings: [heading(1, 'A', 1)], activeIndex: 1 },
  { type: 'sidebarOutline', headings: [], activeIndex: -2 },
  { type: 'sidebarOutline', headings: 'A', activeIndex: 0 },
  { type: 'sidebarOutline', activeIndex: 0.5 }
]) assert.equal(decodeWebviewToHostMessage(invalid), null, JSON.stringify(invalid).slice(0, 80));
const extra = decodeWebviewToHostMessage({ type: 'sidebarOutline', headings: [{ ...heading(2, 'B', 3), from: 9 }], activeIndex: -1 });
assert.deepEqual(extra, { type: 'sidebarOutline', headings: [heading(2, 'B', 3)], activeIndex: -1 }, 'unknown heading fields are dropped');
assert.deepEqual(decodeHostToWebviewMessage({ type: 'sidebarOutlineSubscription', enabled: true }), { type: 'sidebarOutlineSubscription', enabled: true });
assert.deepEqual(decodeHostToWebviewMessage({ type: 'revealOutlineHeading', line: 4 }), { type: 'revealOutlineHeading', line: 4 });
assert.equal(decodeHostToWebviewMessage({ type: 'sidebarOutlineSubscription', enabled: 1 }), null);
assert.equal(decodeHostToWebviewMessage({ type: 'revealOutlineHeading', line: 0 }), null);

// Active heading: same rule as the in-editor outline.
assert.equal(findActiveHeadingIndex([], 10), -1);
assert.equal(findActiveHeadingIndex([5, 20, 40], 4), -1);
assert.equal(findActiveHeadingIndex([5, 20, 40], 20), 1);
assert.equal(findActiveHeadingIndex([5, 20, 40], 99), 2);

// Webview reporter with deterministic timers.
const queue: Array<{ id: number; run: () => void; frame: boolean }> = [];
let nextHandle = 0;
const timers = {
  setTimeout: (run: () => void) => { const id = ++nextHandle; queue.push({ id, run, frame: false }); return id; },
  clearTimeout: (id: unknown) => { const index = queue.findIndex(item => item.id === id); if (index >= 0) queue.splice(index, 1); },
  requestFrame: (run: () => void) => { const id = ++nextHandle; queue.push({ id, run, frame: true }); return id; },
  cancelFrame: (id: unknown) => { const index = queue.findIndex(item => item.id === id); if (index >= 0) queue.splice(index, 1); }
};
const flush = () => { while (queue.length) queue.shift()!.run(); };

let scrollListener: (() => void) | null = null;
const scrollElement = {
  addEventListener: (_: string, listener: () => void) => { scrollListener = listener; },
  removeEventListener: (_: string, listener: () => void) => { if (scrollListener === listener) scrollListener = null; }
} as unknown as EventTarget;
let headings = [
  { level: 1, text: ' Intro ', from: 0, line: 1 },
  { level: 2, text: 'Detail', from: 30, line: 4 },
  { level: 1, text: 'End', from: 80, line: 9 }
];
let anchor = 0;
let pending = false;
const scrolled: number[] = [];
const source: SidebarOutlineSource = {
  getHeadings: () => headings,
  isOutlinePending: () => pending,
  getViewportAnchorOffset: () => anchor,
  getVisibleDocumentRange: () => ({}),
  getScrollElement: () => scrollElement,
  scrollToLine: line => { scrolled.push(line); }
};
const posted: any[] = [];
const reporter = createSidebarOutlineReporter(() => source, message => posted.push(message), timers);

reporter.schedule(); flush();
assert.equal(posted.length, 0, 'hidden sidebar does no work');
reporter.setEnabled(true); flush();
assert.deepEqual(posted.at(-1), { type: 'sidebarOutline', activeIndex: 0, headings: [heading(1, 'Intro', 1), heading(2, 'Detail', 4), heading(1, 'End', 9)] });
assert.ok(scrollListener, 'scroll is observed while enabled');
reporter.schedule(); flush();
assert.equal(posted.length, 1, 'unchanged headings are not resent');
anchor = 35; scrollListener!(); scrollListener!(); flush();
assert.deepEqual(posted.slice(1), [{ type: 'sidebarOutline', activeIndex: 1 }], 'scroll sends only the active index, once per frame');
headings = [...headings, { level: 2, text: 'More', from: 90, line: 11 }];
pending = true; reporter.schedule();
queue.shift()!.run();
assert.equal(posted.length, 2, 'pending outline is not published');
pending = false; flush();
assert.equal(posted.at(-1).headings.length, 4, 'retry publishes once the outline settles');
reporter.reveal(9);
assert.deepEqual(scrolled, [9], 'reveal uses the in-editor outline navigation');
reporter.setEnabled(false);
assert.equal(scrollListener, null, 'disabling releases the scroll listener');
const before = posted.length;
anchor = 0; reporter.schedule(); flush();
assert.equal(posted.length, before);
reporter.setEnabled(true); flush();
assert.ok(posted.at(-1).headings, 're-enabling resends all headings');

headings = Array.from({ length: MAX_SIDEBAR_OUTLINE_HEADINGS + 5 }, (_, index) => ({ level: 1, text: 'x'.repeat(MAX_SIDEBAR_OUTLINE_TEXT_LENGTH + 10), from: index, line: index + 1 }));
anchor = MAX_SIDEBAR_OUTLINE_HEADINGS + 100;
reporter.schedule(); flush();
const large = posted.at(-1);
assert.equal(large.headings.length, MAX_SIDEBAR_OUTLINE_HEADINGS);
assert.equal(large.headings[0].text.length, MAX_SIDEBAR_OUTLINE_TEXT_LENGTH);
assert.ok(decodeWebviewToHostMessage(large), 'bounded payload stays valid');
reporter.dispose();

// Host tree view.
const contextKeys = new Map<string, unknown>();
const commands = new Map<string, (...args: any[]) => unknown>();
type Listener<T> = (value: T) => void;
class EventEmitter<T> {
  listeners: Listener<T>[] = [];
  event = (listener: Listener<T>) => { this.listeners.push(listener); return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } }; };
  fire(value: T) { for (const listener of [...this.listeners]) listener(value); }
  dispose() { this.listeners = []; }
}
let treeView: any;
let provider: any;
const reveals: any[] = [];
mock.module('vscode', () => ({
  EventEmitter,
  TreeItem: class { id?: string; iconPath?: unknown; tooltip?: string; command?: any; constructor(public label: string, public collapsibleState: number) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
  commands: {
    executeCommand: async (command: string, key: string, value: unknown) => { if (command === 'setContext') contextKeys.set(key, value); },
    registerCommand: (id: string, run: (...args: any[]) => unknown) => { commands.set(id, run); return { dispose: () => commands.delete(id) }; }
  },
  workspace: { onDidChangeConfiguration: () => ({ dispose() {} }) },
  window: {
    createTreeView: (_id: string, options: any) => {
      provider = options.treeDataProvider;
      const visibility = new EventEmitter<void>();
      treeView = { visible: false, description: undefined, message: undefined, visibility,
        onDidChangeVisibility: visibility.event, reveal: async (node: any, options: any) => { reveals.push({ node, options }); }, dispose() {} };
      return treeView;
    }
  }
}));
const { createVscodeSidebarOutline, buildSidebarOutlineTree, SIDEBAR_OUTLINE_REVEAL_COMMAND, SIDEBAR_OUTLINE_CONTEXT_KEY } = await import('../src/host/vscodeSidebarOutline');

const tree = buildSidebarOutlineTree([heading(1, 'A', 1), heading(3, 'B', 2), heading(2, 'C', 3), heading(2, 'C', 4), heading(1, 'D', 5)], 'p', {});
assert.deepEqual(tree.roots.map(node => node.heading.text), ['A', 'D']);
assert.deepEqual(tree.roots[0].children.map(node => node.heading.text), ['B', 'C', 'C']);
assert.equal(new Set(tree.nodes.map(node => node.id)).size, tree.nodes.length, 'duplicate headings get unique ids');
assert.equal(tree.nodes[2].parent, tree.roots[0]);
const edited = buildSidebarOutlineTree([heading(1, 'A', 1), heading(2, 'New', 2), heading(3, 'B', 3)], 'p', {});
assert.equal(edited.nodes[0].id, tree.nodes[0].id, 'ids stay stable across edits for preserved collapse state');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const createPanel = (active: boolean) => {
  const messages = new EventEmitter<unknown>();
  const viewState = new EventEmitter<void>();
  const panel = {
    active, visible: true, viewColumn: 1, revealed: 0, posted: [] as any[],
    webview: { onDidReceiveMessage: messages.event, postMessage: async (message: unknown) => { panel.posted.push(message); return true; } },
    onDidChangeViewState: viewState.event,
    reveal() { panel.revealed += 1; panel.visible = true; },
    receive: (message: unknown) => messages.fire(message),
    changeViewState: () => viewState.fire()
  };
  return panel;
};
const documentFor = (path: string) => ({ uri: { path } });
const outline = createVscodeSidebarOutline(() => 'zh-CN');
assert.equal(treeView.message, '没有活动的 MEO 编辑器。');
const left = createPanel(true), right = createPanel(false);
let initDelivered = 0;
const ensureInit = async () => { initDelivered += 1; };
const leftHandle = outline.attach(left as any, documentFor('/w/1.md') as any, ensureInit);
const rightHandle = outline.attach(right as any, documentFor('/w/2.md') as any, ensureInit);
await settle();
assert.equal(contextKeys.get(SIDEBAR_OUTLINE_CONTEXT_KEY), true);
assert.equal(treeView.description, '1.md', 'the active editor is shown');
left.receive({ type: 'ready' }); right.receive({ type: 'ready' }); await settle();
assert.ok(initDelivered >= 2, 'subscription waits for init delivery');
assert.deepEqual(left.posted, [{ type: 'sidebarOutlineSubscription', enabled: false }]);
treeView.visible = true; treeView.visibility.fire(); await settle();
assert.deepEqual(right.posted.at(-1), { type: 'sidebarOutlineSubscription', enabled: true }, 'visibility reaches every editor');

leftHandle.update({ type: 'sidebarOutline', headings: [heading(1, '1', 1), heading(2, '11', 2)], activeIndex: 1 });
rightHandle.update({ type: 'sidebarOutline', headings: [heading(1, '2', 1), heading(2, '2', 2)], activeIndex: 0 });
const roots = provider.getChildren(undefined);
assert.deepEqual(roots.map((node: any) => node.heading.text), ['1']);
assert.deepEqual(provider.getChildren(roots[0]).map((node: any) => node.heading.text), ['11']);
const item = provider.getTreeItem(roots[0]);
assert.equal(item.collapsibleState, 2);
assert.equal(item.tooltip, 'H1 · 第 1 行');
assert.equal(provider.getParent(provider.getChildren(roots[0])[0]), roots[0]);
await settle();
assert.equal(reveals.at(-1).node.heading.text, '11', 'the current heading is selected');
assert.equal(reveals.at(-1).options.focus, false, 'following never steals focus');

left.active = false; right.active = true; left.changeViewState(); right.changeViewState();
assert.equal(treeView.description, '2.md', 'split editing follows the focused editor');
assert.deepEqual(provider.getChildren(undefined).map((node: any) => node.heading.text), ['2']);
right.active = false; right.changeViewState();
assert.equal(treeView.description, '2.md', 'focusing the sidebar keeps the last editor');

const target = provider.getChildren(provider.getChildren(undefined)[0])[0];
right.visible = false;
commands.get(SIDEBAR_OUTLINE_REVEAL_COMMAND)!(target); await settle();
assert.deepEqual(right.posted.at(-1), { type: 'revealOutlineHeading', line: 2 });
assert.equal(right.revealed, 1, 'a hidden editor tab is brought back without focus');
assert.ok(!left.posted.some(message => message.type === 'revealOutlineHeading'));

rightHandle.update({ type: 'sidebarOutline', headings: [], activeIndex: -1 });
assert.equal(treeView.message, '当前文档没有标题。');
rightHandle.dispose();
assert.equal(treeView.description, '1.md', 'closing the shown editor falls back to another one');
commands.get(SIDEBAR_OUTLINE_REVEAL_COMMAND)!(target); await settle();
assert.equal(right.posted.filter(message => message.type === 'revealOutlineHeading').length, 1, 'closed editors ignore stale tree items');
leftHandle.dispose(); await settle();
assert.equal(contextKeys.get(SIDEBAR_OUTLINE_CONTEXT_KEY), false);
assert.equal(treeView.message, '没有活动的 MEO 编辑器。');
outline.dispose();
assert.equal(commands.has(SIDEBAR_OUTLINE_REVEAL_COMMAND), false);

console.log('Sidebar outline: protocol, active heading, webview reporter, tree, split focus, reveal and lifecycle passed');
