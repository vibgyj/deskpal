# Getting started

deskpal is a small animated assistant that sits in a corner of your site and
answers questions from your own documentation.

## Add deskpal to your site

1. Build a search index from your docs:

   ```
   npx deskpal build-index ./docs -o deskpal-index.json --base-url /docs/
   ```

2. Copy everything in `dist/` (`deskpal.js`, `deskpal-runtime.js`,
   `deskpal-worker.js` and the `ort/` folder) and `deskpal-index.json` to
   your site.

3. Add one script tag. No inline script is needed:

   ```html
   <script defer src="/deskpal.js" data-index="/deskpal-index.json"></script>
   ```

## Rebuilding the index

Rebuild the index whenever your docs change. The index is a static JSON file,
so you can build it in CI and deploy it with the rest of the site.

Building the index downloads a small embedding model (34 MB) once, so search
understands meaning and not just matching words. Pass `--no-embed` for a
keyword-only index that needs no download.

## Using npm and a bundler

Install the package and call `init` yourself:

```js
import { init } from 'deskpal';
init({ index: '/deskpal-index.json' });
```
