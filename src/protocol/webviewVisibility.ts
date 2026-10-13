export type WebviewVisibilityRequest = {
  readonly type: 'requestWebviewVisibility';
  readonly requestId: string;
};

export type WebviewVisibilityResponse = {
  readonly type: 'webviewVisibilityResult';
  readonly requestId: string;
  readonly visible: boolean;
};

function isRequest(value: unknown): value is Record<string, unknown> & { requestId: string } {
  return typeof value === 'object' && value !== null && 'requestId' in value
    && typeof value.requestId === 'string' && value.requestId.length > 0;
}

export function decodeWebviewVisibilityRequest(value: unknown): WebviewVisibilityRequest | null {
  return isRequest(value) && value.type === 'requestWebviewVisibility' ? value as WebviewVisibilityRequest : null;
}

export function decodeWebviewVisibilityResponse(value: unknown): WebviewVisibilityResponse | null {
  return isRequest(value) && value.type === 'webviewVisibilityResult' && typeof value.visible === 'boolean'
    ? value as WebviewVisibilityResponse : null;
}
