import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { EmbedModel } from '../rag/embedding.ts';
import { quantizeInt8 } from '../rag/quantize.ts';
import type { DeskpalIndex, IndexChunk } from '../rag/types.ts';
import { chunkHtml, chunkMarkdown } from './chunk.ts';
import type { EmbedChunks } from './embed.ts';

export interface BuildOptions {
  docsDir: string;
  /** Prefix for page URLs; a page's path relative to docsDir is appended. */
  baseUrl: string;
  /** Extension Markdown pages are served with, e.g. ".html". Empty keeps ".md". */
  mdExt: string;
  maxChars: number;
  /** Adds int8 vectors made by this model. Keyword-only when omitted. */
  embedding?: { model: EmbedModel; embed: EmbedChunks };
}

const DOC_EXTS = new Set(['.md', '.markdown', '.html', '.htm']);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (DOC_EXTS.has(extname(entry.name).toLowerCase())) yield p;
  }
}

export function pageUrl(rel: string, opts: Pick<BuildOptions, 'baseUrl' | 'mdExt'>): string {
  let path = rel.split(sep).join('/');
  if (/\.(md|markdown)$/i.test(path) && opts.mdExt) path = path.replace(/\.(md|markdown)$/i, opts.mdExt);
  const base = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`;
  return base + path.split('/').map(encodeURIComponent).join('/');
}

export async function buildIndex(opts: BuildOptions): Promise<DeskpalIndex> {
  const files: string[] = [];
  for await (const f of walk(opts.docsDir)) files.push(f);
  files.sort();
  const chunks: IndexChunk[] = [];
  for (const file of files) {
    const rel = relative(opts.docsDir, file);
    const source = await readFile(file, 'utf8');
    const chunkOpts = {
      maxChars: opts.maxChars,
      url: pageUrl(rel, opts),
      fallbackTitle: rel.replace(/\.[^.]+$/, '').split(sep).pop()!.replace(/[-_]/g, ' '),
    };
    chunks.push(...(/\.html?$/i.test(file) ? chunkHtml(source, chunkOpts) : chunkMarkdown(source, chunkOpts)));
  }
  if (!opts.embedding) return { format: 'deskpal-index', version: 1, model: null, chunks };
  const { model, embed } = opts.embedding;
  const vectors = await embed(chunks);
  const embedded = chunks.map((c, i) => ({ ...c, ...quantizeInt8(vectors[i]!) }));
  return { format: 'deskpal-index', version: 1, model: { id: model.id, dim: model.dim, quant: 'int8' }, chunks: embedded };
}

export async function writeIndex(index: DeskpalIndex, out: string): Promise<void> {
  await writeFile(out, JSON.stringify(index));
}
