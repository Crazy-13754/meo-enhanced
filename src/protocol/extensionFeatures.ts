export interface ExtraFeature {
  readonly id: string;
  readonly label: string;
  readonly labelZh?: string;
  readonly description?: string;
  readonly descriptionZh?: string;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly failed: boolean;
}
export interface ExtensionFeaturesState {
  readonly installed: boolean;
  readonly version: string;
  readonly features: readonly ExtraFeature[];
}
export type ExtensionFeaturesRequest = { readonly type: 'extensionFeaturesRequest'; readonly requestId: string } &
  ({ readonly action: 'get' | 'openDetails' } | { readonly action: 'setEnabled'; readonly id: string; readonly enabled: boolean });
export type ExtensionFeaturesEvent = { readonly type: 'extensionFeaturesChanged'; readonly state: ExtensionFeaturesState }
  | { readonly type: 'extensionFeaturesResult'; readonly requestId: string; readonly state: ExtensionFeaturesState; readonly failed: boolean };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
export function decodeExtensionFeaturesRequest(value: unknown): ExtensionFeaturesRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.type !== 'extensionFeaturesRequest' || typeof v.requestId !== 'string' || !v.requestId || v.requestId.length > 160) return null;
  if (v.action === 'get' || v.action === 'openDetails') return { type: v.type, requestId: v.requestId, action: v.action };
  return v.action === 'setEnabled' && identifier(v.id) && typeof v.enabled === 'boolean'
    ? { type: v.type, requestId: v.requestId, action: v.action, id: v.id, enabled: v.enabled } : null;
}
export function decodeExtensionFeaturesEvent(value: unknown): ExtensionFeaturesEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>, s = v.state as ExtensionFeaturesState | undefined;
  if (!['extensionFeaturesChanged', 'extensionFeaturesResult'].includes(String(v.type)) || !s || typeof s !== 'object'
    || typeof s.installed !== 'boolean' || typeof s.version !== 'string' || s.version.length > 100 || !Array.isArray(s.features) || s.features.length > 100) return null;
  const ids = new Set<string>();
  for (const feature of s.features) {
    if (!feature || !identifier(feature.id) || ids.has(feature.id) || typeof feature.label !== 'string' || !feature.label || feature.label.length > 200
      || ['labelZh', 'description', 'descriptionZh'].some(key => { const text = feature[key as keyof ExtraFeature]; return text !== undefined && (typeof text !== 'string' || text.length > 2000); })
      || [feature.enabled, feature.active, feature.failed].some(v => typeof v !== 'boolean')) return null;
    ids.add(feature.id);
  }
  if (v.type === 'extensionFeaturesChanged') return { type: v.type, state: s };
  return typeof v.requestId === 'string' && !!v.requestId && v.requestId.length <= 160 && typeof v.failed === 'boolean'
    ? { type: 'extensionFeaturesResult', requestId: v.requestId, state: s, failed: v.failed } : null;
}
