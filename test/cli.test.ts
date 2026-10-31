import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildIndex, pageUrl } from '../src/cli/build-index.ts';
import { BGE_BASE, DEFAULT_EMBEDDING, type EmbedModel } from '../src/rag/embedding.ts';
import { main } from '../src/cli/run.ts';
import { readFile } from 'node:fs/promises';
import { dequantizeInt8 } from '../src/rag/quantize.ts';
import { chunkHtml, chunkMarkdown, slugify, splitText } from '../src/cli/chunk.ts';

const opts = { maxChars: 1500, url: '/docs/guide.html', fallbackTitle: 'guide' };

test('markdown splits by heading and keeps the heading path', () => {
  const md = `---\ntitle: x\n---\n# Guide\n\nIntro text.\n\n## Install\n\nRun **npm i**.\n\n### Options\n\nSee [the docs](x.md).\n\n\`\`\`\n# not a heading\n\`\`\`\n\n## Usage\n\nCall \`init()\`.\n`;
  const chunks = chunkMarkdown(md, opts);
  assert.deepEqual(chunks.map((c) => c.path), [['Guide'], ['Guide', 'Install'], ['Guide', 'Install', 'Options'], ['Guide', 'Usage']]);
  assert.equal(chunks[0]!.url, '/docs/guide.html');
  assert.equal(chunks[2]!.url, '/docs/guide.html#options');
  assert.match(chunks[2]!.text, /See the docs\.\n+# not a heading/);
  assert.equal(chunks[1]!.text, 'Run npm i.');
  assert.equal(chunks[3]!.text, 'Call init().');
});

test('code fences indented inside lists are stripped too', () => {
  const [c] = chunkMarkdown('# T\n\n1. Run:\n\n   ```sh\n   npx deskpal\n   ```\n\n2. Done.', opts);
  assert.ok(!c!.text.includes('`'), c!.text);
  assert.match(c!.text, /npx deskpal/);
});

test('inline code survives, even an HTML tag; real tags are dropped', () => {
  const [c] = chunkMarkdown('# T\n\nUse `<script id="x">` here, <b>bold</b>.', opts);
  assert.equal(c!.text, 'Use <script id="x"> here, bold.');
});

test('a page without an h1 uses the fallback title', () => {
  const [c] = chunkMarkdown('## Only\n\nBody.', opts);
  assert.deepEqual(c!.path, ['guide', 'Only']);
});

test('html splits by heading, honours ids and drops chrome', () => {
  const html = `<html><head><title>Ref &amp; API</title></head><body><nav>menu</nav><main>
    <p>Top &lt;intro&gt;.</p><h2 id="cfg">Config</h2><p>Use <code>data-index</code>.</p><ul><li>one</li><li>two</li></ul>
    <h3>Sub Part</h3><p>Deep.</p><script>evil()</script></main></body></html>`;
  const chunks = chunkHtml(html, opts);
  assert.deepEqual(chunks.map((c) => c.path), [['Ref & API'], ['Ref & API', 'Config'], ['Ref & API', 'Config', 'Sub Part']]);
  assert.equal(chunks[0]!.text, 'Top <intro>.');
  assert.equal(chunks[1]!.url, '/docs/guide.html#cfg');
  assert.match(chunks[1]!.text, /Use data-index\.\n+- one\n- two/);
  assert.equal(chunks[2]!.url, '/docs/guide.html#sub-part');
  assert.ok(!chunks.some((c) => /menu|evil/.test(c.text)));
});

test('long text is split under the cap', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const parts = splitText(`${text}\n\n${text}`, 300);
  assert.ok(parts.length > 4);
  for (const p of parts) assert.ok(p.length <= 301, String(p.length));
});

test('slugs match GitHub style', () => {
  assert.equal(slugify('Hello, World! (v2)'), 'hello-world-v2');
});

test('page urls map .md to the served extension', () => {
  assert.equal(pageUrl('a/b c.md', { baseUrl: '/docs', mdExt: '.html' }), '/docs/a/b%20c.html');
  assert.equal(pageUrl('x.md', { baseUrl: 'https://e.com/', mdExt: '' }), 'https://e.com/x.md');
});

