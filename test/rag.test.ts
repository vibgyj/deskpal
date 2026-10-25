import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt } from '../src/rag/prompt.ts';
import { dequantizeInt8, normalize, quantizeInt8 } from '../src/rag/quantize.ts';
import { IndexModelMismatch, Searcher } from '../src/rag/search.ts';
import { terms } from '../src/rag/text.ts';
import type { DeskpalIndex, Embedder } from '../src/rag/types.ts';

const chunk = (id: string, title: string, text: string) => ({ id, title, path: [title], url: `/${id}`, text });

const index: DeskpalIndex = {
  format: 'deskpal-index',
  version: 1,
  model: null,
  chunks: [
    chunk('install', 'Installing', 'Add the script tag with data-index pointing at your deskpal-index.json file.'),
    chunk('csp', 'Content Security Policy', 'WebAssembly needs wasm-unsafe-eval in script-src. Models on another origin need connect-src.'),
    chunk('skins', 'Skins', 'A skin is a manifest plus sprite sheets. Every skin provides the required animations.'),
  ],
};

test('int8 quantisation round-trips within a step', () => {
  const v = new Float32Array([0.5, -1, 0.25, 0, 0.999]);
  const { v: b64, s } = quantizeInt8(v);
  const back = dequantizeInt8(b64, s);
  assert.equal(back.length, v.length);
  v.forEach((x, i) => assert.ok(Math.abs(x - back[i]!) <= s / 2 + 1e-6));
});

test('terms drop stopwords and split compound tokens', () => {
  assert.deepEqual(terms('How do I set the data-index?'), ['set', 'data-index', 'data', 'index']);
  assert.deepEqual(terms('skins needs policies status'), ['skin', 'need', 'policy', 'status']);
});

test('keyword search ranks the matching chunk first and gates on score', async () => {
  const s = new Searcher(index);
  const hits = await s.search('which csp script-src does wasm need');
  assert.equal(hits[0]?.chunk.id, 'csp');
  assert.ok(hits[0]!.score > 0.3);
  assert.deepEqual(await s.search('banana pancakes recipe'), []);
});

test('scores stay within [0, 1]', async () => {
  const s = new Searcher(index);
  for (const h of await s.search('skin skins skin manifest sprite', { minScore: 0 })) {
    assert.ok(h.score >= 0 && h.score <= 1, String(h.score));
  }
});

test('an index built with another model is refused', () => {
  const withModel: DeskpalIndex = { ...index, model: { id: 'model-a', dim: 3, quant: 'int8' } };
  const embedder: Embedder = { id: 'model-b', dim: 3, embedQuery: async () => new Float32Array(3) };
  assert.throws(() => new Searcher(withModel, embedder), IndexModelMismatch);
});

test('vectors are combined with keyword scores when the models match', async () => {
  const vecs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => quantizeInt8(normalize(new Float32Array(v))));
  const withModel: DeskpalIndex = {
    ...index,
    model: { id: 'm', dim: 3, quant: 'int8' },
    chunks: index.chunks.map((c, i) => ({ ...c, ...vecs[i]! })),
  };
  const embedder: Embedder = { id: 'm', dim: 3, embedQuery: async () => new Float32Array([0, 0, 1]) };
  const s = new Searcher(withModel, embedder);
  assert.ok(s.usesVectors);
  const hits = await s.search('character appearance', { minScore: 0.5 });
  assert.equal(hits[0]?.chunk.id, 'skins');
  assert.ok(hits[0]!.vector! > 0.99);
});

test('the prompt numbers sources and carries the question', async () => {
  const hits = await new Searcher(index).search('wasm script-src');
  const p = buildPrompt('What CSP do I need?', hits);
  assert.equal(p.messages[0]!.role, 'system');
  assert.match(p.messages[0]!.content, /ONLY the numbered sources/);
  assert.match(p.messages[0]!.content, /\[1\] Content Security Policy\nWebAssembly/);
  assert.deepEqual(p.messages[1], { role: 'user', content: 'What CSP do I need?' });
});
