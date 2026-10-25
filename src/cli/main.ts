import { parseArgs } from 'node:util';
import { DEFAULT_EMBEDDING } from '../rag/embedding.ts';
import { buildIndex, writeIndex } from './build-index.ts';
import { nodeEmbedder } from './embed.ts';

const USAGE = `Usage: deskpal build-index <docs-dir> [options]

Splits Markdown and HTML docs by heading into a search index for the widget.

Options:
  -o, --out <file>        Output file (default: deskpal-index.json)
      --base-url <url>    URL prefix for pages (default: /)
      --md-ext <ext>      Extension Markdown pages are served with (default: .html;
                          pass "" to keep .md)
      --max-chars <n>     Largest chunk in characters (default: 1500)
      --no-embed          Skip embeddings: a keyword-only index, no model download
  -h, --help              Show this help
`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }
  if (command !== 'build-index') {
    process.stderr.write(`deskpal: unknown command "${command}"\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o', default: 'deskpal-index.json' },
      'base-url': { type: 'string', default: '/' },
      'md-ext': { type: 'string', default: '.html' },
      'max-chars': { type: 'string', default: '1500' },
      'no-embed': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const docsDir = positionals[0];
  const maxChars = Number(values['max-chars']);
  if (!docsDir || positionals.length > 1 || !(maxChars >= 200)) {
    process.stderr.write(USAGE);
    return 1;
  }
  const embedding = values['no-embed'] ? undefined : { model: DEFAULT_EMBEDDING, embed: await nodeEmbedder(DEFAULT_EMBEDDING) };
  const index = await buildIndex({ docsDir, baseUrl: values['base-url'], mdExt: values['md-ext'], maxChars, embedding });
  await writeIndex(index, values.out);
  const pages = new Set(index.chunks.map((c) => c.url.split('#')[0])).size;
  const kind = index.model ? `vectors: ${index.model.id}` : 'keyword-only';
  process.stdout.write(`deskpal: ${index.chunks.length} chunks from ${pages} pages → ${values.out} (${kind})\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`deskpal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
