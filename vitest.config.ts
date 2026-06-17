import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Dois projetos Vitest, rodados juntos por `npm test` (vitest run) no MESMO passo de CI:
 *
 *  - "node": domínio (TS puro) + integração (route handlers contra Postgres real e
 *    descartável). Serial (Postgres compartilhado), com globalSetup/setupFiles próprios.
 *    É a config original, preservada — só excluímos `test/ui/**` aqui.
 *  - "ui": seam de teste de FRONTEND (issue #54). jsdom + @vitejs/plugin-react +
 *    Testing Library. SEM Postgres (nenhum globalSetup/DB), então roda sem Docker/banco —
 *    é o seam que faz a UI ser verificável acima da seam de servidor, e fica verde no CI
 *    mesmo onde não há Docker (ele nunca o toca).
 *
 * `resolve.tsconfigPaths` precisa ficar no TOPO e DENTRO de cada projeto: subprojetos não
 * herdam a config de topo no Vitest 4, e a cadeia de imports do global-setup (→ @/db/schema
 * → @/domain/*) só resolve o alias @/* com ele declarado no projeto.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'node',
          environment: 'node',
          globals: false,
          // Exclui os defaults do vitest + os worktrees de agente (.claude) + a suíte de UI.
          exclude: [...configDefaults.exclude, '**/.claude/**', 'test/ui/**'],
          // Postgres real e descartável é recurso compartilhado: rodar serial.
          pool: 'forks',
          fileParallelism: false,
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup.ts'],
          hookTimeout: 180_000,
          testTimeout: 60_000,
        },
      },
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: 'ui',
          environment: 'jsdom',
          globals: true,
          include: ['test/ui/**/*.test.{ts,tsx}'],
          setupFiles: ['./test/ui/setup.ts'],
        },
      },
    ],
  },
})
