import { parseArgs } from 'node:util';
import { DEFAULT_EMBEDDING, EMBEDDINGS, type EmbedModel } from '../rag/embedding.ts';
import { buildIndex, writeIndex } from './build-index.ts';
import { nodeEmbedder, type EmbedChunks } from './embed.ts';

const USAGE = `Usage: deskpal build-index <docs-dir> [options]

Splits Markdown and HTML docs by heading into a search index for the widget.

Options:
  -o, --out <file>        Output file (default: deskpal-index.json)
      --base-url <url>    URL prefix for pages (default: /)
      --md-ext <ext>      Extension Markdown pages are served with (default: .html;
                          pass "" to keep .md)
      --max-chars <n>     Largest chunk in characters (default: 1500)
      --model <name>      Embedding model: bge-small-en-v1.5 (default, 34 MB for
                          visitors) or bge-base-en-v1.5 (better ranking, 110 MB;
                          best with the widget's embedEndpoint)
      --no-embed          Skip embeddings: a keyword-only index, no model download
  -h, --help              Show this help
`;

/** The CLI, minus process handling. `embedderFor` is replaceable so tests need no model download. */
export async function main(argv: string[], embedderFor: (model: EmbedModel) => Promise<EmbedChunks> = nodeEmbedder): Promise<number> {
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
      model: { type: 'string', default: DEFAULT_EMBEDDING.label },
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
  const model = EMBEDDINGS.find((m) => m.label === values.model);
  if (!model) {
    process.stderr.write(`deskpal: unknown model "${values.model}"; choose ${EMBEDDINGS.map((m) => m.label).join(' or ')}\n`);
    return 1;
  }
  const embedding = values['no-embed'] ? undefined : { model, embed: await embedderFor(model) };
  const index = await buildIndex({ docsDir, baseUrl: values['base-url'], mdExt: values['md-ext'], maxChars, embedding });
  await writeIndex(index, values.out);
  const pages = new Set(index.chunks.map((c) => c.url.split('#')[0])).size;
  const kind = index.model ? `vectors: ${index.model.id}` : 'keyword-only';
  process.stdout.write(`deskpal: ${index.chunks.length} chunks from ${pages} pages → ${values.out} (${kind})\n`);
  return 0;
}
