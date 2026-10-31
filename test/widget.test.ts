// The widget end to end in a fake DOM: question in, what the visitor sees out.
// Uses the repo's own demo docs; models, the embedding server and writers are
// stand-ins, so nothing is downloaded.
import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import type { DeskpalConfig } from '../src/core/config.ts';
import type { Prompt } from '../src/rag/prompt.ts';
import type { DeskpalIndex } from '../src/rag/types.ts';

const { teardown } = await import('./support/dom.ts');
const { Deskpal } = await import('../src/app.ts');
const { resolveConfig } = await import('../src/core/config.ts');
const { buildIndex } = await import('../src/cli/build-index.ts');
const { DEFAULT_EMBEDDING } = await import('../src/rag/embedding.ts');
const { dequantizeInt8 } = await import('../src/rag/quantize.ts');
const { INTENT_EXAMPLES } = await import('../src/persona/smalltalk.ts');

// One fixed line per line set, so the tests can tell which one was said.
const VOICE = Object.fromEntries(
  ['greeting', 'thinking', 'found', 'unsure', 'snippets', 'dontKnow', 'noDocs', 'error', 'nextBest', 'outOfIdeas', 'hello'].map((k) => [k, k.toUpperCase()]),
);
const DIM = DEFAULT_EMBEDDING.dim;
const oneHot = (i: number) => Float32Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));

// ---- fixtures -------------------------------------------------------------

const docs = { docsDir: 'demo/docs', baseUrl: '/docs/', mdExt: '.html', maxChars: 1500 };
let keywordIndex: DeskpalIndex;
/** Each section gets its own direction, so a question "about" a section is exactly its vector. */
let vectorIndex: DeskpalIndex;

before(async () => {
  keywordIndex = await buildIndex(docs);
  let n = 0;
  vectorIndex = await buildIndex({ ...docs, embedding: { model: DEFAULT_EMBEDDING, embed: async (chunks) => chunks.map(() => oneHot(n++)) } });
  assert.ok(n < DIM - 4, 'room left for the off-topic directions');
});
after(teardown);

function sectionVector(heading: string): Float32Array {
  const c = vectorIndex.chunks.find((c) => c.path.at(-1) === heading);
  assert.ok(c, `no section "${heading}" in demo/docs`);
  return dequantizeInt8(c.v!, c.s!);
}

/** What the fake embedding server answers for each text; anything else points nowhere near the docs. */
function embedTable(): (text: string) => number[] {
  const hello = oneHot(DIM - 1);
  const otherSmallTalk = oneHot(DIM - 2);
  const table = new Map<string, Float32Array>([
    ['where does my server embed the questions?', sectionVector('Embedding questions on your server')],
    ['greetings, desk friend', hello],
    ...INTENT_EXAMPLES.hello.map((t) => [t, hello] as [string, Float32Array]),
  ]);
  return (text) => [...(table.get(text) ?? (Object.values(INTENT_EXAMPLES).flat().includes(text) ? otherSmallTalk : oneHot(DIM - 3)))];
}

// ---- a fake site ----------------------------------------------------------

type Handler = (body: any) => Response | Promise<Response>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Replaces fetch with these routes, and records each call. */
function site(t: TestContext, routes: Record<string, Handler>) {
  const calls: { path: string; body: any }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), document.baseURI);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, body });
    const route = routes[url.pathname];
    return route ? route(body) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  t.after(() => (globalThis.fetch = real));
  return calls;
}

const embedServer = (answer = embedTable()): Handler => (body: { texts: string[] }) => json({ model: DEFAULT_EMBEDDING.id, vectors: body.texts.map(answer) });

