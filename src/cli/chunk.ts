import type { Chunk } from '../rag/types.ts';

export interface ChunkOptions {
  /** Chunks longer than this are split at paragraph boundaries. */
  maxChars: number;
  /** URL of the page the text came from. Anchors are appended per heading. */
  url: string;
  /** Used as the page title when the page has no h1. */
  fallbackTitle: string;
}

interface Section {
  level: number;
  heading: string;
  anchor: string;
  lines: string[];
}

/** GitHub-style heading anchor. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Markdown to plain text for chunk bodies: keep words and code, drop markup. */
export function markdownToText(md: string): string {
  return md
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Inline code keeps its text, even when it is an HTML tag being documented.
    .replace(/`([^`\n]+)`/g, (_, code: string) => code.replace(/</g, '\u0000'))
    .replace(/<[^>]+>/g, '')
    .replace(/\u0000/g, '<')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkMarkdown(md: string, opts: ChunkOptions): Chunk[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, ''); // front matter
  const sections: Section[] = [{ level: 0, heading: '', anchor: '', lines: [] }];
  const seen = new Map<string, number>();
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const heading = markdownToText(m[2]!);
      sections.push({ level: m[1]!.length, heading, anchor: uniqueSlug(heading, seen), lines: [] });
    } else {
      sections.at(-1)!.lines.push(line);
    }
  }
  return toChunks(
    sections.map((s) => ({ ...s, text: markdownToText(s.lines.join('\n')) })),
    opts,
  );
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/pre)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

export function chunkHtml(html: string, opts: ChunkOptions): Chunk[] {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const cleaned = main.replace(/<(script|style|nav|footer|header|template|noscript)\b[\s\S]*?<\/\1>/gi, '');
  const sections: Section[] = [{ level: 0, heading: '', anchor: '', lines: [] }];
  const seen = new Map<string, number>();
  const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    sections.at(-1)!.lines.push(cleaned.slice(last, m.index));
    const heading = htmlToText(m[3]!);
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[2]!)?.[1];
    sections.push({ level: Number(m[1]), heading, anchor: id ?? uniqueSlug(heading, seen), lines: [] });
    last = re.lastIndex;
  }
  sections.at(-1)!.lines.push(cleaned.slice(last));
  const fallbackTitle = titleTag ? htmlToText(titleTag) : opts.fallbackTitle;
  return toChunks(
    sections.map((s) => ({ ...s, text: htmlToText(s.lines.join('')) })),
    { ...opts, fallbackTitle },
  );
}

function uniqueSlug(heading: string, seen: Map<string, number>): string {
  const base = slugify(heading);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

function toChunks(sections: (Section & { text: string })[], opts: ChunkOptions): Chunk[] {
  const h1 = sections.find((s) => s.level === 1);
  const title = h1?.heading || opts.fallbackTitle;
  const chunks: Chunk[] = [];
  const stack: Section[] = [];
  for (const s of sections) {
    if (s.level > 0) {
      while (stack.length && stack.at(-1)!.level >= s.level) stack.pop();
      stack.push(s);
    }
    if (!s.text) continue;
    // The path starts at the page title; a top-level h1 is the title itself.
    const headings = stack.filter((x) => x !== h1).map((x) => x.heading);
    const path = [title, ...headings];
    const url = s.anchor && s !== h1 ? `${opts.url}#${s.anchor}` : opts.url;
    splitText(s.text, opts.maxChars).forEach((text, i, parts) => {
      const id = `${opts.url}#${s.anchor || 'top'}${parts.length > 1 ? `:${i + 1}` : ''}`;
      chunks.push({ id, title, path, url, text });
    });
  }
  return chunks;
}

/** Splits at paragraph, then sentence, then hard boundaries to stay under `max`. */
export function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const para of text.split(/\n\n+/)) {
    const pieces = para.length <= max ? [para] : para.match(new RegExp(`[^]{1,${max}}(?:[.!?](?=\\s)|$)|[^]{1,${max}}`, 'g')) ?? [para];
    for (const p of pieces) {
      if (cur && cur.length + p.length + 2 > max) push();
      cur += (cur ? '\n\n' : '') + p;
    }
  }
  push();
  return out;
}
