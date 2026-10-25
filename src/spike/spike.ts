// Runtime spike (SPEC §10): measures first-answer latency for candidate
// generation models and retrieval quality for candidate embedding models,
// on whatever machine opens this page.
import { loadIndex } from '../rag/loader.ts';
import { buildPrompt } from '../rag/prompt.ts';
import { Searcher } from '../rag/search.ts';
import type { DeskpalIndex, Hit } from '../rag/types.ts';
import { DEFAULT_EMBEDDING } from '../rag/embedding.ts';
import { docText, embedAll, EMBED_MODELS, queryText, type EmbedModel, type Extractor } from './embed.ts';
import { EVAL_QUESTIONS, GEN_MODELS, GEN_QUESTIONS, type Device, type GenModel } from './models.ts';

type Runtime = typeof import('./runtime.ts');

const CACHE = 'transformers-cache';
const DONT_KNOW = /\bi don'?t know\b/i;
const MAX_NEW_TOKENS = 80;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const now = () => performance.now();
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

interface Results {
  env: Record<string, unknown>;
  runtime?: { importMs: number };
  generation: Record<string, unknown>[];
  embeddings: Record<string, unknown>[];
  cspViolations: string[];
  errors: string[];
}

const results: Results = { env: {}, generation: [], embeddings: [], cspViolations: [], errors: [] };
let runtime: Runtime | null = null;
let index: DeskpalIndex;
let busy = false;

addEventListener('securitypolicyviolation', (e) => {
  results.cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`);
  render();
});

// ---- environment ---------------------------------------------------------

async function detectEnv(): Promise<void> {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: GPU };
  const env: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: nav.deviceMemory ?? null,
    crossOriginIsolated,
    secureContext: isSecureContext,
    browser: /(Chrome|Firefox|Version)\/[\d.]+/.exec(navigator.userAgent)?.[0] ?? '?',
    os: /Android [\d.]+|iPhone OS [\d_]+|Mac OS X [\d_]+|Windows NT [\d.]+|Linux/.exec(navigator.userAgent)?.[0] ?? '?',
    webgpu: false,
  };
  // Say why WebGPU is unavailable, so the fix is obvious.
  if (!isSecureContext) {
    env.webgpuReason = `not a secure context: open over https or localhost, or add ${location.origin} to chrome://flags/#unsafely-treat-insecure-origin-as-secure and relaunch Chrome`;
  } else if (!nav.gpu) {
    env.webgpuReason = 'this browser does not expose WebGPU (needs Chrome 121+ on Android 12+; see chrome://gpu)';
  } else {
    try {
      const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const info = adapter.info;
        env.webgpu = true;
        env.gpu = { vendor: info.vendor, architecture: info.architecture, description: info.description };
        env.shaderF16 = adapter.features.has('shader-f16');
      } else {
        env.webgpuReason = 'Chrome found no usable GPU: it may be blocklisted. Check "WebGPU" in chrome://gpu; chrome://flags/#enable-unsafe-webgpu overrides the blocklist';
      }
    } catch (err) {
      env.webgpuReason = `requestAdapter failed: ${String(err)}`;
    }
  }
  results.env = env;
  if (!env.webgpu) {
    for (const box of document.querySelectorAll<HTMLInputElement>('input[value=webgpu]')) {
      box.checked = false;
      box.disabled = true;
    }
  }
}