let siteN = 0;
function mount(t: TestContext, options: Partial<DeskpalConfig>) {
  const pal = new Deskpal(resolveConfig({ siteKey: `test-${++siteN}`, voice: VOICE, adapter: 'none', index: '/index.json', worker: false, ...options }));
  t.after(() => pal.destroy());
  const hosts = document.querySelectorAll('[data-deskpal]');
  const root = hosts[hosts.length - 1]!.shadowRoot!;
  const $ = <E extends Element = HTMLElement>(sel: string) => root.querySelector<E>(sel);
  const messages = () => [...root.querySelectorAll('.log .msg')].map((m) => ({
    kind: m.classList.contains('user') ? 'user' : m.classList.contains('note') ? 'note' : 'bot',
    text: m.querySelector('.text')!.textContent!,
    links: [...m.querySelectorAll('.sources a, .from a')].map((a) => (a as HTMLAnchorElement).getAttribute('href')!),
    el: m as HTMLElement,
  }));
  const last = () => messages().at(-1)!;
  return { pal, root, $, messages, last };
}

async function waitFor<T>(check: () => T, what: string, ms = 3000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = check();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const quiet = (t: TestContext) => {
  for (const level of ['error', 'warn', 'info'] as const) t.mock.method(console, level, () => {});
};

// ---- searching the docs ---------------------------------------------------

test('keyword index: a docs question gets the matching sections, linked', async (t) => {
  const calls = site(t, { '/index.json': () => json(keywordIndex) });
  const w = mount(t, {});
  await w.pal.ask('How do I write a skin manifest?');
  const answer = w.last();
  assert.equal(answer.text, 'SNIPPETS');
  assert.ok(answer.links.includes('https://docs.example/docs/skins.html#manifest-format'), answer.links.join(' '));
  assert.ok(answer.el.querySelector('.snippet'), 'each source shows a snippet');
  assert.deepEqual(w.messages().map((m) => m.kind), ['bot', 'user', 'bot'], 'greeting, question, answer; no thinking line left');
  assert.deepEqual(calls.map((c) => c.path), ['/index.json']);
});

test('keyword index: an off-topic question gets "I don\'t know"', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  const w = mount(t, {});
  await w.pal.ask('What is the capital of Mongolia?');
  assert.equal(w.last().text, 'DONTKNOW');
});

test('small talk is answered without searching', async (t) => {
  const calls = site(t, { '/index.json': () => json(keywordIndex) });
  const w = mount(t, { adapter: 'custom', generate: () => assert.fail('no writer for small talk') });
  await w.pal.ask('hello!');
  assert.equal(w.last().text, 'HELLO');
  assert.ok(calls.every((c) => c.path === '/index.json'));
});

test('no index: says it has no docs', async (t) => {
  quiet(t);
  site(t, {});
  const w = mount(t, {});
  await w.pal.ask('How do I install it?');
  assert.equal(w.last().text, 'NODOCS');
});

