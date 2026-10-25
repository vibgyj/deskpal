// The npm (ESM) entry: the runtime is looked for next to this file. Bundlers
// that move files around can set `runtimeUrl` in init().
import { setAssetBase } from './index.ts';

setAssetBase(import.meta.url);

export * from './index.ts';
