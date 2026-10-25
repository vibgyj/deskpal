import { Deskpal } from './app.ts';
import { fromDataset, fromJson, resolveConfig, type DeskpalConfig } from './core/config.ts';

export type { DeskpalConfig } from './core/config.ts';
export type { ModelAdapter } from './adapters/types.ts';
export type { Embedder, DeskpalIndex } from './rag/types.ts';
export type { SkinManifest, AnimationDef } from './sprite/manifest.ts';
export { REQUIRED_ANIMATIONS, validateManifest } from './sprite/manifest.ts';
export { Deskpal };

let instance: Deskpal | null = null;
let assetBase: string | undefined;

/** Where dist/ lives, so deskpal-runtime.js can be found next to the widget script. */
export function setAssetBase(url: string | undefined): void {
  assetBase = url;
}

/**
 * Starts the widget. Options passed here win over the JSON config block,
 * which wins over the script tag's data attributes. Calling it again
 * replaces the running widget.
 */
export function init(options: Partial<DeskpalConfig> = {}, script?: HTMLScriptElement | null): Deskpal {
  const layers: Partial<DeskpalConfig>[] = [];
  if (script) layers.push(fromDataset({ ...script.dataset }));
  const block = document.getElementById('deskpal-config');
  if (block?.textContent) layers.push(fromJson(block.textContent));
  layers.push(options);
  const config = resolveConfig(...layers);
  if (!config.runtimeUrl && assetBase) config.runtimeUrl = new URL('deskpal-runtime.js', assetBase).href;
  instance?.destroy();
  instance = new Deskpal(config);
  return instance;
}

export function get(): Deskpal | null {
  return instance;
}
