import { randomUUID } from 'node:crypto'
import { E2E_CANARY_TITLE } from '../../src/server/e2e/canary'
import { expect, openCreate, t, test, waitForHydration } from '../fixtures/test'

/**
 * Criar pela gaveta (ADR-0021): "Criar" ⇒ Prompt aberto ⇒ Gerar ⇒ "Ver receita". O "Claude" do modo
 * fake devolve a Receita canário com o nonce do pedido no título (slug único por teste, ver fakes.ts).
 * Regressão #581: ao navegar para a Receita, nenhuma gaveta/diálogo pode ficar aberto por cima.
 */

test('gera pela gaveta (prompt aberto) e abre a Receita criada, sem diálogo sobrando', async ({
  page,
  isMobile,
  account,
}) => {
  void account
  const nonce = randomUUID().replace(/-/g, '').slice(0, 8)
  const titulo = `${E2E_CANARY_TITLE} ${nonce}`

  await page.goto('/pt-BR')
  await waitForHydration(page)
  const picker = await openCreate(page, isMobile)
  await picker.getByRole('button', { name: t.criarDrawer.metodoPromptTitulo }).click()

  const drawer = page.getByRole('dialog', { name: t.criarDrawer.tituloPrompt })
  await drawer.getByRole('textbox', { name: t.criar.textareaLabel }).fill(`arroz de forno ${nonce}`)
  await drawer.getByRole('button', { name: t.criar.gerar }).click()

  await expect(drawer.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  await drawer.getByRole('link', { name: t.criar.verReceita }).click()

  await expect(page).toHaveURL(new RegExp(`/pt-BR/recipes/arroz-de-forno-da-fumaca-${nonce}$`))
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
