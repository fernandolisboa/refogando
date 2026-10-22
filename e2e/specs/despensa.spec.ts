import { PANTRY_HAVE, PANTRY_MISSING, SEED_RECIPE } from '../fixtures/seed-data'
import { expect, fmt, t, test, waitForHydration } from '../fixtures/test'

/**
 * Despensa (ADR-0038/0042): o que a pessoa tem em casa persiste, "O que dá pra fazer" acha a Receita do
 * seed em "Falta pouco" (casamento por palavra: "ovo" cobre "ovos"), "Pôr o que falta na lista" leva SÓ
 * o que falta, e "Cozinhei" no Cardápio tira da Despensa o que a Receita usou.
 */

test('despensa persiste, sugere a Receita do seed e "Cozinhei" consome os itens', async ({ page, account }) => {
  void account
  await page.goto('/pt-BR/me/pantry')
  await waitForHydration(page)

  await page.getByRole('textbox', { name: t.despensa.adicionarRotulo }).fill(PANTRY_HAVE.join(', '))
  await page.getByRole('button', { name: t.despensa.adicionar, exact: true }).click()
  for (const item of PANTRY_HAVE) {
    await expect(page.getByRole('button', { name: fmt(t.despensa.remover, { nome: item }) })).toBeVisible()
  }

  await page.reload()
  await waitForHydration(page)
  await expect(page.getByText(fmt(t.despensa.itensContagem, { n: PANTRY_HAVE.length }))).toBeVisible()
  for (const item of PANTRY_HAVE) {
    await expect(page.getByRole('button', { name: fmt(t.despensa.remover, { nome: item }) })).toBeVisible()
  }

  const resultados = page.getByRole('region', { name: t.despensa.resultadosTitulo })
  await expect(resultados.getByRole('heading', { name: t.despensa.quaseProntasTitulo })).toBeVisible()
  const receita = resultados.getByRole('listitem').filter({ has: page.getByRole('link', { name: SEED_RECIPE.titulo }) })
  await expect(receita).toContainText(fmt(t.despensa.falta, { lista: PANTRY_MISSING.join(', ') }))

  // "Pôr o que falta na lista": só farinha e açúcar vão para a lista.
  await receita.getByRole('button', { name: `${t.despensa.porNaLista}: ${SEED_RECIPE.titulo}` }).click()
  await receita.getByRole('status').getByRole('link', { name: t.despensa.abrirLista }).click()
  await expect(page).toHaveURL(/\/pt-BR\/me\/shopping-lists\/[0-9a-f-]{36}$/)
  for (const nome of PANTRY_MISSING) {
    await expect(page.getByRole('checkbox', { name: fmt(t.listaDeCompras.itemMarcarAria, { nome }) })).toBeVisible()
  }
  await expect(page.getByRole('checkbox')).toHaveCount(PANTRY_MISSING.length)

  // Planeja pela Despensa e marca "Cozinhei" no Cardápio: ovo e cenoura saem da Despensa.
  await page.goto('/pt-BR/me/pantry')
  await waitForHydration(page)
  await resultados.getByRole('button', { name: `${t.cardapio.porNoCardapio}: ${SEED_RECIPE.titulo}` }).click()
  const popover = page.getByRole('dialog')
  await popover.getByRole('combobox', { name: t.cardapio.refeicao }).selectOption({ label: t.cardapio.slotJantar })
  await popover.getByRole('button', { name: t.cardapio.planejar, exact: true }).click()
  await popover.getByRole('link', { name: t.cardapio.verCardapio }).click()

  await expect(page).toHaveURL(/\/pt-BR\/me\/meal-plan/)
  await page.getByRole('button', { name: fmt(t.cardapio.cozinheiAria, { nome: SEED_RECIPE.titulo }) }).click()
  const status = page.getByRole('status').filter({ hasText: t.cardapio.cozinheiRemovidos.split('{')[0] })
  for (const item of PANTRY_HAVE) await expect(status).toContainText(item)

  await page.goto('/pt-BR/me/pantry')
  await waitForHydration(page)
  await expect(page.getByText(t.despensa.vazia)).toBeVisible()
})
