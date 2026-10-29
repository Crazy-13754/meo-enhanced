import morphdom from 'morphdom';

const authoredNativeContent = new WeakMap<Element, string>();
const authoredDetailsOpen = new WeakMap<Element, boolean>();
const nativeContentSelector = 'picture,audio,video,img[srcset],input,select,textarea';
const boundControlSelector = '.meo-md-image,.meo-md-html-comment,.meo-md-html-link-button,.meo-md-html-inline-link-button';

/** Capture authored identity before URLs, line metadata or controls are projected. */
export function rememberHtmlNativeContent(root: ParentNode): void {
  for (const element of root.querySelectorAll(nativeContentSelector)) {
    if (!element.parentElement?.closest(nativeContentSelector)) authoredNativeContent.set(element, element.outerHTML);
  }
  // Top-level details uses the editor's folding state. Nested disclosures are
  // native reading controls and retain their state across unrelated input.
  for (const details of root.querySelectorAll('details')) {
    if (details.parentElement) authoredDetailsOpen.set(details, details.hasAttribute('open'));
  }
}

function nativeGroups(root: ParentNode): Map<string, Element[]> {
  const groups = new Map<string, Element[]>();
  for (const element of root.querySelectorAll('*')) {
    const identity = authoredNativeContent.get(element);
    if (identity !== undefined) {
      const group = groups.get(identity);
      if (group) group.push(element); else groups.set(identity, [element]);
    }
  }
  return groups;
}

/** Preserve unchanged native state; source-bound controls receive fresh handlers. */
export function updateHtmlContentDom(current: HTMLElement, next: HTMLElement, dispose: (element: Element) => void): void {
  const keys = new WeakMap<Node, string>();
  const retained = new WeakSet<Node>();
  const oldGroups = nativeGroups(current), newGroups = nativeGroups(next);
  let key = 0;
  for (const [identity, elements] of oldGroups) {
    const replacements = newGroups.get(identity);
    if (replacements?.length !== elements.length) continue;
    elements.forEach((element, index) => {
      const value = `native:${key++}`;
      keys.set(element, value); keys.set(replacements[index], value); retained.add(element);
    });
  }
  // A changed/ambiguous resource is a new authored element. Never transfer
  // playback or control state to another identical copy inserted beside it.
  for (const root of [current, next]) {
    for (const elements of nativeGroups(root).values()) for (const element of elements) {
      if (!keys.has(element)) keys.set(element, `resource:${key++}`);
    }
    for (const element of root.querySelectorAll(boundControlSelector)) keys.set(element, `control:${key++}`);
  }
  const oldDetails = current.querySelectorAll('details'), newDetails = next.querySelectorAll('details');
  if (oldDetails.length === newDetails.length) oldDetails.forEach((details, index) => {
    if (!details.id && !newDetails[index].id) {
      keys.set(details, `disclosure:${index}`); keys.set(newDetails[index], `disclosure:${index}`);
    }
  });
  morphdom(current, next, {
    childrenOnly: true,
    getNodeKey: node => keys.get(node) ?? (node.nodeType === Node.ELEMENT_NODE && (node as Element).id ? `authored:${(node as Element).id}` : undefined),
    onBeforeElUpdated(from, to) {
      const open = authoredDetailsOpen.get(to);
      if (open !== undefined) {
        if (authoredDetailsOpen.get(from) === open) (to as HTMLDetailsElement).open = (from as HTMLDetailsElement).open;
        authoredDetailsOpen.set(from, open);
      }
      if (!retained.has(from)) return true;
      // Source coordinates may move while the native content stays identical.
      const oldNodes = [from, ...from.querySelectorAll('[data-meo-html-source-line]')];
      const newNodes = [to, ...to.querySelectorAll('[data-meo-html-source-line]')];
      oldNodes.forEach((node, index) => {
        const line = newNodes[index]?.getAttribute('data-meo-html-source-line');
        if (line !== null && line !== undefined) node.setAttribute('data-meo-html-source-line', line);
      });
      for (const control of to.querySelectorAll(boundControlSelector)) dispose(control);
      return false;
    },
    onNodeDiscarded(node) { if (node.nodeType === Node.ELEMENT_NODE) dispose(node as Element); }
  });
}
