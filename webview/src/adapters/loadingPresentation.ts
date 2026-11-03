/** Also installed in isolated extension canvases, so every surface uses the same presentation. */
export const loadingPresentationStyles = `
:where(.surface-loading){position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--meo-preview-foreground,var(--meo-foreground));background:var(--meo-preview-background,var(--meo-background));font-size:13px}
.surface-loading[hidden]{display:none}
.surface-loading-spinner{width:22px;height:22px;box-sizing:border-box;border:2px solid color-mix(in srgb,currentColor 18%,transparent);border-top-color:var(--meo-ui-focus);border-radius:50%;animation:preview-loading-spin .85s linear infinite}
@keyframes preview-loading-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.surface-loading-spinner{animation:none}}
`;
/** Shared quiet-window loading UI. Callers own readiness, cancellation and input gating. */
export function createLoadingPresentation(className: string) {
  if (!document.getElementById('meo-loading-presentation-style')) {
    const style = document.createElement('style'); style.id = 'meo-loading-presentation-style';
    style.textContent = loadingPresentationStyles; document.head.append(style);
  }
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
