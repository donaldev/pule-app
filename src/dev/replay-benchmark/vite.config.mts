import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const cert = process.env.PULE_BENCHMARK_CERT
const key = process.env.PULE_BENCHMARK_KEY
if (!!cert !== !!key) throw Error('Set both PULE_BENCHMARK_CERT and PULE_BENCHMARK_KEY for HTTPS.')

export default defineConfig({
  root,
  publicDir: false,
  envDir: false,
  build: { outDir: join(tmpdir(), 'pule-replay-benchmark'), emptyOutDir: true },
  preview: {
    host: cert && key ? '0.0.0.0' : '127.0.0.1',
    port: 5186,
    strictPort: true,
    https: cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
  },
})
