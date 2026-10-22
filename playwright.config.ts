import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL } from './e2e/harness/constants'

/**
 * E2E de fumaça (#589) — Playwright contra um `next build` + `next start` de verdade, no MODO FAKE
 * (provedores externos trocados por dublês; ver src/server/e2e/mode.ts e docs/e2e.md).
 *
 * O `webServer` é o harness (`e2e/harness/server.ts`): sobe banco descartável, migra, semeia, builda e
 * serve em localhost:3100. Ele mesmo monta o env do Next (modo fake, segredos descartáveis, provedores
 * zerados) — nada de chave real passa daqui.
 *
 * Só Chromium, em dois perfis: `desktop` e `celular` (Pixel 7 — a navegação vira o menu hambúrguer).
 * `retries: 0` de propósito: fumaça instável é bug a corrigir, não a mascarar.
 *
 * `E2E_CHROMIUM_EXECUTABLE` (opcional): caminho de um Chromium já instalado, para máquinas sem acesso ao
 * download do Playwright (o browser precisa ser de uma revisão próxima). No CI fica vazio e vale o
 * browser do `playwright install`.
 */
const executablePath = process.env.E2E_CHROMIUM_EXECUTABLE?.trim() || undefined

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node --import tsx e2e/harness/server.ts',
    // `/pt-BR` (não só /api/health): prova layout + banco de pé antes do 1º teste.
    url: `${E2E_BASE_URL}/pt-BR`,
    // Build de produção inteiro cabe aqui (o CI frio leva alguns minutos).
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
  },
})
