import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  css: {
    // Pin an explicit (empty) PostCSS config. Tailwind is handled entirely by
    // `@tailwindcss/vite`, so the renderer needs no PostCSS plugins — and
    // without this, Vite's `postcss-load-config` walks UP the filesystem
    // looking for a stray `postcss.config.*` / `tailwind.config.*`. The desktop
    // build runs from inside the user's home tree (e.g.
    // `C:\Users\<name>\AppData\Local\hermes\hermes-agent\apps\desktop`), so an
    // unrelated Tailwind v3 config higher up the tree gets picked up and
    // reprocesses our v4 stylesheet, failing the build with
    // "`@layer base` is used but no matching `@tailwind base` directive is
    // present." Pinning the config makes the build hermetic.
    postcss: { plugins: [] }
  },
  build: {
    // Keep desktop packaging stable: Shiki ships many dynamic chunks by
    // default, and electron-builder can OOM scanning thousands of files.
    // Collapsing to a single chunk is intentional, so the renderer bundle is
    // large by design (~22 MB). Raise the warning ceiling above that so the
    // cosmetic "chunk larger than 500 kB" nag stays quiet, while still acting
    // as a regression alarm if the bundle balloons well past today's size.
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hermes/shared': path.resolve(__dirname, '../shared/src'),
      // Shims so the vendored generative-AI studio (authored for Next.js) runs
      // unmodified under Vite: the Next modules it touches plus axios, which is
      // rewritten onto the Electron IPC bridge instead of hitting the network
      // from the renderer.
      'next/navigation': path.resolve(__dirname, './src/app/studio/shims/next-navigation.ts'),
      'next/dynamic': path.resolve(__dirname, './src/app/studio/shims/next-dynamic.ts'),
      'next/image': path.resolve(__dirname, './src/app/studio/shims/next-image.tsx'),
      'next/link': path.resolve(__dirname, './src/app/studio/shims/next-link.tsx'),
      'next-themes': path.resolve(__dirname, './src/app/studio/shims/next-themes.tsx'),
      axios: path.resolve(__dirname, './src/app/studio/shims/axios.ts'),
      // Vendored studio sub-packages, resolved by their package names so the
      // wrapper components' imports work without source edits.
      'workflow-builder': path.resolve(
        __dirname,
        './src/app/studio/vendor/packages/workflow-builder/src/index.js'
      ),
      'design-agent': path.resolve(
        __dirname,
        './src/app/studio/vendor/packages/design-agent/src/index.js'
      ),
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      'react/jsx-dev-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-runtime.js')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
})
