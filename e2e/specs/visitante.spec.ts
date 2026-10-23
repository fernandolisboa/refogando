import { enUS } from '../../src/i18n/messages/en-US'
import { SEED_RECIPE } from '../fixtures/seed-data'
import { expect, recipePath, t, test, waitForHydration } from '../fixtures/test'

/**
 * Visitante (sem conta): a porta pública do app — home com locale, Busca, detalhe da Receita pelo slug,
 * o tema escolhido sobrevivendo à hidratação (o script pré-pintura e o React não podem brigar) e os Termos de
 * Uso pelo rodapé (ADR-0051).
 */

const RECIPE_PATH = recipePath(SEED_RECIPE.titulo)

test('busca "cenoura", abre a Receita do seed pelo slug e recarrega', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/pt-BR$/)
  await waitForHydration(page)
  // Faixa para visitantes (#472): uma das frases, com o botão para o cadastro; some ao buscar (só no repouso).
  const faixa = page.locator('#faixa-home-titulo')
  await expect(faixa).toBeVisible()
  expect(t.faixaHome.titulos).toContain(await faixa.textContent())

  await page.getByRole('searchbox', { name: t.busca.buscarLabel }).fill('cenoura')
  await expect(page).toHaveURL(/[?&]q=cenoura/)
  await expect(faixa).toHaveCount(0)
  const catalogo = page.getByRole('region', { name: t.busca.secaoCatalogo })
  await catalogo.getByRole('link', { name: SEED_RECIPE.titulo }).click()

  await expect(page).toHaveURL(RECIPE_PATH)
  await expect(page.getByRole('heading', { level: 1, name: SEED_RECIPE.titulo })).toBeVisible()

  const res = await page.reload()
  expect(res?.status()).toBe(200)
  await waitForHydration(page)
  await expect(page.getByRole('heading', { level: 1, name: SEED_RECIPE.titulo })).toBeVisible()
  // Ingrediente renderizado com a medida (quantidade + nome) — prova que o corpo veio do banco.
  await expect(page.getByText('3 cenouras', { exact: true })).toBeVisible()
})

test('tema escuro do cookie persiste após a hidratação; alternar para o claro também persiste', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL! }])
  const html = page.locator('html')

  for (const path of [RECIPE_PATH, '/pt-BR', '/pt-BR/recipes/nao-existe-e2e']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(path.endsWith('nao-existe-e2e') ? 404 : 200)
    await waitForHydration(page)
    await expect(html, path).toHaveClass(/\bdark\b/)
  }
  await expect(page.getByRole('heading', { level: 1, name: t.system.notFound })).toBeVisible()

  await page.goto(RECIPE_PATH)
  await waitForHydration(page)
  await page.getByRole('contentinfo').getByRole('button', { name: t.theme.light }).click()
  await expect(html).toHaveClass(/\blight\b/)
  await expect(html).not.toHaveClass(/\bdark\b/)

  await page.reload()
  await waitForHydration(page)
  await expect(html).toHaveClass(/\blight\b/)
  await expect(page.getByRole('contentinfo').getByRole('button', { name: t.theme.dark })).toBeVisible()
  const theme = (await context.cookies()).find((c) => c.name === 'theme')
  expect(theme?.value).toBe('light')
})

test('o rodapé leva aos Termos de Uso; a versão en-US responde 200', async ({ page }) => {
  await page.goto('/pt-BR')
  await waitForHydration(page)
  await page.getByRole('contentinfo').getByRole('link', { name: t.termos.nome }).click()
  // O link do rodapé é sem prefixo; o proxy manda ao locale do navegador (o Playwright roda em pt-BR).
  await expect(page).toHaveURL(/\/pt-BR\/termos$/)
  await expect(page.getByRole('heading', { level: 1, name: t.termos.titulo })).toBeVisible()

  const res = await page.goto('/en-US/termos')
  expect(res?.status()).toBe(200)
  await waitForHydration(page)
  await expect(page.getByRole('heading', { level: 1, name: enUS.termos.titulo })).toBeVisible()
})
