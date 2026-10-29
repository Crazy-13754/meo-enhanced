import { mapHtmlSrcset } from '../../../src/shared/htmlPolicy';

const pendingResources = new WeakMap<Element, Map<string, { source: string; signal: AbortSignal }>>();

/** Reuses the owning surface's resolver, cancellation and geometry commit.
 * Pictures and media stay native elements; an image widget cannot replace a
 * picture's direct img child without breaking browser source selection. */
export function resolveHtmlResources(root: ParentNode, options: {
  resolve(source: string, signal: AbortSignal): Promise<string | null>;
  signal: AbortSignal;
  commit(apply: () => void): void;
}): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-meo-html-src],[data-meo-html-poster],[data-meo-html-srcset]')) {
    for (const name of ['src', 'poster', 'srcset']) {
      const key = `data-meo-html-${name}`;
      const source = element.getAttribute(key);
      if (!source) continue;
      let pending = pendingResources.get(element);
      const previous = pending?.get(name);
      if (previous?.source === source && previous.signal === options.signal && !previous.signal.aborted) continue;
      if (!pending) pendingResources.set(element, pending = new Map());
      const request = { source, signal: options.signal };
      pending.set(name, request);
      const resolve = async () => {
        if (name !== 'srcset') return options.resolve(source, options.signal);
        const urls = new Map<string, string>();
        mapHtmlSrcset(source, url => { urls.set(url, ''); return url; });
        await Promise.all([...urls.keys()].map(async url => urls.set(url, await options.resolve(url, options.signal) ?? '')));
        return mapHtmlSrcset(source, url => urls.get(url) ?? '');
      };
      void resolve().then(value => {
        if (pending.get(name) !== request) return;
        if (options.signal.aborted) { pending.delete(name); return; }
        options.commit(() => {
          if (pending.get(name) !== request) return;
          pending.delete(name);
          if (options.signal.aborted || !element.isConnected) return;
          if (value) element.setAttribute(name, value); else element.removeAttribute(name);
          element.removeAttribute(key);
          const media = element.closest<HTMLMediaElement>('audio,video');
          if (media && name === 'src') media.load();
        });
      }).catch(() => {
        // A failed/cancelled resolution leaves the source marker available to retry.
        if (pending.get(name) === request) pending.delete(name);
      });
    }
  }
}
