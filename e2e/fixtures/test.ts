import { randomUUID } from 'node:crypto'
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { ptBR } from '../../src/i18n/messages/pt-BR'
import { tourStorageKey, type TourState } from '../../src/domain/onboarding-tour'
import { recipeSlugBaseFromTitle } from '../../src/domain/recipe-slug'
import { isHydrationError } from '../../src/domain/error-report'

/**
 * Fixtures do E2E de fumaça (#589).
 *
 * Guardas AUTOMÁTICAS (todo teste, sem pedir):
 *  - console: erro de página (`pageerror`) ou erro de hidratação do React (#418/#423/#425, "Hydration
 *    failed") reprova o teste — o smoke roda contra `next build`, onde a hidratação quebrada só aparece
 *    assim. Erros de recurso (ex. o 404 de propósito) não contam.
 *  - rede: qualquer requisição do navegador para fora de localhost reprova (o app do E2E não deveria
 *    nem tentar falar com Blob, Google, Anthropic…).
 *
 * `account`: uma conta NOVA por teste, criada pela API do Better Auth com o `request` do próprio
 * contexto (os cookies de sessão já valem para o navegador). Nome e e-mail únicos (uuid): o handle nasce
 * do nome, sem retry de colisão, e os workers rodam em paralelo. O tour guiado abre sozinho para conta
 * nova; a fixture o marca como dispensado antes da 1ª página (a spec de cadastro testa o tour à parte).
 * Spec que só precisa estar logada pede `account` e não lê o valor: o `void account` dela é isso.
 *
 * Rótulos vêm do catálogo `pt-BR` (a mesma fonte da UI): renomear um texto não quebra a spec à toa.
 */

export const t = ptBR

/** Interpola `{chave}` como a UI (`String.replace`). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
}

export type Account = { id: string; name: string; email: string; password: string }

/** Dados de uma conta nova e única (nome/e-mail com uuid). */
export function newAccountData(workerIndex: number): Omit<Account, 'id'> {
  const id = randomUUID().replace(/-/g, '').slice(0, 12)
  return {
    name: `E2E ${id}`,
    email: `e2e-${workerIndex}-${id}@refogando.test`,
    password: `senha-e2e-${id}`,
  }
}

/**
 * Caminho pt-BR do detalhe de uma Receita recém-criada, pelo título. Deriva o slug como o write-path
 * (`recipeSlugBaseFromTitle`, ADR-0020): vale enquanto o título não colide com outro no locale (o seed
 * é único e o canário leva um nonce).
 */
export function recipePath(titulo: string): string {
  return `/pt-BR/recipes/${recipeSlugBaseFromTitle(titulo)}`
}

/** Marca o tour como dispensado para este usuário em todas as páginas do contexto (antes do script do app). */
export async function dismissTour(page: Page, userId: string): Promise<void> {
  const state: TourState = 'dismissed'
  await page.context().addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // storage bloqueado: o tour simplesmente não abre (o app trata assim também).
      }
    },
    { key: tourStorageKey(userId), value: state },
  )
}

/**
 * Espera a hidratação: o slot de conta só troca o espaçador por um link/botão depois que o React montou
 * e o get-session respondeu. `attached` (não `visible`): no celular esse cluster do header fica oculto.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator('[data-tour="conta"] :is(a,button)').first().waitFor({ state: 'attached' })
}

type MarkedWindow = Window & { __e2eMarca?: boolean }

/** Marca a página viva. Uma recarga de verdade apaga a marca; trocar só o estado do React não apaga. */
export async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => ((window as MarkedWindow).__e2eMarca = true))
}

/**
 * Espera a página marcada recarregar (o SessionLossGuard ao sair, ADR-0028) e hidratar de novo. No meio da
 * recarga o contexto some e o evaluate lança: conta como "ainda não" e tenta de novo.
 */
