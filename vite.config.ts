import { defineConfig, type Plugin } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/** Dev only: the in-app editor POSTs world.json + terrain.png here and they land in public/worlds/<id>/. */
function editorSave(): Plugin {
  return {
    name: 'storyworld-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        let body = ''
        req.on('data', (c: Buffer) => (body += c))
        req.on('end', () => {
          try {
            const { id, world, terrainPng } = JSON.parse(body) as { id: string; world: string; terrainPng: string }
            if (!/^[\w-]+$/.test(id)) throw new Error('bad world id')
            const dir = resolve(fileURLToPath(new URL('.', import.meta.url)), 'public/worlds', id)
            mkdirSync(dir, { recursive: true })
            writeFileSync(resolve(dir, 'world.json'), world)
            writeFileSync(resolve(dir, 'terrain.png'), Buffer.from(terrainPng, 'base64'))
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ files: [`public/worlds/${id}/world.json`, `public/worlds/${id}/terrain.png`] }))
          } catch (e) {
            res.statusCode = 400
            res.end(String((e as Error).message))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), editorSave()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // n8ao ships without a `sideEffects` field, so Rollup keeps it wherever it is imported at all —
      // including @react-three/postprocessing's index, which every tier loads — and the ultra-only
      // occlusion pass lands in the main bundle for everyone (+82 KB gzipped). Its import-time code
      // only parses its own denoiser weights and assembles shader strings into module-local
      // constants; nothing global. Declaring that lets it live in the lazy ultra chunk alone.
      treeshake: {
        moduleSideEffects: (id) => !id.includes('/node_modules/n8ao/'),
      },
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
})
