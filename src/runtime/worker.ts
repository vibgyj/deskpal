// dist/deskpal-worker.js: the runtime in a module Worker (SPEC §4), so
// inference never blocks the page and the character keeps animating. The
// widget talks to it through src/adapters/worker-client.ts.
import type { LocalGenerator } from '../adapters/browser-generative.ts';
import type { ExtractiveAdapter } from '../adapters/types.ts';
import type { Embedder } from '../rag/types.ts';
import { configure, loadEmbedder, loadExtractive, loadGenerator } from './index.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

let embedder: Embedder | null = null;
let extractive: ExtractiveAdapter | null = null;
let generator: LocalGenerator | null = null;
/** Extraction can't be interrupted; the widget ignores results it no longer wants. Generation can (`stop`). */
const never = new AbortController().signal;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const progress = (key: string, loaded: number, total: number) => post({ id: req.id, progress: [key, loaded, total] });
  try {
    switch (req.op) {
      case 'configure':
        configure(req.options);
        return post({ id: req.id, ok: true });
      case 'loadEmbedder':
        embedder = await loadEmbedder(req.model, progress);
        return post({ id: req.id, ok: true });
      case 'loadExtractive':
        extractive = await loadExtractive(req.model, req.minScore, progress);
        return post({ id: req.id, ok: true });
      case 'embed': {
        const v = await embedder!.embedQuery(req.text);
        return post({ id: req.id, ok: true, result: v }, [v.buffer]);
      }
      case 'extract':
        return post({ id: req.id, ok: true, result: await extractive!.extract(req.question, req.passages, never) });
      case 'loadGenerator':
        generator = await loadGenerator(req.model, progress);
        return post({ id: req.id, ok: true, result: { device: generator.device, dtype: generator.dtype } });
      case 'generate':
        await generator!.run(req.messages, (piece) => post({ id: req.id, piece }));
        return post({ id: req.id, ok: true });
      case 'stop':
        generator?.stop();
        return post({ id: req.id, ok: true });
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