async function loadRuntime(): Promise<Runtime> {
  if (runtime) return runtime;
  const t = now();
  // Kept as a runtime URL so esbuild leaves it as a separate, lazily loaded file.
  const url = new URL('./runtime.js', import.meta.url).href;
  runtime = (await import(/* @vite-ignore */ url)) as Runtime;
  results.runtime = { importMs: round(now() - t) };
  // Self-hosted ONNX Runtime WASM instead of the jsdelivr default (SPEC §4).
  const base = new URL('./ort/', import.meta.url).href;
  runtime.env.backends.onnx.wasm!.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm` };
  // Otherwise transformers.js re-imports the WASM loader from a blob: URL,
  // which a strict CSP blocks unless script-src allows blob:. The HTTP cache
  // still caches the .wasm file.
  runtime.env.useWasmCache = false;
  runtime.env.allowLocalModels = false;
  return runtime;
}

async function isCached(modelId: string): Promise<boolean> {
  try {
    if (!(await caches.has(CACHE))) return false;
    const keys = await (await caches.open(CACHE)).keys();
    return keys.some((r) => r.url.includes(`/${modelId}/`));
  } catch {
    return false;
  }
}

/** Sums bytes per file from transformers.js progress events. */
function progressTracker(label: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  return {
    callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      status(`${label}: ${round(loaded / 1e6)} / ${round(total / 1e6)} MB`);
    },
    totalMB: () => round([...files.values()].reduce((a, f) => a + f.total, 0) / 1e6, 1),
  };
}

// ---- generation ----------------------------------------------------------

async function runGeneration(model: GenModel, device: Device, dtype: string): Promise<void> {
  const importedHere = !runtime;
  const rt = await loadRuntime();
  const row: Record<string, unknown> = { model: model.label, id: model.id, device, dtype, licence: model.licence };
  row.runtimeImportMs = importedHere ? results.runtime!.importMs : 0;
  results.generation.push(row);
  row.cached = await isCached(model.id);
  const progress = progressTracker(`Loading ${model.label} (${device}, ${dtype})`);
  let t = now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let generator: any;
  try {
    generator = await rt.pipeline('text-generation', model.id, { device, dtype: dtype as never, progress_callback: progress.callback as never });
  } catch (err) {
    row.error = `load: ${String(err)}`;
    results.errors.push(`${model.label} ${device}: ${String(err)}`);
    render();
    return;
  }
  row.loadMs = round(now() - t);
  row.downloadMB = progress.totalMB();
  render();

  const searcher = await widgetSearcher(rt);
  const answers: Record<string, unknown>[] = [];
  row.answers = answers;
  for (const question of GEN_QUESTIONS) {
    status(`${model.label} (${device}): ${question}`);
    const out = $('#stream');
    out.textContent = '';
    t = now();
    const hits: Hit[] = await searcher.search(question, { topK: 3, minScore: 0 });
    const retrievalMs = now() - t;
    const prompt = buildPrompt(question, hits);
    const promptTokens = generator.tokenizer.apply_chat_template(prompt.messages, {
      add_generation_prompt: true,
      tokenize: true,
      return_tensor: false,
      return_dict: false,
      ...model.template,
    }).length;
    let first = 0;
    let tokens = 0;
    let text = '';
    const streamer = new rt.TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (piece: string) => {
        text += piece;
        out.textContent = text;
      },
      token_callback_function: () => {
        tokens++;
        if (!first) first = now();
      },
    });
    const start = now();
    try {
      await generator(prompt.messages, {
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        repetition_penalty: 1.05,
        streamer,
        tokenizer_encode_kwargs: model.template,
      });
    } catch (err) {
      answers.push({ question, error: String(err) });
      results.errors.push(`${model.label} ${device} generate: ${String(err)}`);
      break;
    }
    const end = now();
    answers.push({
      question,
      promptTokens,
      retrievalMs: round(retrievalMs, 1),
      ttftMs: first ? round(first - start) : null,
      tokens,
      decodeTokPerS: first && tokens > 1 ? round((tokens - 1) / ((end - first) / 1000), 1) : null,
      totalMs: round(end - start),
      cites: /\[\d+\]/.test(text),
      saysDontKnow: DONT_KNOW.test(text),
      text: text.trim(),
    });
    render();
  }
  const firstAnswer = answers[0];
  if (firstAnswer && typeof firstAnswer.totalMs === 'number') {
    // What a visitor waits for on their first question: runtime + model + answer.
    row.firstAnswerMs = round((row.runtimeImportMs as number) + (row.loadMs as number) + firstAnswer.totalMs);
    row.firstAnswerColdCache = !row.cached;
  }
  await generator.dispose?.();
  render();
}

let searcher: Promise<Searcher> | null = null;

/** The widget's retrieval: bge-small vectors blended with keywords, when the index has vectors. */
function widgetSearcher(rt: Runtime): Promise<Searcher> {
  searcher ??= (async () => {
    if (index.model?.id !== DEFAULT_EMBEDDING.id) return new Searcher(index);
    const m = DEFAULT_EMBEDDING;
    const extractor = (await rt.pipeline('feature-extraction', m.id, { device: 'wasm', dtype: m.dtype as never })) as unknown as Extractor;
    return new Searcher(index, { id: m.id, dim: m.dim, embedQuery: async (q) => (await embedAll(extractor, m, [queryText(m, q)]))[0]! });
  })();
  return searcher;
}

// ---- embeddings ----------------------------------------------------------

interface Ranked {
  hit1: number;
  hit3: number;
  mrr: number;
}

function score(rankings: string[][]): Ranked {
  let hit1 = 0;
  let hit3 = 0;
  let mrr = 0;
  rankings.forEach((urls, i) => {
    const r = urls.indexOf(EVAL_QUESTIONS[i]!.expect);
    if (r === 0) hit1++;
    if (r >= 0 && r < 3) hit3++;
    if (r >= 0) mrr += 1 / (r + 1);
  });
  const n = rankings.length;
  return { hit1: round(hit1 / n, 2), hit3: round(hit3 / n, 2), mrr: round(mrr / n, 2) };
}

async function keywordBaseline(): Promise<Ranked> {
  const s = new Searcher(index);
  const rankings: string[][] = [];
  for (const { q } of EVAL_QUESTIONS) rankings.push((await s.search(q, { topK: index.chunks.length, minScore: 0 })).map((h) => h.chunk.url));
  return score(rankings);
}

async function nodeVectors(): Promise<Record<string, number[][]> | null> {
  try {
    const res = await fetch('./node-vectors.json');
    return res.ok ? ((await res.json()) as Record<string, number[][]>) : null;
  } catch {
    return null;
  }
}

async function runEmbedding(model: EmbedModel, device: Device): Promise<void> {
  const rt = await loadRuntime();
  const row: Record<string, unknown> = { model: model.label, id: model.id, device, dtype: model.dtype, licence: model.licence };
  results.embeddings.push(row);
  row.cached = await isCached(model.id);
  const progress = progressTracker(`Loading ${model.label} (${device})`);
  let t = now();
  let extractor: Extractor & { dispose?: () => Promise<void> };
  try {
    extractor = (await rt.pipeline('feature-extraction', model.id, { device, dtype: model.dtype as never, progress_callback: progress.callback as never })) as never;
  } catch (err) {
    row.error = `load: ${String(err)}`;
    results.errors.push(`${model.label} ${device}: ${String(err)}`);
    render();
    return;
  }
  row.loadMs = round(now() - t);
  row.downloadMB = progress.totalMB();

  status(`${model.label} (${device}): embedding ${index.chunks.length} chunks`);
  t = now();
  const docs = await embedAll(extractor, model, index.chunks.map(docText));
  row.docsEmbedMs = round(now() - t);

  // Warm-up, then time single queries as the widget will run them.
  await embedAll(extractor, model, [queryText(model, 'warm up')]);
  const queryTimes: number[] = [];
  const vecRank: string[][] = [];
  const hybridRank: string[][] = [];
  const kw = new Searcher(index);
  for (const { q } of EVAL_QUESTIONS) {
    t = now();
    const [qv] = await embedAll(extractor, model, [queryText(model, q)]);
    queryTimes.push(now() - t);
    const cos = docs.map((d) => d.reduce((a, x, i) => a + x * qv![i]!, 0));
    const kwScores = new Map((await kw.search(q, { topK: index.chunks.length, minScore: 0 })).map((h) => [h.chunk.id, h.keyword]));
    const order = (f: (i: number) => number) =>
      index.chunks
        .map((c, i) => ({ url: c.url, s: f(i) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.url);
    vecRank.push(order((i) => cos[i]!));
    hybridRank.push(order((i) => 0.7 * Math.max(0, cos[i]!) + 0.3 * (kwScores.get(index.chunks[i]!.id) ?? 0)));
  }
  queryTimes.sort((a, b) => a - b);
  row.queryMsMedian = round(queryTimes[Math.floor(queryTimes.length / 2)]!, 1);
  row.vector = score(vecRank);
  row.hybrid = score(hybridRank);

  const node = (await nodeVectors())?.[model.id];
  if (node) {
    // Same code path in Node (CLI) and browser: vectors should agree closely.
    const sims = docs.map((d, i) => d.reduce((a, x, j) => a + x * node[i]![j]!, 0));
    row.nodeParityMinCos = round(Math.min(...sims), 4);
  }
  await extractor.dispose?.();
  render();
}

// ---- UI ------------------------------------------------------------------

function status(text: string): void {
  $('#status').textContent = text;
}

function checked(name: string): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name=${name}]:checked`)].map((b) => b.value);
}

