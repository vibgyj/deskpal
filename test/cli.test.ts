import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildIndex, pageUrl } from '../src/cli/build-index.ts';
import { DEFAULT_EMBEDDING } from '../src/rag/embedding.ts';
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