test('an index from a model the widget does not know still works by keyword', async (t) => {
  quiet(t);
  site(t, { '/index.json': () => json({ ...keywordIndex, model: { id: 'someone/else', dim: 99, quant: 'int8' } }) });
  const w = mount(t, {});
  await w.pal.ask('How do I write a skin manifest?');
  assert.equal(w.last().text, 'SNIPPETS', 'answered from keywords, with no download prompt');
  assert.match(String((console.error as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls[0]?.arguments[0]), /can't embed questions/);
});

test('links only ever point to web pages', async (t) => {
  const chunk = { id: 'x', title: 'Bad', path: ['Bad'], url: 'javascript:alert(1)', text: 'Click the evil button to do evil things.' };
  site(t, { '/index.json': () => json({ format: 'deskpal-index', version: 1, model: null, chunks: [chunk] }) });
  const w = mount(t, {});
  await w.pal.ask('evil button');
  assert.equal(w.last().text, 'SNIPPETS');
  assert.equal(w.last().el.querySelectorAll('a').length, 0);
  assert.equal(w.last().el.querySelector('.sources span')!.textContent, 'Bad');
});

// ---- questions embedded by the site's server ------------------------------

test('server embedding: vectors find the section, with no download and one request', async (t) => {
  const calls = site(t, { '/index.json': () => json(vectorIndex), '/api/embed': embedServer() });
  // Retrieval only: the server embeds, so there is nothing for the visitor to download.
  const w = mount(t, { embedEndpoint: '/api/embed' });
  await w.pal.ask('where does my server embed the questions?');
  assert.equal(w.last().text, 'SNIPPETS');
  assert.deepEqual(w.last().links, ['https://docs.example/docs/models.html#embedding-questions-on-your-server']);
  const embeds = calls.filter((c) => c.path === '/api/embed');
  assert.deepEqual(embeds.map((c) => c.body.texts), [['where does my server embed the questions?']]);
  assert.ok(!w.messages().some((m) => /download/i.test(m.text)), 'never offers a download');
});

test('server embedding: when limited (429), keyword search answers instead', async (t) => {
  quiet(t);
  site(t, { '/index.json': () => json(vectorIndex), '/api/embed': () => json({ error: 'slow down' }, 429) });
  const w = mount(t, { embedEndpoint: '/api/embed' });
  await w.pal.ask('How do I write a skin manifest?');
  assert.equal(w.last().text, 'SNIPPETS');
  assert.ok(w.last().links.includes('https://docs.example/docs/skins.html#manifest-format'));
});

test('server embedding: a miss checks small talk by meaning, with no repeat requests', async (t) => {
  const calls = site(t, { '/index.json': () => json(vectorIndex), '/api/embed': embedServer() });
  const w = mount(t, { embedEndpoint: '/api/embed' });
  const embeds = () => calls.filter((c) => c.path === '/api/embed').map((c) => c.body.texts.length);

  await w.pal.ask('What is the capital of Mongolia?');
  assert.equal(w.last().text, 'DONTKNOW');
  assert.deepEqual(embeds(), [1, Object.values(INTENT_EXAMPLES).flat().length], 'the question once, the examples once');

  await w.pal.ask('greetings, desk friend');
  assert.equal(w.last().text, 'HELLO', 'a paraphrase of hello the patterns miss');
  assert.equal(embeds().length, 3, 'only the new question');
});

test('server embedding: a server on another model is not trusted', async (t) => {
  quiet(t);
  site(t, { '/index.json': () => json(vectorIndex), '/api/embed': (b: { texts: string[] }) => json({ model: 'other/model', vectors: b.texts.map(() => Array(DIM).fill(0)) }) });
  const w = mount(t, { embedEndpoint: '/api/embed' });
  await w.pal.ask('How do I write a skin manifest?');
  assert.equal(w.last().text, 'SNIPPETS', 'keywords instead');
});

// ---- a writer (cloud or custom) -------------------------------------------

test('writer: streams the answer and lists only the sources it cited', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  let prompt: Prompt | undefined;
  const w = mount(t, {
    adapter: 'custom',
    async *generate(p) {
      prompt = p;
      yield 'Set embedEndpoint ';
      yield 'to your server [2].';
    },
  });
  await w.pal.ask('How do I embed questions on my server?');
  assert.ok(prompt!.sources.length > 2 && prompt!.sources.length <= 6, 'a cloud writer reads up to six sections');
  assert.equal(prompt!.question, 'How do I embed questions on my server?');
  const answer = w.last();
  assert.equal(answer.text, 'Set embedEndpoint to your server [2].');
  assert.equal(answer.el.querySelector('.sources-label')!.textContent, 'Sources:');
  assert.equal(answer.links.length, 1);
  assert.equal(answer.links[0], new URL(prompt!.sources[1]!.url, document.baseURI).href);
});

test('writer: "I don\'t know" becomes the widget\'s own, with the near sections', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  const w = mount(t, { adapter: 'custom', generate: () => "I don't know, the sources don't say." });
  await w.pal.ask('How do I write a skin manifest?');
  assert.equal(w.last().text, 'DONTKNOW');
  assert.equal(w.last().el.querySelector('.sources-label')!.textContent, 'These might be close:');
  assert.ok(w.last().links.length > 0);
});

