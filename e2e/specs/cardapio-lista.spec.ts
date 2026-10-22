import { formatIngredientLine } from '../../src/domain/ingredient-line'
import { SEED_RECIPE } from '../fixtures/seed-data'
import { expect, fmt, planFromPopover, recipePath, t, test, waitForHydration } from '../fixtures/test'

/**
 * Cardápio ⇒ Lista de compras (ADR-0035): da Receita do seed, "Adicionar ao cardápio" (popover, nas
 * porções do escalador), o Cardápio da semana mostra a refeição, e "Gerar lista de compras" da semana
 * inteira leva os ingredientes, com a quantidade das porções planejadas, para uma lista nova.
 */

test('adiciona a Receita ao cardápio e gera a lista da semana inteira', async ({ page, account }) => {
  // Só pede a fixture (conta nova e logada); o valor não é usado.
  void account
  await page.goto(recipePath(SEED_RECIPE.titulo))
  await waitForHydration(page)

  await page.getByRole('button', { name: t.cardapio.planejarReceita }).click()
  // O detalhe manda as porções do escalador, que abre nas porções da própria Receita.
  await expect(page.getByRole('dialog')).toContainText(fmt(t.cardapio.porcoesValor, { n: SEED_RECIPE.porcoes }))
  await planFromPopover(page, t.cardapio.slotAlmoco)

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
  await expect(page.getByRole('checkbox')).toHaveCount(SEED_RECIPE.ingredientes.length)
  for (const ing of SEED_RECIPE.ingredientes) {
    await expect(
      page.getByRole('checkbox', { name: fmt(t.listaDeCompras.itemMarcarAria, { nome: ing.rawText }) }),
    ).toBeVisible()
    // Planejado nas porções da Receita ⇒ a quantidade da lista é a da Receita, na mesma prosa do detalhe
    // ("3 cenouras", "2 xícaras de farinha de trigo").
    const linha = formatIngredientLine({ ordem: 0, ...ing }, t, 'pt-BR')
    await expect(page.getByRole('listitem').getByText(linha, { exact: true })).toBeVisible()
  }
})
