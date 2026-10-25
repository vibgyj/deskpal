import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DownloadProgress } from '../src/core/progress.ts';
import { joinPassages, locateSpan, toExtract } from '../src/rag/extract.ts';

test('locateSpan finds answers the QA pipeline re-spaced', () => {
  const text = 'Run npx deskpal build-index ./docs to make the index.';
  const span = locateSpan(text, 'deskpal build - index');
  assert.deepEqual(span, { start: 8, end: 27 });
  assert.equal(text.slice(span!.start, span!.end), 'deskpal build-index');
  assert.ok(locateSpan('Add ONE script tag.', 'one script tag'));
  assert.equal(locateSpan('nothing here', 'missing words'), null);
  assert.equal(locateSpan('text', '   '), null);
});

test('locateSpan treats regex characters literally', () => {
  assert.ok(locateSpan('Use (a|b) or c.', '( a | b )'));
});

test('joinPassages keeps whole passages within the budget, best first', () => {
  const j = joinPassages(['aaaa', 'bbbb', 'cccc'], 12);
  assert.equal(j.context, 'aaaa\n\nbbbb');
  assert.deepEqual(j.offsets, [0, 6]);
  // A first passage longer than the budget is truncated rather than dropped.
  assert.equal(joinPassages(['x'.repeat(50)], 10).context, 'x'.repeat(10));
});

test('toExtract maps the answer back to its passage and local range', () => {
  const passages = ['The sky is blue.', 'Set data-index to the index URL.'];
  const joined = joinPassages(passages);
  const e = toExtract(passages, joined, 'data - index', 0.8)!;
  assert.equal(e.passage, 1);
  assert.equal(e.answer, 'data-index');
  assert.equal(passages[1]!.slice(e.start, e.end), 'data-index');
  assert.equal(e.score, 0.8);
  assert.equal(toExtract(passages, joined, '  ', 0.9), null);
  // Not found in the text: keep the model's answer without a range.
  assert.deepEqual(toExtract(passages, joined, 'elsewhere', 0.5), { passage: 0, answer: 'elsewhere', score: 0.5 });
});

test('download progress sums files against the expected total', () => {
  const seen: number[] = [];
  const p = new DownloadProgress(10, (f) => seen.push(f));
  p.update('a/model.onnx', 2e6, 6e6);
  p.update('b/model.onnx', 3e6, 4e6);
  p.update('a/model.onnx', 6e6, 6e6);
  assert.deepEqual(seen, [0.2, 0.5, 0.9]);
  p.update('c/extra', 5e6, 5e6);
  assert.equal(seen.at(-1), 1);
});
