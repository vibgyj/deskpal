// The built widget (dist/) in a real browser, on pages served under the strict
// Content Security Policy the docs recommend. Indexes come from the repo's
// demo/docs; the embedding server and the writer are local fakes, so nothing
// is downloaded and no keys are needed.
//
//   npm run test:browser      (builds first; needs `npx playwright install chromium`)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { buildIndex } from '../../src/cli/build-index.ts';
import { DEFAULT_EMBEDDING } from '../../src/rag/embedding.ts';
import { dequantizeInt8 } from '../../src/rag/quantize.ts';
import type { DeskpalIndex } from '../../src/rag/types.ts';

const DIST = new URL('../../dist/', import.meta.url);
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
const VOICE = { greeting: 'GREETING', snippets: 'SNIPPETS', dontKnow: 'DONTKNOW', hello: 'HELLO', error: 'ERROR' };
const DIM = DEFAULT_EMBEDDING.dim;
const oneHot = (i: number) => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
const EMBED_QUESTION = 'where does my server embed the questions?';

const PAGES: Record<string, object> = {
  keyword: { index: '/keyword-index.json' },
  server: { index: '/vector-index.json', embedEndpoint: '/api/embed' },
  writer: { index: '/keyword-index.json', adapter: 'openai-compatible', endpoint: '/api/llm', model: 'test' },
};

let keywordIndex: DeskpalIndex;
let vectorIndex: DeskpalIndex;
/** What the fake embedding server does next: answer, or refuse as a rate limit would. */
let embedMode: 'ok' | '429' = 'ok';
const requests: string[] = [];
let base = '';
let browser: Browser;

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  requests.push(url.pathname);
  let body = '';
  for await (const c of req) body += c;
  const send = (status: number, type: string, data: string | Buffer, headers: Record<string, string> = {}) =>
    res.writeHead(status, { 'content-type': type, 'content-security-policy': CSP, ...headers }).end(data);

  if (url.pathname === '/') {
    const config = { voice: VOICE, adapter: 'none', ...PAGES[url.searchParams.get('page') ?? 'keyword'] };
    return send(200, 'text/html; charset=utf-8', `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>deskpal test</title>
<script type="application/json" id="deskpal-config">${JSON.stringify(config)}</script>
<script defer src="/deskpal.js"></script></head><body><main><h1>A docs site</h1><p>Some page content.</p></main></body></html>`);
  }
  if (url.pathname === '/keyword-index.json') return send(200, 'application/json', JSON.stringify(keywordIndex));
  if (url.pathname === '/vector-index.json') return send(200, 'application/json', JSON.stringify(vectorIndex));
  if (url.pathname === '/api/embed') {
    if (embedMode === '429') return send(429, 'application/json', '{"error":"slow down"}', { 'retry-after': '30' });
    const { texts } = JSON.parse(body) as { texts: string[] };
    const vectors = texts.map((t) => (t === EMBED_QUESTION ? sectionVector('Embedding questions on your server') : oneHot(DIM - 1)));
    return send(200, 'application/json', JSON.stringify({ model: DEFAULT_EMBEDDING.id, vectors }));
  }
  if (url.pathname === '/api/llm/chat/completions') return streamAnswer(res, JSON.parse(body));
  if (/^\/[\w.-]+\.(js|map)$/.test(url.pathname)) {
    try {
      return send(200, 'text/javascript; charset=utf-8', await readFile(new URL(url.pathname.slice(1), DIST)));
    } catch {
      // fall through to 404
    }
  }
  send(404, 'text/plain', 'not found');
});

/** An OpenAI-style stream that cites the second source. */
async function streamAnswer(res: ServerResponse, body: { messages: { content: string }[]; stream: boolean }) {
  assert.equal(body.stream, true);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const piece of ['Edit the ', 'manifest ', 'file [2].']) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    await new Promise((r) => setTimeout(r, 30));
  }
  res.end('data: [DONE]\n\n');
}

function sectionVector(heading: string): number[] {
  const c = vectorIndex.chunks.find((c) => c.path.at(-1) === heading)!;
  return [...dequantizeInt8(c.v!, c.s!)];
}

before(async () => {
  const docs = { docsDir: 'demo/docs', baseUrl: '/docs/', mdExt: '.html', maxChars: 1500 };
  keywordIndex = await buildIndex(docs);
  let n = 0;
  vectorIndex = await buildIndex({ ...docs, embedding: { model: DEFAULT_EMBEDDING, embed: async (chunks) => chunks.map(() => Float32Array.from(oneHot(n++))) } });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server.close();
});

/** A fresh visitor on a page, failing the test on any script error or CSP violation. */
async function visit(page: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const problems: string[] = [];
  tab.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  tab.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  tab.on('request', (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith('data:')) problems.push(`left the site: ${r.url()}`);
  });
  await tab.goto(`${base}/?page=${page}`);
  await tab.locator('[data-deskpal] .launcher canvas').waitFor();
  return { tab, context, problems };
}

const widget = (tab: Page) => tab.locator('[data-deskpal]');
const lastBot = (tab: Page) => widget(tab).locator('.log .msg.bot:not(.note)').last();

