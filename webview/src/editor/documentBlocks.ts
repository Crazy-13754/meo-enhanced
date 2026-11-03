/** Presentation port for host-owned containers; no editor implementation crosses it. */
export interface DocumentBlockInput {
  readonly language: string;
  readonly text: string;
  readonly line: number;
}
export interface DocumentBlocksPort {
  supports(language: string): boolean;
  mount(container: HTMLElement, input: DocumentBlockInput, edit?: () => void): { dispose(): void };
}
