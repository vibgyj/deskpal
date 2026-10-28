import type { DeskpalIndex } from './types.ts';

export async function loadIndex(url: string, signal?: AbortSignal): Promise<DeskpalIndex> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`deskpal: could not load index ${url} (${res.status})`);
  return parseIndex(await res.json());
}

export function parseIndex(data: unknown): DeskpalIndex {
  const d = data as Partial<DeskpalIndex> | null;
  if (!d || d.format !== 'deskpal-index' || d.version !== 1 || !Array.isArray(d.chunks)) {
    throw new Error('deskpal: not a deskpal index (expected format "deskpal-index", version 1)');
  }
  return { format: d.format, version: d.version, model: d.model ?? null, chunks: d.chunks };
}
