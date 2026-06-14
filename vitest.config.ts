import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve os aliases do tsconfig (@/* → ./src/*) nativamente (Vite recente).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: false,
    // Postgres real e descartável é um recurso compartilhado: rodar serial.
    // Em Vitest 4 `poolOptions` foi removido; `fileParallelism:false` força maxWorkers=1.
    pool: 'forks',
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // Subir/migrar o Postgres descartável (Testcontainers ou banco efêmero) pode demorar.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
