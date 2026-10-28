import { validateManifest, type SkinManifest } from './manifest.ts';

export interface Skin {
  manifest: SkinManifest;
  sheets: HTMLImageElement[];
}

export async function loadSkinFromUrl(url: string): Promise<Skin> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`deskpal: could not load skin ${url} (${res.status})`);
  const base = new URL(url, document.baseURI).href;
  return loadSkin(await res.json(), base);
}

export async function loadSkin(manifest: unknown, baseUrl: string): Promise<Skin> {
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`deskpal: invalid skin manifest:\n  ${errors.join('\n  ')}`);
  const m = manifest as SkinManifest;
  const sheets = await Promise.all(m.sheets.map((src) => loadImage(new URL(src, baseUrl).href)));
  return { manifest: m, sheets };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`deskpal: could not load sprite sheet ${src.slice(0, 80)}`));
    img.src = src;
  });
}