function cell(v: unknown): string {
  if (v === undefined || v === null) return '–';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function table(el: HTMLElement, rows: Record<string, unknown>[], cols: [string, (r: Record<string, unknown>) => unknown][]): void {
  el.replaceChildren();
  if (!rows.length) return;
  const t = document.createElement('table');
  const head = t.createTHead().insertRow();
  for (const [name] of cols) head.append(Object.assign(document.createElement('th'), { textContent: name }));
  const body = t.createTBody();
  for (const r of rows) {
    const tr = body.insertRow();
    for (const [, get] of cols) tr.insertCell().textContent = cell(get(r));
  }
  el.append(t);
}

type Answer = Record<string, number | string | boolean | null>;
const answersOf = (r: Record<string, unknown>) => (r.answers as Answer[] | undefined) ?? [];
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

function render(): void {
  const env = results.env;
  $('#env').textContent = [
    `Browser: ${env.browser} on ${env.os}, secure context: ${env.secureContext ? 'yes' : 'no'}`,
    `WebGPU: ${env.webgpu ? `yes (${JSON.stringify(env.gpu)}, shader-f16: ${env.shaderF16 ? 'yes' : 'no'})` : `no — ${env.webgpuReason}`}`,
    `CPU cores: ${env.cores}, device memory: ${env.deviceMemoryGB ?? '?'} GB, cross-origin isolated: ${env.crossOriginIsolated}`,
    results.runtime ? `Runtime import: ${results.runtime.importMs} ms` : 'Runtime not loaded yet',
  ].join('\n');

  table($('#gen-results'), results.generation, [
    ['Model', (r) => r.model],
    ['Device', (r) => `${r.device} ${r.dtype}`],
    ['Cache', (r) => (r.cached ? 'warm' : 'cold')],
    ['Download MB', (r) => r.downloadMB],
    ['Load ms', (r) => r.loadMs ?? r.error],
    ['TTFT ms (median)', (r) => median(answersOf(r).map((a) => a.ttftMs as number).filter(Boolean))],
    ['Decode tok/s (median)', (r) => median(answersOf(r).map((a) => a.decodeTokPerS as number).filter(Boolean))],
    ['First answer ms', (r) => r.firstAnswerMs],
    ['Cited', (r) => answersOf(r).slice(0, 5).filter((a) => a.cites).length + '/5'],
    ['Refused off-topic', (r) => answersOf(r).slice(5).filter((a) => a.saysDontKnow).length + '/2'],
  ]);

  const answers = $('#answers');
  answers.replaceChildren();
  for (const r of results.generation) {
    const d = document.createElement('details');
    d.append(Object.assign(document.createElement('summary'), { textContent: `${r.model} · ${r.device} ${r.dtype}` }));
    for (const a of answersOf(r)) {
      const p = document.createElement('div');
      p.className = 'answer';
      p.append(Object.assign(document.createElement('strong'), { textContent: String(a.question) }));
      p.append(Object.assign(document.createElement('p'), { textContent: String(a.text ?? a.error ?? '') }));
      d.append(p);
    }
    answers.append(d);
  }

  table($('#embed-results'), results.embeddings, [
    ['Model', (r) => r.model],
    ['Device', (r) => r.device],
    ['Download MB', (r) => r.downloadMB],
    ['Load ms', (r) => r.loadMs ?? r.error],
    ['Query ms (median)', (r) => r.queryMsMedian],
    ['Vector hit@1 / hit@3 / MRR', (r) => fmtRank(r.vector)],
    ['Hybrid hit@1 / hit@3 / MRR', (r) => fmtRank(r.hybrid)],
    ['Node parity (min cos)', (r) => r.nodeParityMinCos],
  ]);

  $('#problems').textContent = [...results.cspViolations.map((v) => `CSP: ${v}`), ...results.errors].join('\n') || 'None so far.';
  $<HTMLTextAreaElement>('#json').value = JSON.stringify(results, null, 2);
}

function fmtRank(r: unknown): string {
  const x = r as Ranked | undefined;
  return x ? `${x.hit1} / ${x.hit3} / ${x.mrr}` : '–';
}

async function guarded(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>('button.run')) b.disabled = true;
  try {
    await fn();
    status('Done.');
  } catch (err) {
    results.errors.push(String(err));
    status(`Failed: ${String(err)}`);
  } finally {
    busy = false;
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.run')) b.disabled = false;
    render();
  }
}

