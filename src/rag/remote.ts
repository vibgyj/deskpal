import type { Embedder, IndexModel } from './types.ts';

/** Most texts in one request; the small-talk examples are the biggest batch. */
export const MAX_REMOTE_TEXTS = 32;

/**
 * Embeds questions on the site's server instead of the visitor's device
 * (`embedEndpoint`), so visitors download no model. The server applies the
 * model's query prefix; see docs/models.md for the request and reply.
 */
export function remoteEmbedder(endpoint: string, model: IndexModel): Embedder {
  const embedQueries = async (texts: string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += MAX_REMOTE_TEXTS) {
      const batch = texts.slice(i, i + MAX_REMOTE_TEXTS);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: batch }),
      });
      if (!res.ok) throw new Error(`deskpal: embedding endpoint answered ${res.status}`);
      const body = (await res.json()) as { model?: unknown; vectors?: unknown };
      // A server on another model would give vectors that only look right.
      if (body.model !== model.id) throw new Error(`deskpal: embedding endpoint uses "${String(body.model)}", but the index was built with "${model.id}"`);
      const vectors = body.vectors;
      if (!Array.isArray(vectors) || vectors.length !== batch.length || !vectors.every((v) => Array.isArray(v) && v.length === model.dim)) {
        throw new Error('deskpal: embedding endpoint sent a malformed reply');
      }
      for (const v of vectors as number[][]) out.push(Float32Array.from(v));
    }
    return out;
  };
  // The last question again, for the "might be close" search after a miss: no second request.
  let last: { question: string; v: Promise<Float32Array> } | null = null;
  return {
    id: model.id,
    dim: model.dim,
    embedQuery(question) {
      if (last?.question !== question) {
        const v = embedQueries([question]).then((vs) => vs[0]!);
        last = { question, v };
        v.catch(() => (last = null));
      }
      return last.v;
    },
    embedQueries,
  };
}
