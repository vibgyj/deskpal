import { get, init, setAssetBase } from './index.ts';

// The <script> build boots itself from its own data attributes or the
// #deskpal-config block, so no inline script is needed (strict CSPs).
// Add data-auto="false" to boot later with deskpal.init({...}).
const script = document.currentScript as HTMLScriptElement | null;
setAssetBase(script?.src);

function boot(): void {
  init({}, script);
}

if (script?.dataset.auto !== 'false') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}

export { get, init };