test('writer: a failure discards the partial answer and shows the sections', async (t) => {
  quiet(t);
  site(t, { '/index.json': () => json(keywordIndex) });
  const w = mount(t, {
    adapter: 'custom',
    async *generate() {
      yield 'The answer is defin';
      throw new Error('stream broke');
    },
  });
  await w.pal.ask('How do I write a skin manifest?');
  const texts = w.messages().map((m) => m.text);
  assert.ok(!texts.some((t) => t.startsWith('The answer')), 'no half answer left');
  assert.deepEqual(texts.slice(-2), ['ERROR', 'SNIPPETS']);
});

test('writer: a new question stops the one still being written', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  const signals: AbortSignal[] = [];
  const w = mount(t, {
    adapter: 'custom',
    async *generate(p, signal) {
      signals.push(signal);
      if (p.question.includes('first')) {
        yield 'Starting the first';
        await new Promise((r) => signal.addEventListener('abort', r));
        yield ' and this never shows';
        return;
      }
      yield 'Second answer [1].';
    },
  });
  const first = w.pal.ask('first: how do I write a skin manifest?');
  await waitFor(() => w.messages().some((m) => m.text === 'Starting the first'), 'the first answer to start');
  await w.pal.ask('second: how do I write a skin manifest?');
  await first;
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals[1]!.aborted, false);
  assert.equal(w.last().text, 'Second answer [1].');
  assert.ok(!w.messages().some((m) => m.text.includes('never shows')));
});

// ---- models on the visitor's device ---------------------------------------

/** deskpal-runtime.js, as a module that hands each call to the test's fakes. */
const RUNTIME_URL = 'data:text/javascript,' + encodeURIComponent(`
  const rt = () => globalThis.__deskpalTestRuntime;
  export const configure = (o) => rt().configure?.(o);
  export const loadEmbedder = (...a) => rt().loadEmbedder(...a);
  export const loadExtractive = (...a) => rt().loadExtractive(...a);
  export const loadGenerator = (...a) => rt().loadGenerator(...a);
`);
function fakeRuntime(t: TestContext, runtime: Record<string, (...args: any[]) => unknown>) {
  (globalThis as any).__deskpalTestRuntime = runtime;
  t.after(() => delete (globalThis as any).__deskpalTestRuntime);
}

const clickButton = (w: ReturnType<typeof mount>, label: string) =>
  waitFor(() => [...w.root.querySelectorAll('button')].find((b) => b.textContent === label), `the "${label}" button`).then((b) => b.click());

test('on device: asks before downloading; "no" is remembered and shows the sections', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  fakeRuntime(t, { loadExtractive: () => assert.fail('nothing should load') });
  const w = mount(t, { adapter: 'browser', runtimeUrl: RUNTIME_URL });
  const asked = w.pal.ask('How do I write a skin manifest?');
  const prompt = await waitFor(() => w.messages().find((m) => /download about \d+ MB/.test(m.text)), 'the download prompt');
  assert.match(prompt.text, /about 70 MB/, 'the reading model plus the runtime');
  await clickButton(w, 'No thanks, just links');
  await asked;
  assert.equal(w.last().text, 'SNIPPETS');

  await w.pal.ask('How do I set the accent colour?');
  assert.equal(w.messages().filter((m) => /download about/.test(m.text)).length, 1, 'asked only once');
});

test('on device: "yes" loads the reading model; answers can be expanded or swapped', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  const asked: string[][] = [];
  fakeRuntime(t, {
    loadExtractive: async (_model: unknown, _min: number, progress?: (f: { loaded: number; total: number }) => void) => ({
      kind: 'extract',
      async ready() {},
      async extract(_q: string, passages: string[]) {
        asked.push(passages);
        const text = passages[0]!;
        const start = text.indexOf(' ') + 1;
        return { passage: 0, answer: text.slice(start, start + 10), score: asked.length === 1 ? 0.9 : 0.3, start, end: start + 10 };
      },
    }),
  });
  const w = mount(t, { adapter: 'browser', runtimeUrl: RUNTIME_URL });
  const done = w.pal.ask('Which animations does a skin need?');
  await clickButton(w, 'Download');
  await done;
  const answer = w.last();
  assert.equal(answer.text, 'FOUND');
  assert.equal(answer.el.querySelector('mark')!.textContent!.length, 10);
  assert.ok(answer.el.querySelector('.from a'), 'says where it came from');

  await clickButton(w, 'Show more');
  assert.equal(answer.el.querySelector('.quote')!.textContent!.startsWith('…'), false, 'the whole section');

  await clickButton(w, 'Not what I meant');
  await waitFor(() => w.last().text === 'NEXTBEST', 'the next best answer');
  assert.equal(asked[1]!.length, asked[0]!.length - 1, 'without the section already shown');
});

