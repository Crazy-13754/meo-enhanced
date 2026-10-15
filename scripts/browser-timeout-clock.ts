/** Test-only timeout clock. Native animation frames, input and painting keep running. */
export function installBrowserTimeoutClock(): void {
  const originalSet = Object.getOwnPropertyDescriptor(window, 'setTimeout')!;
  const originalClear = Object.getOwnPropertyDescriptor(window, 'clearTimeout')!;
  const originalClock = Object.getOwnPropertyDescriptor(window, '__timeoutClock');
  const nativeClear = window.clearTimeout.bind(window);
  const pending = new Map<number, { due: number; callback: (...args: any[]) => void; args: any[] }>();
  const ownedHandles = new Set<number>();
  let now = 0;
  let nextId = 0x40000000;
  let restored = false;
  Object.defineProperty(window, 'setTimeout', { ...originalSet, value: (callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
    if (typeof callback !== 'function') throw new Error('Browser timeout fixture requires a function callback');
    const id = nextId++;
    ownedHandles.add(id);
    pending.set(id, { due: now + Math.max(0, Number(delay) || 0), callback, args });
    return id;
  } });
  Object.defineProperty(window, 'clearTimeout', { ...originalClear, value: (id: number) => {
    if (ownedHandles.has(id)) pending.delete(id);
    else nativeClear(id);
  } });
  (window as any).__timeoutClock = {
    pending: () => [...pending].map(([id, timer]) => ({ id, due: timer.due })),
    now: () => now,
    async advance(budget: number) {
      if (restored || !Number.isFinite(budget) || budget < 0) throw new Error('Invalid timeout clock advance');
      const end = now + budget;
      for (let count = 0; ; count++) {
        const next = [...pending].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        if (count >= 1000) throw new Error('Timeout clock task limit exceeded');
        pending.delete(next[0]);
        now = next[1].due;
        next[1].callback.apply(window, next[1].args);
        await Promise.resolve();
      }
      now = end;
    },
    restore() {
      if (restored) return;
      restored = true;
      pending.clear();
      Object.defineProperty(window, 'setTimeout', originalSet);
      Object.defineProperty(window, 'clearTimeout', originalClear);
      if (originalClock) Object.defineProperty(window, '__timeoutClock', originalClock);
      else delete (window as any).__timeoutClock;
    }
  };
}
