import type { DocumentText } from '../../../src/foundation/documentSnapshot';
import type { DocumentStatisticsMessage } from '../../../src/protocol/documentStatistics';
import type { StatisticsRequest, StatisticsSelection } from './documentStatisticsIndex';

export function createDocumentStatisticsReporter(
  read: () => { text: DocumentText; selections: StatisticsSelection[]; line: number | null; hasSelection?: boolean } | null,
  post: (message: DocumentStatisticsMessage) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let worker: Worker | undefined, loading: Promise<void> | undefined;
  let sentText: DocumentText | undefined;
  let generation = 0, busy = false, disposed = false;
  const fail = () => {
    worker?.terminate(); worker = undefined; sentText = undefined; busy = false;
    clearTimeout(deadline); post({ type: 'documentStatistics', statistics: null });
  };
  const run = async () => {
    timer = undefined;
    if (disposed || busy) return;
    const state = read(); if (!state) return;
    const id = generation;
    try {
      if (!worker) {
        if (!loading) loading = (async () => {
          const uri = document.body.dataset.meoStatisticsWorkerSrc;
          if (!uri) throw new Error('Statistics worker URI missing');
          const response = await fetch(uri, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error('Statistics worker unavailable');
          const source = await response.text(); if (disposed) return;
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
          worker.onerror = event => { event.preventDefault(); fail(); };
          worker.onmessageerror = fail;
          worker.onmessage = ({ data }: MessageEvent<DocumentStatisticsMessage & { id: number }>) => {
            clearTimeout(deadline); busy = false;
            if (disposed) return;
            if (data.id === generation) post({ type: 'documentStatistics', statistics: data.statistics });
            else schedule();
          };
        })().finally(() => { loading = undefined; });
        await loading;
      }
      if (disposed || !worker || busy) return;
      if (id !== generation) { schedule(); return; }
      const text = state.text !== sentText ? state.text.toString() : undefined;
      worker.postMessage({ id, text, selections: state.selections, line: state.line, hasSelection: state.hasSelection } satisfies StatisticsRequest);
      sentText = state.text; busy = true;
      deadline = setTimeout(fail, 10_000);
    } catch { if (!disposed) fail(); }
  };
  const schedule = () => { if (disposed) return; generation++; clearTimeout(timer); timer = setTimeout(() => void run(), 180); };
  return { schedule, dispose() { disposed = true; clearTimeout(timer); clearTimeout(deadline); worker?.terminate(); } };
}