test('on device: a model that fails to load falls back to the sections', async (t) => {
  quiet(t);
  site(t, { '/index.json': () => json(keywordIndex) });
  fakeRuntime(t, { loadExtractive: async () => { throw new Error('no WebAssembly here'); } });
  const w = mount(t, { adapter: 'browser', runtimeUrl: RUNTIME_URL });
  const done = w.pal.ask('How do I write a skin manifest?');
  await clickButton(w, 'Download');
  await done;
  const texts = w.messages().map((m) => m.text);
  assert.match(texts.at(-2)!, /couldn't load my answer model/);
  assert.equal(texts.at(-1), 'SNIPPETS');
});

test('on device: questions are embedded locally for an index with vectors', async (t) => {
  site(t, { '/index.json': () => json(vectorIndex) });
  const table = embedTable();
  fakeRuntime(t, {
    loadEmbedder: async (model: { id: string; dim: number }) => ({ id: model.id, dim: model.dim, embedQuery: async (q: string) => Float32Array.from(table(q)) }),
  });
  const w = mount(t, { adapter: 'none', runtimeUrl: RUNTIME_URL });
  const done = w.pal.ask('where does my server embed the questions?');
  const prompt = await waitFor(() => w.messages().find((m) => /download about/.test(m.text)), 'the download prompt');
  assert.match(prompt.text, /about 40 MB/, 'bge-small plus the runtime');
  await clickButton(w, 'Download');
  await done;
  assert.deepEqual(w.last().links, ['https://docs.example/docs/models.html#embedding-questions-on-your-server']);
});

// ---- the widget itself ----------------------------------------------------

test('ui: open, Escape, typing a question, hide and restore', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  const w = mount(t, {});
  const launcher = w.$<HTMLButtonElement>('.launcher')!;
  const bubble = w.$('.bubble')!;
  assert.equal(bubble.hidden, true);
  launcher.click();
  assert.equal(bubble.hidden, false);
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(w.last().text, 'GREETING');

  const input = w.$<HTMLInputElement>('input')!;
  input.value = '  How do I write a skin manifest?  ';
  w.$<HTMLFormElement>('form')!.requestSubmit();
  await waitFor(() => w.last().text === 'SNIPPETS', 'the answer');
  assert.equal(input.value, '');
  assert.equal(w.messages().at(-2)!.text, 'How do I write a skin manifest?');

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  assert.equal(bubble.hidden, true);

  await w.pal.hide();
  assert.equal(launcher.hidden, true);
  assert.equal(w.$('.restore')!.hidden, false);
  w.$<HTMLButtonElement>('.restore')!.click();
  assert.equal(launcher.hidden, false);
});

test('ui: sound and hiding are remembered for the site', async (t) => {
  site(t, { '/index.json': () => json(keywordIndex) });
  const siteKey = `remembered-${Date.now()}`;
  const w = mount(t, { siteKey });
  w.$<HTMLButtonElement>('[aria-label="Sound effects"]')!.click();
  assert.equal(w.$('[aria-label="Sound effects"]')!.getAttribute('aria-pressed'), 'true');
  await w.pal.hide();
  w.pal.destroy();

  const again = mount(t, { siteKey });
  assert.equal(again.$('[aria-label="Sound effects"]')!.getAttribute('aria-pressed'), 'true');
  await waitFor(() => again.$('.restore')!.hidden === false, 'the widget to stay hidden');
  assert.equal(again.$('.launcher')!.hidden, true);
});
