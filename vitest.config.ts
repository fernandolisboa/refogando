import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  // Resolve os aliases do tsconfig (@/* → ./src/*) nativamente (Vite recente).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: false,
    // O harness de agentes cria checkouts paralelos em `.claude/worktrees/**`.
    // São CÓPIAS do projeto (com seu próprio test/ e src/) — se o vitest as
    // globasse, rodaria uma suíte duplicada e DESATUALIZADA cujos route handlers
    // resolvem uma 2ª instância de `@/server/deps`, à qual o setDb() do setup.ts
    // desta árvore NUNCA se aplica (daí "DATABASE_URL não definido"). Excluímos
    // `.claude/**` preservando os defaults do vitest (node_modules, dist, etc.).
    exclude: [...configDefaults.exclude, '**/.claude/**'],
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
