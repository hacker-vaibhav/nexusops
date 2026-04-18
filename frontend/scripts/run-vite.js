import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.ESBUILD_BINARY_PATH = path.join(__dirname, 'esbuild-wrapper.cmd')

const viteCli = pathToFileURL(path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')).href
await import(viteCli)
