/** One menu and its authoritative controls, opened from either preview surface. */
export function createPreviewOptionsMenu(label: string, controls: readonly HTMLElement[], onClose: () => void) {
  const panel = document.createElement('div');
  panel.id = 'preview-options-panel';
  panel.className = 'preview-options-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);
  panel.hidden = true;
  panel.append(...controls);
  document.body.append(panel);

  const triggers = new Set<HTMLButtonElement>();
  const hoverTriggers = new Set<HTMLButtonElement>();
  let activeTrigger: HTMLButtonElement | null = null;
  let hoverCloseTimer: number | undefined;
  let hoverDismissed = false;
  const cancelHoverClose = (): void => {
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = undefined;
  };
  const contains = (target: EventTarget | null): boolean => target instanceof Node && (
    panel.contains(target) || Boolean(activeTrigger?.contains(target))
    || (target instanceof Element && Boolean(target.closest('.preview-dropdown-panel')))
  );
  const hovered = (): boolean => Boolean(activeTrigger?.matches(':hover') || panel.matches(':hover')
    || document.querySelector('.preview-dropdown-panel:not([hidden]):hover'));
  const close = (): void => {
    cancelHoverClose();
    const wasOpen = !panel.hidden;
    if (wasOpen) hoverDismissed = true;
    panel.hidden = true;
    for (const trigger of triggers) trigger.setAttribute('aria-expanded', 'false');
    if (wasOpen) onClose();
  };
  const scheduleHoverClose = (): void => {
    cancelHoverClose();
    // Both this menu and its nested dropdowns are portalled; allow their pointer gaps.
    hoverCloseTimer = window.setTimeout(() => {
      if (hovered()) return;
      const focused = document.activeElement;
      close();
      if (contains(focused)) (focused as HTMLElement).blur();
    }, 120);
  };
  const position = (): void => {
    if (panel.hidden || !activeTrigger) return;
    const bounds = activeTrigger.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 8;
    const above = bounds.top - 8;
    panel.style.maxHeight = `${Math.max(0, below, above)}px`;
    const openAbove = panel.offsetHeight > below && above > below;
    panel.style.maxHeight = `${Math.max(0, openAbove ? above : below)}px`;
    panel.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = openAbove
      ? `${Math.max(8, bounds.top - panel.offsetHeight - 4)}px`
      : `${bounds.bottom + 4}px`;
  };
  const open = (trigger: HTMLButtonElement): void => {
    cancelHoverClose();
    if (!panel.hidden && activeTrigger === trigger) return;
    close();
    activeTrigger = trigger;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    position();
  };
  const bindTrigger = (trigger: HTMLButtonElement, openOnHover = false): void => {
    triggers.add(trigger);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', panel.id);
    trigger.addEventListener('click', () => {
      if (!openOnHover && !panel.hidden && activeTrigger === trigger) close();
      else open(trigger);
    });
    if (openOnHover) {
      hoverTriggers.add(trigger);
      trigger.addEventListener('pointerenter', () => {
        hoverDismissed = false;
        open(trigger);
      });
      trigger.addEventListener('focusin', () => {
        if (!hoverDismissed) open(trigger);
      });
    }
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      open(trigger);
      panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  };
  document.addEventListener('pointerover', event => {
    if (panel.hidden || !activeTrigger || !hoverTriggers.has(activeTrigger)) return;
    if (contains(event.target)) cancelHoverClose();
    else scheduleHoverClose();
  });
  document.addEventListener('pointerout', event => {
    if (panel.hidden || !activeTrigger || !hoverTriggers.has(activeTrigger)) return;
    if (!contains(event.relatedTarget)) scheduleHoverClose();
  });
  document.addEventListener('focusout', event => {
    if (!activeTrigger || !hoverTriggers.has(activeTrigger)) return;
    if (contains(event.target) && !contains(event.relatedTarget) && !hovered()) {
      close();
      hoverDismissed = false;
    }
  });
  document.addEventListener('pointerdown', event => {
    if (panel.hidden || !(event.target instanceof Node)) return;
    const target = event.target;
    if (panel.contains(target) || [...triggers].some(trigger => trigger.contains(target))) return;
    if (target instanceof Element && target.closest('.preview-dropdown-panel')) return;
    close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || panel.hidden) return;
    event.preventDefault();
    close();
    activeTrigger?.focus({ preventScroll: true });
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  return {
    panel,
    bindTrigger,
    close,
    setLabel(nextLabel: string) {
      panel.setAttribute('aria-label', nextLabel);
      position();
    }
  };
}
