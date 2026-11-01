// A browser-like global environment for testing the widget in Node:
// happy-dom for the DOM, a stand-in 2D canvas (happy-dom draws nothing), and
// `.svg` imports as data URLs, as esbuild bundles them.
//
// Import this before anything from src/app.ts, with a dynamic import, since
// static imports run first.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.svg')) return nextLoad(url, context);
    const blank = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    return { format: 'module', source: `export default ${JSON.stringify(blank)};`, shortCircuit: true };
  },
});

GlobalRegistrator.register({ url: 'https://docs.example/guide/', width: 1280, height: 800 });

// Every 2D call is a no-op; property writes are kept.
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (target, key) => (key in target ? target[key] : () => {}),
  set: (target, key, value) => ((target[key] = value), true),
});
HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];

// Only the sprite player reads this clock: animations run 50 times faster, so
// a test doesn't wait a second for each wave or nod.
const now = performance.now.bind(performance);
performance.now = () => now() * 50;

/** Ends the fake browser, so the test process can exit. */
export async function teardown(): Promise<void> {
  await GlobalRegistrator.unregister();
}