function setup(): void {
  const genList = $('#gen-models');
  for (const m of GEN_MODELS) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" name="gen" value="${m.id}"> ${m.label} <small>${m.dtype.webgpu.sizeMB} MB GPU / ${m.dtype.wasm.sizeMB} MB CPU · ${m.licence}</small>`;
    genList.append(label);
  }
  genList.querySelector<HTMLInputElement>('input')!.checked = true;
  const embedList = $('#embed-models');
  for (const m of EMBED_MODELS) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" name="embed" value="${m.id}" checked> ${m.label} <small>${m.sizeMB} MB · ${m.licence}</small>`;
    embedList.append(label);
  }

  $('#run-gen').addEventListener('click', () =>
    guarded(async () => {
      for (const id of checked('gen')) {
        const m = GEN_MODELS.find((x) => x.id === id)!;
        for (const device of checked('gen-device') as Device[]) {
          const dtype = device === 'webgpu' && !results.env.shaderF16 ? 'q4' : m.dtype[device].dtype;
          await runGeneration(m, device, dtype);
        }
      }
    }),
  );
  $('#run-embed').addEventListener('click', () =>
    guarded(async () => {
      results.embeddings.push({ model: 'keyword only (current)', device: '–', vector: await keywordBaseline() });
      for (const id of checked('embed')) {
        for (const device of checked('embed-device') as Device[]) await runEmbedding(EMBED_MODELS.find((x) => x.id === id)!, device);
      }
    }),
  );
  $('#clear-cache').addEventListener('click', async () => {
    await caches.delete(CACHE);
    status('Model cache cleared. The next run of each model is a cold download.');
  });
  $('#copy').addEventListener('click', () => void navigator.clipboard.writeText($<HTMLTextAreaElement>('#json').value).then(() => status('Results copied.')));
  $('#download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([$<HTMLTextAreaElement>('#json').value], { type: 'application/json' }));
    a.download = `deskpal-spike-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
  });
}

setup();
await detectEnv();
index = await loadIndex('/deskpal-index.json');
render();
status('Ready.');
