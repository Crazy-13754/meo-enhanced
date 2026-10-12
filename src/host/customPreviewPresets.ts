import { createHash } from 'node:crypto';
// The UMD entry hides relative require calls from Bun's Node bundler.
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser/lib/esm/main.js';
import postcss from 'postcss';
import { createCustomPreviewPreset, MAX_PRESET_FILE_BYTES, MAX_PRESET_PACKAGE_BYTES, parseCustomPreviewPresetManifest, type CustomPreviewPresetManifest } from '../foundation/customPreviewPreset';
import { isPreviewPresetId, type PreviewPresetDefinition, type PreviewPresetDiagnostic, type PreviewPresetId } from '../foundation/previewPresets';

export type StoredPreviewPreset = { manifest: CustomPreviewPresetManifest; files: Record<string, string> };
export type PreviewPresetStorage = {
  list(): Promise<string[]>;
  read(id: string): Promise<unknown>;
  /** Saves a complete package; failed updates keep a recoverable previous version. */
  write(id: string, preset: StoredPreviewPreset): Promise<void>;
  remove(id: string): Promise<void>;
};

/** Imported CSS belongs to the document; only variables may target its outer canvas. */
export function validatePresetCss(css: string, file: string): string {
  try {
    const root = postcss.parse(css, { from: file });
    root.walkAtRules(rule => {
      if (rule.name.toLowerCase() === 'page') {
        if (rule.params.trim() || !rule.nodes || rule.nodes.some(node => node.type !== 'comment' && (node.type !== 'decl' || !/^margin(?:-(?:top|right|bottom|left))?$/i.test(node.prop)))) throw rule.error('Only unqualified @page margin declarations are supported');
        return;
      }
      if (!['media', 'supports', 'layer'].includes(rule.name.toLowerCase()) || !rule.nodes) throw rule.error('Only @media, @supports and @layer blocks are supported');
    });
    root.walkRules(rule => {
      const selectors = postcss.list.comma(rule.selector);
      const variablesOnly = selectors.every(selector => [':root', 'html', 'body'].includes(selector.trim()));
      if (!variablesOnly && selectors.some(selector => !/^\.meo-export-doc(?:$|\s|[.:\[])/.test(selector.trim()) || /^\.meo-export-doc\s*[+~]/.test(selector.trim()))) throw rule.error('Prefix each document selector with .meo-export-doc');
      if (variablesOnly && rule.nodes.some(node => node.type !== 'comment' && (node.type !== 'decl' || !node.prop.startsWith('--')))) throw rule.error('html, body and :root may only define CSS variables');
      if (rule.nodes.some(node => !['decl', 'comment'].includes(node.type))) throw rule.error('Nested CSS rules are not supported; use explicit document selectors');
    });
    root.walkDecls(declaration => {
      if (declaration.parent?.type !== 'rule' && !(declaration.parent?.type === 'atrule' && declaration.parent.name.toLowerCase() === 'page')) throw declaration.error('Declarations must belong to a document rule');
      // Escaped spellings must not bypass the local-only resource policy.
      const value = declaration.value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff))).replace(/\\(.)/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/(?:url|image-set|expression)\s*\(/i.test(value) || /^(?:behavior|-moz-binding)$/i.test(declaration.prop)) throw declaration.error('External resources and executable CSS are not supported');
    });
    return root.toString();
  } catch (error) {
    // PostCSS resolves relative filenames against the host cwd; report the actual package reference.
    if (error instanceof postcss.CssSyntaxError) throw new Error(`${file}:${error.line ?? 1}:${error.column ?? 1}: ${error.reason}`);
    throw error;
  }
}

