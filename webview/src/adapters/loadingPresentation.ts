/** Shared quiet-window loading UI. Callers own readiness, cancellation and input gating. */
export function createLoadingPresentation(className: string) {
  const element = document.createElement('div');
  element.className = `surface-loading ${className}`;
  element.hidden = true;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  const spinner = document.createElement('span');
  spinner.className = `surface-loading-spinner ${className}-spinner`;
  spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  element.append(spinner, label);
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    element,
    get pending() { return pending; },
    setLabel(text: string) { label.textContent = text; },
    begin(canShow: () => boolean, onVisible: () => void) {
      if (pending) return;
      pending = true;
      timer = setTimeout(() => {
        timer = undefined;
        if (!pending || !canShow()) return;
        element.hidden = false;
        onVisible();
      }, 200);
    },
    finish(retainCover = false) {
      clearTimeout(timer); timer = undefined; pending = false;
      if (!retainCover) element.hidden = true;
    }
  };
}
