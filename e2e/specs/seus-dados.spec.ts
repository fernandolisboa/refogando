import { readFile } from 'node:fs/promises'
import { expect, t, test, waitForHydration } from '../fixtures/test'

/**
 * "Seus dados" (#595, LGPD Art. 18 II/V/VI): pelo /me/profile, a pessoa baixa o export da conta (um JSON
 * com o e-mail dela e os acessos) e exclui a conta pelo diálogo; volta para a home com o aviso de conta
 * excluída, deslogada. Sem tentativa de entrar de novo: o teto de login do Better Auth vale no `next start`,
 * e a integração já cobre que as credenciais somem.
 */

test('baixa os dados e exclui a conta pelo perfil', async ({ page, account }) => {
  await page.goto('/pt-BR/me/profile')
  await waitForHydration(page)
  const secao = page.getByRole('region', { name: t.seusDados.titulo })

  const downloadPromise = page.waitForEvent('download')
  await secao.getByRole('button', { name: t.seusDados.baixar }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^refogando-meus-dados-\d{4}-\d{2}-\d{2}\.json$/)
  const dump = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    format: string
    account: { email: string }
    loginSessions: unknown[]
  }
  expect(dump.format).toBe('refogando-account-export/v1')
  expect(dump.account.email).toBe(account.email)
  expect(dump.loginSessions.length).toBeGreaterThanOrEqual(1)
  await expect(secao.getByText(t.seusDados.baixado)).toBeVisible()

  await secao.getByRole('button', { name: t.seusDados.excluir }).click()
  const dialog = page.getByRole('dialog', { name: t.seusDados.dialogoTitulo })
  await expect(dialog).toBeVisible()
  const confirmar = dialog.getByRole('button', { name: t.seusDados.confirmar })
  await expect(confirmar).toBeDisabled()
  await dialog.getByRole('checkbox', { name: t.seusDados.entendo }).check()
  await confirmar.click()

  await expect(page).toHaveURL(/\/pt-BR$/)
  await expect(page.getByText(t.seusDados.excluida)).toBeVisible()
  await expect(page.locator('[data-tour="conta"] a[href^="/sign-in"]')).toBeAttached()
  const session = await page.request.get('/api/auth/get-session')
  expect(await session.json()).toBeNull()
})