export async function waitForReload(page: Page): Promise<void> {
  const marcada = () => page.evaluate(() => (window as MarkedWindow).__e2eMarca ?? false).catch(() => true)
  await expect.poll(marcada, { message: 'a página recarregou' }).toBe(false)
  await waitForHydration(page)
}

/** Abre o menu hambúrguer (celular) e devolve o painel. */
export async function openMobileMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: t.nav.abrirMenu }).click()
  const menu = page.getByRole('dialog', { name: t.nav.menu })
  await expect(menu).toBeVisible()
  return menu
}

/** Abre a gaveta "Criar" (no celular, pelo menu) e devolve o diálogo do método-picker. */
export async function openCreate(page: Page, isMobile: boolean): Promise<Locator> {
  if (isMobile) {
    const menu = await openMobileMenu(page)
    await menu.getByRole('button', { name: t.nav.create }).click()
  } else {
    await page.getByRole('banner').getByRole('button', { name: t.nav.create }).click()
  }
  const drawer = page.getByRole('dialog', { name: t.criarDrawer.tituloPicker })
  await expect(drawer).toBeVisible()
  return drawer
}

/** Abre o menu da conta (no celular, dentro do menu hambúrguer) e devolve o menu. */
export async function openAccountMenu(page: Page, isMobile: boolean, name: string): Promise<Locator> {
  const scope = isMobile ? await openMobileMenu(page) : page.getByRole('banner')
  await scope.getByRole('button', { name }).click()
  const menu = page.getByRole('menu', { name })
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Com o popover "Adicionar ao cardápio"/"Pôr no cardápio" já aberto: escolhe a refeição (explícita, porque
 * o default depende da hora do dia), planeja e segue o "Ver cardápio" até o Cardápio da semana.
 * O popover é o único `dialog` aberto: "Adicionar" aparece também em outras partes da página.
 */
export async function planFromPopover(page: Page, slotLabel: string): Promise<void> {
  const popover = page.getByRole('dialog')
  await popover.getByRole('combobox', { name: t.cardapio.refeicao }).selectOption({ label: slotLabel })
  await popover.getByRole('button', { name: t.cardapio.planejar, exact: true }).click()
  await expect(popover.getByRole('status')).toContainText(slotLabel.toLowerCase())
  await popover.getByRole('link', { name: t.cardapio.verCardapio }).click()
  await expect(page).toHaveURL(/\/pt-BR\/me\/meal-plan/)
}

type Fixtures = {
  account: Account
  _consoleGuard: void
  _networkGuard: void
}

export const test = base.extend<Fixtures>({
  _consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
      // O mesmo teste que classifica `hidratacao` no relato do navegador (#590), com o mesmo corte: o texto
      // do console não tem teto e a regex é quadrática num texto grande.
      page.on('console', (msg) => {
        if ((msg.type() === 'error' || msg.type() === 'warning') && isHydrationError(msg.text())) {
          problems.push(`console.${msg.type()}: ${msg.text()}`)
        }
      })
      await use()
      expect(problems, 'erros de página/hidratação no navegador').toEqual([])
    },
    { auto: true },
  ],

  _networkGuard: [
    async ({ page }, use) => {
      const external: string[] = []
      page.context().on('request', (req) => {
        let url: URL
        try {
          url = new URL(req.url())
        } catch {
          return
        }
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== 'localhost') {
          external.push(`${req.method()} ${url.origin}${url.pathname}`)
        }
      })
      await use()
      expect(external, 'requisições do navegador para fora de localhost').toEqual([])
    },
    { auto: true },
  ],

  account: async ({ page, baseURL }, use, testInfo) => {
    const data = newAccountData(testInfo.workerIndex)
    // `origin` explícito: o Better Auth confere a origem (trustedOrigins = BETTER_AUTH_URL) em POST.
    const res = await page.request.post('/api/auth/sign-up/email', {
      headers: { origin: baseURL! },
      data,
    })
    expect(res.status(), await res.text()).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    await dismissTour(page, body.user.id)
    await use({ ...data, id: body.user.id })
  },
})

export { expect }