/** Validates complete package contents before they are loaded, saved or migrated. */
export function resolveStoredPreviewPreset(value: unknown): { stored: StoredPreviewPreset; definition: PreviewPresetDefinition } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved preset');
  const candidate = value as StoredPreviewPreset;
  const manifest = parseCustomPreviewPresetManifest(candidate.manifest);
  if (!candidate.files || typeof candidate.files !== 'object' || Array.isArray(candidate.files)) throw new Error('Missing preset CSS files');
  const files: Record<string, string> = {};
  const css: Partial<Record<'common' | 'light' | 'dark', string>> = {};
  let size = Buffer.byteLength(JSON.stringify(manifest));
  for (const [kind, path] of [['common', manifest.styles?.common], ['light', manifest.themes.light?.css], ['dark', manifest.themes.dark?.css]] as const) {
    if (!path) continue;
    const source = candidate.files[path];
    if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_PRESET_FILE_BYTES) throw new Error(`${path}: CSS file is missing or too large`);
    if (!(path in files)) { files[path] = source; size += Buffer.byteLength(source); }
    css[kind] = validatePresetCss(source, path);
  }
  if (size > MAX_PRESET_PACKAGE_BYTES) throw new Error('Preset package exceeds 2 MiB');
  const stored = { manifest, files };
  const revision = createHash('sha256').update(JSON.stringify(stored)).digest('hex');
  return { stored, definition: createCustomPreviewPreset(manifest, css, revision) };
}

export function parsePreviewPresetJsonc(jsonc: string): CustomPreviewPresetManifest {
  if (Buffer.byteLength(jsonc) > MAX_PRESET_FILE_BYTES) throw new Error('Preset configuration exceeds 512 KiB');
  const errors: ParseError[] = [];
  const value = parseJsonc(jsonc, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`preset.jsonc: ${printParseErrorCode(errors[0].error)} at character ${errors[0].offset + 1}`);
  return parseCustomPreviewPresetManifest(value);
}

export function createPreviewPresetLibrary(storage: PreviewPresetStorage) {
  const records = new Map<PreviewPresetId, ReturnType<typeof resolveStoredPreviewPreset>>();
  const diagnostics = new Map<string, PreviewPresetDiagnostic>();
  const reportError = (preset: PreviewPresetId | undefined, message: string) => {
    if (!diagnostics.has(preset ?? 'import') && diagnostics.size >= 100) diagnostics.delete(diagnostics.keys().next().value!);
    diagnostics.set(preset ?? 'import', { ...(preset ? { preset } : {}), message: message.trim().slice(0, 8000) || 'Preset operation failed' });
  };
  let writes: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writes.then(operation, operation);
    writes = result.catch(() => undefined);
    return result;
  };
  return {
    list: () => Array.from(records.values(), record => record.definition),
    get: (id: PreviewPresetId) => records.get(id)?.definition,
    files: (id: PreviewPresetId) => records.get(id)?.stored,
    diagnostics: () => [...diagnostics.values()],
    reportError,
    async load(): Promise<string[]> {
      return enqueue(async () => {
        const errors: string[] = [];
        for (const id of (await storage.list()).slice(0, 100)) {
          try {
            const record = resolveStoredPreviewPreset(await storage.read(id));
            if (record.stored.manifest.id !== id) throw new Error('Saved preset ID does not match its filename');
            records.set(record.definition.id, record);
            diagnostics.delete(record.definition.id);
          } catch (error) {
            const message = `${id}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(message);
            reportError(isPreviewPresetId(`user:${id}`) ? `user:${id}` : undefined, message);
          }
        }
        return errors;
      });
    },
    import(jsonc: string, readCss: (path: string) => Promise<string>): Promise<PreviewPresetDefinition> {
      return enqueue(async () => {
        let manifest: CustomPreviewPresetManifest | undefined;
        try {
          manifest = parsePreviewPresetJsonc(jsonc);
          if (records.size >= 100 && !records.has(`user:${manifest.id}`)) throw new Error('A maximum of 100 custom presets is supported');
          const files: Record<string, string> = {};
          for (const path of [manifest.styles?.common, manifest.themes.light?.css, manifest.themes.dark?.css]) if (path && !(path in files)) files[path] = await readCss(path);
          const record = resolveStoredPreviewPreset({ manifest, files });
          await storage.write(manifest.id, record.stored);
          records.set(record.definition.id, record);
          diagnostics.delete(record.definition.id);
          diagnostics.delete('import');
          return record.definition;
        } catch (error) {
          reportError(manifest ? `user:${manifest.id}` : undefined, error instanceof Error ? error.message : String(error));
          throw error;
        }
      });
    },
    remove(id: PreviewPresetId): Promise<void> {
      return enqueue(async () => {
        const record = records.get(id);
        if (!record) throw new Error('Custom preset is unavailable');
        await storage.remove(record.stored.manifest.id);
        records.delete(id);
        diagnostics.delete(id);
      });
    }
  };
}
