export type ToolbarDropdown = {
  readonly element: HTMLDivElement;
  readonly label: HTMLSpanElement;
  readonly select: HTMLSelectElement;
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLDivElement;
  refreshOptions(): void;
  setFooterAction(label: string, action: () => void): void;
  syncFromSelect(): void;
  setAppearance(appearance: 'light' | 'dark'): void;
  setLabel(label: string): void;
  close(): void;
  dispose(): void;
};

const dropdownClassFor = (controlClassName: string): string => (
  `${controlClassName.replace(/-control$/, '')}-dropdown`
);

/** Accessible toolbar listbox whose popup colors follow the surrounding editor toolbar. */
export function createToolbarDropdown(
  controlClassName: string,
  labelText: string
): ToolbarDropdown {
  const element = document.createElement('div');
  element.className = `preview-select-control ${controlClassName}`;
  element.dataset.previewAppearance = 'dark';

  const label = document.createElement('span');
  label.className = 'preview-select-label';

  const shell = document.createElement('span');
  shell.className = 'preview-select-shell';

  const select = document.createElement('select');
  select.className = 'preview-toolbar-select preview-toolbar-native-select';
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `preview-toolbar-dropdown ${dropdownClassFor(controlClassName)}`;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const value = document.createElement('span');
  value.className = 'preview-toolbar-dropdown-value';
  const chevron = document.createElement('span');
  chevron.className = 'preview-toolbar-dropdown-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(value, chevron);

  const panel = document.createElement('div');
  panel.className = `preview-dropdown-panel ${dropdownClassFor(controlClassName)}-panel`;
  panel.dataset.previewControl = controlClassName;
  panel.dataset.previewAppearance = 'dark';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;

  shell.append(select, trigger);
  element.append(label, shell);
  document.body.append(panel);

  let disposed = false;
  let footer: HTMLButtonElement | null = null;
  let footerAction: (() => void) | null = null;

  const setLabel = (nextLabel: string): void => {
    label.textContent = nextLabel;
    element.setAttribute('aria-label', nextLabel);
    trigger.setAttribute('aria-label', nextLabel);
  };

  const selectedOption = (): HTMLOptionElement | null => (
    select.selectedOptions.item(0) ?? select.options.item(0)
  );

  const syncFromSelect = (): void => {
    trigger.disabled = select.disabled;
    if (select.disabled) close();
    const selected = selectedOption();
    value.textContent = selected?.textContent ?? '';
    for (const option of panel.querySelectorAll<HTMLButtonElement>('[role="option"]')) {
      const active = option.dataset.value === select.value;
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-selected', String(active));
    }
  };

  const positionPanel = (): void => {
    if (panel.hidden) return;
    const bounds = trigger.getBoundingClientRect();
    const availableBelow = window.innerHeight - bounds.bottom - 6;
    const availableAbove = bounds.top - 6;
    panel.style.minWidth = `${bounds.width}px`;
    // Measure at the larger available space so option gaps, borders and a footer all count.
    panel.style.maxHeight = `${Math.max(0, availableAbove, availableBelow)}px`;
    const openAbove = panel.offsetHeight > availableBelow && availableAbove > availableBelow;
    panel.style.maxHeight = `${Math.max(0, openAbove ? availableAbove : availableBelow)}px`;
    panel.style.left = `${Math.max(4, Math.min(bounds.left, window.innerWidth - panel.offsetWidth - 4))}px`;
    panel.style.top = openAbove
      ? `${Math.max(4, bounds.top - panel.offsetHeight - 4)}px`
      : `${Math.min(window.innerHeight - panel.offsetHeight - 4, bounds.bottom + 4)}px`;
  };

  const close = (restoreFocus = false): void => {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };

  const open = (): void => {
    if (disposed || select.disabled || !panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionPanel();
    panel.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  const toggle = (): void => panel.hidden ? open() : close();

  const choose = (nextValue: string): void => {
    if (select.disabled) return;
    if (!Array.from(select.options).some((option) => option.value === nextValue)) return;
    select.value = nextValue;
    syncFromSelect();
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  };

  const refreshOptions = (): void => {
    panel.replaceChildren(...Array.from(select.options, (nativeOption) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'preview-dropdown-option';
      option.dataset.value = nativeOption.value;
      option.setAttribute('role', 'option');
      option.textContent = nativeOption.textContent;
      option.addEventListener('click', () => choose(nativeOption.value));
      return option;
    }));
    if (footer) {
      const list = document.createElement('div'); list.setAttribute('role', 'listbox');
      list.append(...panel.childNodes); panel.setAttribute('role', 'group'); panel.append(list, footer);
    }
    syncFromSelect();
  };

  const handleTriggerClick = () => toggle();
  const handleSelectChange = () => syncFromSelect();
  const handleWindowPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Node ? event.target : null;
    if (target && (element.contains(target) || panel.contains(target))) return;
    close();
  };
  const handleWindowGeometry = () => positionPanel();
  const handleKeyDown = (event: KeyboardEvent) => {
    if (select.disabled) return;
    if (event.key === 'Escape' && !panel.hidden) {
      close(true);
      event.preventDefault();
      return;
    }
    if (footer && !panel.hidden && event.key === 'Tab' && event.target === trigger && !event.shiftKey) {
      event.preventDefault(); (panel.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? footer).focus(); return;
    }
    if (footer && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      if (event.target === trigger) { open(); (panel.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? footer).focus(); }
      else {
        const controls = [...panel.querySelectorAll<HTMLButtonElement>('button')];
        const index = controls.indexOf(event.target as HTMLButtonElement);
        controls[(index + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length]?.focus();
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (event.target === trigger) {
        toggle();
        event.preventDefault();
      }
      return;
    }
    const options = Array.from(select.options);
    if (options.length === 0) return;
    const current = Math.max(0, options.findIndex((option) => option.value === select.value));
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    choose(options[(current + delta + options.length) % options.length].value);
    event.preventDefault();
  };

  trigger.addEventListener('click', handleTriggerClick);
  trigger.addEventListener('keydown', handleKeyDown);
  panel.addEventListener('keydown', handleKeyDown);
  select.addEventListener('change', handleSelectChange);
  window.addEventListener('pointerdown', handleWindowPointerDown, true);
  window.addEventListener('resize', handleWindowGeometry);
  window.addEventListener('scroll', handleWindowGeometry, true);
  setLabel(labelText);

  return {
    element,
    label,
    select,
    trigger,
    panel,
    refreshOptions,
    setFooterAction(label, action) {
      if (!footer) {
        footer = document.createElement('button'); footer.type = 'button'; footer.className = 'preview-dropdown-option preview-dropdown-footer';
        footer.addEventListener('click', () => { close(); footerAction?.(); });
      }
      footer.textContent = label; footerAction = action; refreshOptions();
    },
    syncFromSelect,
    setAppearance(appearance) {
      element.dataset.previewAppearance = appearance;
      panel.dataset.previewAppearance = appearance;
    },
    setLabel,
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      trigger.removeEventListener('click', handleTriggerClick);
      trigger.removeEventListener('keydown', handleKeyDown);
      panel.removeEventListener('keydown', handleKeyDown);
      select.removeEventListener('change', handleSelectChange);
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
      window.removeEventListener('resize', handleWindowGeometry);
      window.removeEventListener('scroll', handleWindowGeometry, true);
      panel.remove();
    }
  };
}
