// Embeds the demo index's chunks in Node with the CLI's code path, so the
// spike page can check browser vectors against them.
//   npm run spike:vectors
import { readFile, writeFile } from 'node:fs/promises';
import { pipeline } from '@huggingface/transformers';
import { parseIndex } from '../src/rag/loader.ts';
import { docText, embedAll, EMBED_MODELS, type Extractor } from '../src/spike/embed.ts';

const index = parseIndex(JSON.parse(await readFile('demo/deskpal-index.json', 'utf8')));
const out: Record<string, number[][]> = {};
for (const model of EMBED_MODELS) {
  const extractor = (await pipeline('feature-extraction', model.id, { dtype: model.dtype as never })) as unknown as Extractor;
  const vecs = await embedAll(extractor, model, index.chunks.map(docText));
  out[model.id] = vecs.map((v) => Array.from(v, (x) => Math.round(x * 1e6) / 1e6));
  console.log(`${model.label}: ${vecs.length} vectors`);
}
await writeFile('demo/spike/node-vectors.json', JSON.stringify(out));
