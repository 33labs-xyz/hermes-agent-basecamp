import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

// Reuse the renderer's Vite config verbatim (plugins, `@` alias, react dedupe,
// the hermetic PostCSS pin) so tests resolve modules exactly like the app. We
// only add the `test` block on top — Vitest ignores `build`/`server`, and the
// electron-builder build never reads this file, so packaging is unaffected.
//
// `setupFiles` installs the localStorage shim (see ./test-setup.ts) that Node 26
// + jsdom otherwise leave undefined.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./test-setup.ts']
    }
  })
)