test('buildIndex walks a docs folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deskpal-'));
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'index.md'), '# Home\n\nWelcome.');
  await writeFile(join(dir, 'sub', 'page.html'), '<h1>Page</h1><p>Hi.</p>');
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  const index = await buildIndex({ docsDir: dir, baseUrl: '/', mdExt: '.html', maxChars: 1500 });
  assert.equal(index.format, 'deskpal-index');
  assert.equal(index.model, null);
  assert.deepEqual(index.chunks.map((c) => c.url), ['/index.html', '/sub/page.html']);
});

test('buildIndex adds int8 vectors and records the model when embedding', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deskpal-'));
  await writeFile(join(dir, 'a.md'), '# A\n\nAlpha.\n\n## B\n\nBeta.');
  const seen: string[] = [];
  const embed = async (chunks: { text: string }[]) =>
    chunks.map((c) => {
      seen.push(c.text);
      const v = new Float32Array(DEFAULT_EMBEDDING.dim);
      v[0] = c.text === 'Alpha.' ? 1 : -0.5;
      return v;
    });
  const index = await buildIndex({ docsDir: dir, baseUrl: '/', mdExt: '.html', maxChars: 1500, embedding: { model: DEFAULT_EMBEDDING, embed } });
  assert.deepEqual(index.model, { id: DEFAULT_EMBEDDING.id, dim: DEFAULT_EMBEDDING.dim, quant: 'int8' });
  assert.deepEqual(seen, ['Alpha.', 'Beta.']);
  const back = dequantizeInt8(index.chunks[1]!.v!, index.chunks[1]!.s!);
  assert.equal(back.length, DEFAULT_EMBEDDING.dim);
  assert.ok(Math.abs(back[0]! + 0.5) < 0.01);
});

/** Runs the CLI with a fake embedder, capturing what it prints. */
async function cli(t: import('node:test').TestContext, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  t.mock.method(process.stdout, 'write', (s: string) => (out.push(s), true));
  t.mock.method(process.stderr, 'write', (s: string) => (err.push(s), true));
  const models: EmbedModel[] = [];
  const embedderFor = async (model: EmbedModel) => {
    models.push(model);
    return async (chunks: { text: string }[]) => chunks.map(() => Float32Array.from({ length: model.dim }, (_, i) => (i === 0 ? 1 : 0)));
  };
  const code = await main(args, embedderFor);
  t.mock.restoreAll();
  return { code, out: out.join(''), err: err.join(''), models };
}

async function docsDir() {
  const dir = await mkdtemp(join(tmpdir(), 'deskpal-'));
  await writeFile(join(dir, 'a.md'), '# A\n\nAlpha.\n\n## B\n\nBeta.');
  return dir;
}

test('cli: --model picks the embedding model and the index records it', async (t) => {
  const dir = await docsDir();
  const out = join(dir, 'index.json');
  const run = await cli(t, ['build-index', dir, '-o', out, '--model', 'bge-base-en-v1.5']);
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(run.models, [BGE_BASE]);
  const index = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(index.model, { id: BGE_BASE.id, dim: 768, quant: 'int8' });
  assert.match(run.out, /2 chunks from 1 pages .*vectors: /);
});

test('cli: bge-small by default; --no-embed loads no model', async (t) => {
  const dir = await docsDir();
  const small = await cli(t, ['build-index', dir, '-o', join(dir, 'small.json')]);
  assert.deepEqual(small.models, [DEFAULT_EMBEDDING]);
  const none = await cli(t, ['build-index', dir, '-o', join(dir, 'none.json'), '--no-embed']);
  assert.equal(none.code, 0);
  assert.deepEqual(none.models, []);
  assert.equal(JSON.parse(await readFile(join(dir, 'none.json'), 'utf8')).model, null);
});

test('cli: an unknown model, command or bad option fails with a message', async (t) => {
  const dir = await docsDir();
  const model = await cli(t, ['build-index', dir, '--model', 'bge-huge']);
  assert.equal(model.code, 1);
  assert.match(model.err, /unknown model "bge-huge"; choose bge-small-en-v1.5 or bge-base-en-v1.5/);
  assert.deepEqual(model.models, []);
  assert.equal((await cli(t, ['serve'])).code, 1);
  assert.equal((await cli(t, ['build-index'])).code, 1, 'no docs folder');
  assert.equal((await cli(t, ['build-index', dir, '--max-chars', '50'])).code, 1, 'chunks too small');
  const help = await cli(t, ['build-index', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /--model <name>/);
});
