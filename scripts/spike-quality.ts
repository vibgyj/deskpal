// Answer-quality comparison for small models in Node. Quality (grounding,
// citations, refusals) does not depend on hardware, so this can run on any
// machine; latency has to be measured in the browser spike on target hardware.
//
//   node scripts/spike-quality.ts retrieve <out-dir>
//   node scripts/spike-quality.ts run <model-key> <out-dir> [question-number]
//
// Run each model in its own process (ideally under a memory cap) so one that
// is too big for the machine cannot take it down. DESKPAL_MODEL_CACHE sets
// where weights are downloaded, so they can be deleted between models.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, pipeline, TextStreamer } from '@huggingface/transformers';
import { parseIndex } from '../src/rag/loader.ts';
import { buildPrompt, SYSTEM_PROMPT } from '../src/rag/prompt.ts';
import { Searcher } from '../src/rag/search.ts';
import type { Chunk, Hit } from '../src/rag/types.ts';
import { docText, embedAll, EMBED_MODELS, queryText, type Extractor } from '../src/spike/embed.ts';
import { GEN_QUESTIONS } from '../src/spike/models.ts';

type Kind = 'chat' | 'text2text' | 'extractive' | 'pleias';

const MODELS: Record<string, { id: string; kind: Kind; dtype: string; template?: Record<string, unknown> }> = {
  'distilbert-squad': { id: 'Xenova/distilbert-base-cased-distilled-squad', kind: 'extractive', dtype: 'q8' },
  'flan-t5-small': { id: 'Xenova/flan-t5-small', kind: 'text2text', dtype: 'q8' },
  'smollm2-135m': { id: 'HuggingFaceTB/SmolLM2-135M-Instruct', kind: 'chat', dtype: 'q8' },
  'lfm2-350m': { id: 'onnx-community/LFM2-350M-ONNX', kind: 'chat', dtype: 'q4' },
  'gemma3-270m': { id: 'onnx-community/gemma-3-270m-it-ONNX', kind: 'chat', dtype: 'q4' },
  'smollm2-360m': { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', kind: 'chat', dtype: 'q8' },
  'qwen2.5-0.5b': { id: 'onnx-community/Qwen2.5-0.5B-Instruct', kind: 'chat', dtype: 'q8' },
  'qwen3-0.6b': { id: 'onnx-community/Qwen3-0.6B-ONNX', kind: 'chat', dtype: 'q8', template: { enable_thinking: false } },
  'pleias-rag-350m': { id: 'onnx-community/Pleias-RAG-350M-ONNX', kind: 'pleias', dtype: 'q8' },
  'granite4-h-350m': { id: 'onnx-community/granite-4.0-h-350m-ONNX', kind: 'chat', dtype: 'q4' },
};

const MAX_NEW_TOKENS = 80;
/** Pleias-RAG reasons (query and source analysis, draft) before its answer, so it needs room. */
const PLEIAS_MAX_NEW_TOKENS = 600;
const TOP_K = 3;
const DONT_KNOW = /\bi don'?t know\b/i;

interface Context {
  question: string;
  hits: Hit[];
}

const [mode, a, b, c] = process.argv.slice(2);

if (mode === 'retrieve') await retrieve(a!);
else if (mode === 'run') await run(a!, b!, c === undefined ? undefined : Number(c));
else throw new Error('usage: spike-quality.ts retrieve <out-dir> | run <model-key> <out-dir> [question-number]');

/** Best retrieval from the embedding comparison (bge-small, blended with keywords). */
async function retrieve(outDir: string): Promise<void> {
  const index = parseIndex(JSON.parse(await readFile('demo/deskpal-index.json', 'utf8')));
  const model = EMBED_MODELS.find((m) => m.id === 'Xenova/bge-small-en-v1.5')!;
  const extractor = (await pipeline('feature-extraction', model.id, { dtype: model.dtype as never })) as unknown as Extractor;
  const docs = await embedAll(extractor, model, index.chunks.map(docText));
  const keyword = new Searcher(index);
  const contexts: Context[] = [];
  for (const question of GEN_QUESTIONS) {
    const [q] = await embedAll(extractor, model, [queryText(model, question)]);
    const kw = new Map((await keyword.search(question, { topK: index.chunks.length, minScore: 0 })).map((h) => [h.chunk.id, h.keyword]));
    const hits = index.chunks
      .map((chunk, i): Hit => {
        const vector = docs[i]!.reduce((s, x, j) => s + x * q![j]!, 0);
        const k = kw.get(chunk.id) ?? 0;
        return { chunk, vector, keyword: k, score: 0.7 * Math.max(0, vector) + 0.3 * k };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, TOP_K);
    contexts.push({ question, hits });
  }
  await writeFile(join(outDir, 'contexts.json'), JSON.stringify(contexts, null, 2));
}

function sourcesText(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${[h.chunk.title, ...h.chunk.path.slice(1)].join(' > ')}\n${h.chunk.text}`).join('\n\n');
}

/** With `only`, answers just that question (1-based), so a model whose memory
 * grows between questions can still be judged one fresh process at a time. */
async function run(key: string, outDir: string, only?: number): Promise<void> {
  const spec = MODELS[key];
  if (!spec) throw new Error(`unknown model ${key}; one of ${Object.keys(MODELS).join(', ')}`);
  if (process.env.DESKPAL_MODEL_CACHE) env.cacheDir = process.env.DESKPAL_MODEL_CACHE;
  let contexts = JSON.parse(await readFile(join(outDir, 'contexts.json'), 'utf8')) as Context[];
  if (only !== undefined) contexts = contexts.slice(only - 1, only);

  let t = performance.now();
  const task = spec.kind === 'text2text' ? 'text2text-generation' : spec.kind === 'extractive' ? 'question-answering' : 'text-generation';
  // DESKPAL_NO_ARENA=1 trades some speed for a much lower peak: ONNX Runtime
  // then allocates per run instead of growing a pooled arena.
  const session_options = process.env.DESKPAL_NO_ARENA === '1' ? { enableCpuMemArena: false, enableMemPattern: false } : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipe: any = await pipeline(task, spec.id, { dtype: spec.dtype as never, session_options });
  const loadMs = Math.round(performance.now() - t);

  const answers = [];
  const outFile = join(outDir, only === undefined ? `${key}.json` : `${key}.q${only}.json`);
  for (const { question, hits } of contexts) {
    t = performance.now();
    let text = '';
    let tokens = 0;
    let score: number | null = null;
    let raw: string | undefined;
    if (spec.kind === 'chat') {
      const streamer = new TextStreamer(pipe.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (piece: string) => void (text += piece),
        token_callback_function: () => void tokens++,
      });
      await pipe(buildPrompt(question, hits).messages, {
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        repetition_penalty: 1.05,
        streamer,
        tokenizer_encode_kwargs: spec.template,
      });
    } else if (spec.kind === 'pleias') {
      raw = '';
      const streamer = new TextStreamer(pipe.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: false,
        callback_function: (piece: string) => void (raw += piece),
        token_callback_function: () => void tokens++,
      });
      await pipe(pleiasPrompt(question, hits), { max_new_tokens: PLEIAS_MAX_NEW_TOKENS, do_sample: false, streamer, return_full_text: false });
      text = pleiasAnswer(raw);
    } else if (spec.kind === 'text2text') {
      const prompt = `${SYSTEM_PROMPT}\n\nSources:\n\n${sourcesText(hits)}\n\nQuestion: ${question}`;
      const [out] = await pipe(prompt, { max_new_tokens: MAX_NEW_TOKENS, do_sample: false });
      text = out.generated_text;
    } else {
      // Extractive: the answer is a span copied from the docs, with a confidence score.
      const out = await pipe(question, hits.map((h: Hit) => h.chunk.text).join('\n\n'));
      text = out.answer;
      score = Math.round(out.score * 1000) / 1000;
    }
    const ms = Math.round(performance.now() - t);
    const from = hits.findIndex((h: Hit) => (h.chunk as Chunk).text.includes(text.trim()));
    answers.push({
      question,
      sources: hits.map((h) => `${h.chunk.url} (${h.score.toFixed(2)})`),
      text: text.trim(),
      ms,
      tokens,
      score,
      cites: /\[\d+\]/.test(text),
      saysDontKnow: DONT_KNOW.test(text),
      verbatimFromSource: from >= 0 ? from + 1 : null,
      ...(raw === undefined ? {} : { raw }),
    });
    // Saved after every answer, so a run that is stopped or killed keeps what it has.
    await writeFile(outFile, JSON.stringify({ key, ...spec, loadMs, answers }, null, 2));
    process.stdout.write(`${key}: ${question} (${ms} ms, ${tokens} tokens)\n  ${text.trim().replace(/\s+/g, ' ')}\n`);
  }
}

/** Pleias-RAG's input format, as built by its reference library (RAGWithCitations.format_prompt). */
function pleiasPrompt(question: string, hits: Hit[]): string {
  const sources = hits.map((h, i) => `<|source_start|><|source_id|>${i + 1} ${docText(h.chunk)}<|source_end|>\n`).join('');
  return `<|query_start|>${question}<|query_end|>\n${sources}<|language_start|>\n`;
}

/** The answer section, with `<ref name="N">quote</ref>` citations shortened to [N]. Empty if cut off before it. */
function pleiasAnswer(raw: string): string {
  const answer = /<\|answer_start\|>([\s\S]*?)(?:<\|answer_end\|>|$)/.exec(raw)?.[1] ?? '';
  return answer.replace(/<ref name="(?:<\|source_id\|>)?(\d+)">[\s\S]*?<\/ref>/g, '[$1]').trim();
}
