import { SEED_RECIPE } from '../fixtures/seed-data'
import { expect, fmt, t, test, waitForHydration } from '../fixtures/test'

/**
 * Cardápio ⇒ Lista de compras (ADR-0035): da Receita do seed, "Adicionar ao cardápio" (popover), o
 * Cardápio da semana mostra a refeição, e "Gerar lista de compras" da semana inteira leva os
 * ingredientes (com as porções planejadas) para uma lista nova.
 */

test('adiciona a Receita ao cardápio e gera a lista da semana inteira', async ({ page, account }) => {
  void account
  await page.goto('/pt-BR/recipes/bolo-de-cenoura-da-fumaca')
  await waitForHydration(page)

  await page.getByRole('button', { name: t.cardapio.planejarReceita }).click()
  // O popover do calendário (role=dialog): "Adicionar" aparece também em outras partes da página.
  const popover = page.getByRole('dialog')
  // Refeição explícita: o default depende da hora do dia.
  await popover.getByRole('combobox', { name: t.cardapio.refeicao }).selectOption({ label: t.cardapio.slotAlmoco })
  await popover.getByRole('button', { name: t.cardapio.planejar, exact: true }).click()
  await expect(popover.getByRole('status')).toContainText(t.cardapio.slotAlmoco.toLowerCase())
  await popover.getByRole('link', { name: t.cardapio.verCardapio }).click()

  await expect(page).toHaveURL(/\/pt-BR\/me\/meal-plan/)
  await expect(page.getByRole('heading', { level: 1, name: t.cardapio.titulo })).toBeVisible()
  await expect(page.getByRole('link', { name: SEED_RECIPE.titulo })).toBeVisible()

  await page.getByRole('button', { name: t.cardapio.gerarLista }).click()
  const painel = page.getByRole('region', { name: t.cardapio.gerarLista })
  await painel.getByRole('radio', { name: t.cardapio.semanaInteira }).check()
  await painel.getByRole('button', { name: t.cardapio.gerarLista }).click()
  const abrir = painel.getByRole('status').getByRole('link', { name: t.cardapio.abrirLista })
  await abrir.click()

  await expect(page).toHaveURL(/\/pt-BR\/me\/shopping-lists\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: t.listaDeCompras.titulo })).toBeVisible()
  for (const ing of SEED_RECIPE.ingredientes) {
    await expect(
      page.getByRole('checkbox', { name: fmt(t.listaDeCompras.itemMarcarAria, { nome: ing.rawText }) }),
    ).toBeVisible()
  }
})
