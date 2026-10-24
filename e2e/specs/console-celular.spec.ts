import { SEED_ADMIN, SEED_PENDENTE } from '../fixtures/seed-data'
import { dismissTour, expect, test, waitForHydration } from '../fixtures/test'
import { CONSOLE_GROUPS } from '../../src/components/admin/console-sections'

/**
 * Console sem rolagem horizontal: cada seção do Console (ADR-0049), mais o início, cabe na largura da
 * tela nos dois perfis. No celular, a linha de ações do card da fila do Catálogo (Aprovar, Rejeitar,
 * Editar, Imagem, Ver receita) não quebrava e empurrava a página para o lado; o seed põe um rascunho
 * pendente para esse card existir. Seção nova entra sozinha (vem de `CONSOLE_GROUPS`).
 *
 * Entra com o admin do seed (um login por perfil: o teto de `/sign-in/*` é 5 por minuto por IP). Mede
 * depois que as filas e painéis terminam de carregar (`aria-busy`), porque é o conteúdo que estoura.
 */

const ROTAS = ['/admin', ...CONSOLE_GROUPS.flatMap((g) => g.sections.map((s) => s.href))]

test('nenhuma seção do Console rola na horizontal', async ({ page, baseURL }) => {
  test.setTimeout(90_000)
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: baseURL! },
    data: { email: SEED_ADMIN.email, password: SEED_ADMIN.password },
  })
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { user: { id: string } }
  await dismissTour(page, body.user.id)

  for (const rota of ROTAS) {
    await test.step(rota, async () => {
      await page.goto(`/pt-BR${rota}`)
      await waitForHydration(page)
      if (rota === '/admin/catalog') {
        await expect(page.getByText(SEED_PENDENTE.titulo)).toBeVisible()
      }
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
      const largura = await page.evaluate(() => ({
        tela: document.documentElement.clientWidth,
        conteudo: document.documentElement.scrollWidth,
      }))
      expect(largura.conteudo, `${rota} mais larga que a tela`).toBeLessThanOrEqual(largura.tela)
    })
  }
})
