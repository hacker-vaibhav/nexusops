import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const idx = trimmed.indexOf('=')
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // Optional env file; ignore if missing.
  }
}

loadEnvFile(path.resolve('..', '.env'))
loadEnvFile(path.resolve('..', 'backend', '.env'))

const PROXY_TARGET = process.env.VITE_PROXY_TARGET || process.env.VITE_API_URL || 'http://127.0.0.1:8000'
const WS_TARGET = PROXY_TARGET.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: WS_TARGET,
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