async function ask(tab: Page, question: string) {
  const before = await widget(tab).locator('.log .msg.bot:not(.note)').count();
  await widget(tab).locator('input').fill(question);
  await widget(tab).locator('input').press('Enter');
  await tab.waitForFunction(
    (n) => document.querySelector('[data-deskpal]')!.shadowRoot!.querySelectorAll('.log .msg.bot:not(.note)').length > n,
    before,
  );
  // Streaming answers grow after they appear: wait until the sources are in.
  await tab.waitForTimeout(150);
}

test('keyword docs: open, answer, don\'t know, small talk, under a strict CSP', async () => {
  const { tab, context, problems } = await visit('keyword');
  await widget(tab).locator('.launcher').click();
  await assert.doesNotReject(widget(tab).locator('.bubble').waitFor({ state: 'visible' }));
  assert.equal(await lastBot(tab).locator('.text').textContent(), 'GREETING');

  await ask(tab, 'How do I write a skin manifest?');
  assert.equal(await lastBot(tab).locator('.text').textContent(), 'SNIPPETS');
  const links = await lastBot(tab).locator('.sources a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  assert.ok(links.some((l) => l.endsWith('/docs/skins.html#manifest-format')), links.join(' '));

  await ask(tab, 'What is the capital of Mongolia?');
  assert.equal(await lastBot(tab).locator('.text').textContent(), 'DONTKNOW');

  await ask(tab, 'hello!');
  assert.equal(await lastBot(tab).locator('.text').textContent(), 'HELLO');

  await tab.keyboard.press('Escape');
  await widget(tab).locator('.bubble').waitFor({ state: 'hidden' });
  assert.deepEqual(problems, []);
  await context.close();
});

test('server embedding: no model download; a 429 falls back to keywords', async () => {
  const { tab, context, problems } = await visit('server');
  await widget(tab).locator('.launcher').click();
  requests.length = 0;
  embedMode = 'ok';
  await ask(tab, EMBED_QUESTION);
  const links = await lastBot(tab).locator('.sources a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  assert.deepEqual(links, [`${base}/docs/models.html#embedding-questions-on-your-server`]);
  assert.ok(requests.includes('/api/embed'));
  assert.ok(!requests.some((r) => r.includes('runtime') || r.includes('worker')), `no model runtime fetched: ${requests.join(' ')}`);
  assert.equal(await widget(tab).getByRole('button', { name: 'Download' }).count(), 0, 'no download prompt');

  embedMode = '429';
  await ask(tab, 'How do I write a skin manifest?');
  assert.equal(await lastBot(tab).locator('.text').textContent(), 'SNIPPETS');
  embedMode = 'ok';
  // The browser itself logs the 429; the widget only warns.
  assert.deepEqual(problems.filter((p) => !/status of 429/.test(p)), []);
  await context.close();
});

test('cloud writer: the answer streams in and cites its source', async () => {
  const { tab, context, problems } = await visit('writer');
  await widget(tab).locator('.launcher').click();
  await ask(tab, 'How do I write a skin manifest?');
  await tab.waitForFunction(() => document.querySelector('[data-deskpal]')!.shadowRoot!.querySelector('.sources-label')?.textContent === 'Sources:');
  assert.equal(await lastBot(tab).locator('.text').textContent(), 'Edit the manifest file [2].');
  assert.equal(await lastBot(tab).locator('.sources a').count(), 1);
  assert.deepEqual(problems, []);
  await context.close();
});

test('position and hiding are remembered across visits', async () => {
  const { tab, context, problems } = await visit('keyword');
  const launcher = widget(tab).locator('.launcher');
  const box = (await launcher.boundingBox())!;
  await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await tab.mouse.down();
  await tab.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2 - 200, { steps: 8 });
  await tab.mouse.up();
  const moved = (await launcher.boundingBox())!;
  assert.ok(Math.abs(moved.x - (box.x - 300)) < 20 && Math.abs(moved.y - (box.y - 200)) < 20, `dragged to ${moved.x},${moved.y}`);
  assert.equal(await widget(tab).locator('.bubble').isVisible(), false, 'a drag is not a click');

  await tab.reload();
  await widget(tab).locator('.launcher canvas').waitFor();
  const after = (await widget(tab).locator('.launcher').boundingBox())!;
  assert.ok(Math.abs(after.x - moved.x) < 2 && Math.abs(after.y - moved.y) < 2, 'same place after reload');

  await widget(tab).locator('.launcher').click();
  await widget(tab).getByRole('button', { name: /^Hide / }).click();
  await widget(tab).locator('.restore').waitFor();
  await tab.reload();
  await widget(tab).locator('.restore').waitFor();
  assert.equal(await widget(tab).locator('.launcher').isVisible(), false, 'still hidden');
  assert.deepEqual(problems, []);
  await context.close();
});

test('on a phone, the open bubble fits the screen', async () => {
  const { tab, context, problems } = await visit('keyword', { width: 375, height: 667 });
  await widget(tab).locator('.launcher').click();
  await ask(tab, 'How do I write a skin manifest?');
  const bubble = (await widget(tab).locator('.bubble').boundingBox())!;
  assert.ok(bubble.x >= 0 && bubble.x + bubble.width <= 375, `bubble spans ${bubble.x}–${bubble.x + bubble.width}`);
  assert.ok(bubble.y >= 0 && bubble.y + bubble.height <= 667, `bubble spans ${bubble.y}–${bubble.y + bubble.height} vertically`);
  assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth), 375, 'no sideways scrolling');
  assert.deepEqual(problems, []);
  await context.close();
});
