import { NAV_SECTIONS } from '../../src/domain/nav-sections'
import { sectionLabel, tabLabel } from '../../src/components/nav/nav-labels'
import {
  expect,
  newAccountData,
  openAccountMenu,
  openMobileMenu,
  t,
  test,
  waitForHydration,
} from '../fixtures/test'

/**
 * Conta e navegação: cadastro PELA UI (o tour de boas-vindas abre sozinho para conta nova), sair e
 * entrar de novo; logado, cada aba de cada seção (ADR-0043) marca `aria-current` e "Planejar" volta
 * à última aba visitada.
 */

const pathFor = (href: string) => (href === '/' ? '/pt-BR' : `/pt-BR${href}`)

test('cadastro pela UI abre o tour; dispensa, sai e entra de novo', async ({ page, isMobile }, testInfo) => {
  const conta = newAccountData(testInfo.workerIndex)

  await page.goto('/pt-BR/sign-up')
  await waitForHydration(page)
  const form = page.getByRole('main')
  await form.getByRole('textbox', { name: t.auth.nome }).fill(conta.name)
  await form.getByRole('textbox', { name: t.auth.email }).fill(conta.email)
  await form.getByRole('textbox', { name: t.auth.senha }).fill(conta.password)
  await form.getByRole('button', { name: t.auth.criarConta }).click()

  // Sem e-mail de conta (modo fake), o cadastro já loga e cai na home — onde o tour abre sozinho.
  await expect(page).toHaveURL(/\/pt-BR$/)
  await expect(page.getByTestId('tour-overlay')).toBeVisible()
  const tour = page.getByRole('dialog', { name: t.tour.boasVindasTitulo })
  await tour.getByRole('button', { name: t.tour.agoraNao }).click()
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0)

  const menu = await openAccountMenu(page, isMobile, conta.name)
  await menu.getByRole('menuitem', { name: t.nav.signOut }).click()
  await expect(page.locator('[data-tour="conta"] a[href^="/sign-in"]')).toBeAttached()

  await page.goto('/pt-BR/sign-in')
  await waitForHydration(page)
  const login = page.getByRole('main')
  await login.getByRole('textbox', { name: t.auth.email }).fill(conta.email)
  await login.getByRole('textbox', { name: t.auth.senha }).fill(conta.password)
  await login.getByRole('button', { name: t.nav.signIn }).click()

  await expect(page).not.toHaveURL(/sign-in/)
  await expect(page.locator('[data-tour="conta"]').getByRole('button', { name: conta.name, includeHidden: true })).toBeAttached()
  // Dispensado neste aparelho: o tour não volta no login seguinte.
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0)
})

test('logado percorre todas as abas das seções; Planejar lembra a última aba', async ({
  page,
  isMobile,
  account,
}) => {
  void account
  await page.goto('/pt-BR')
  await waitForHydration(page)

  for (const section of NAV_SECTIONS) {
    for (const tab of section.tabs) {
      if (isMobile) {
        const menu = await openMobileMenu(page)
        await menu
          .getByRole('group', { name: sectionLabel(t, section.id) })
          .getByRole('link', { name: tabLabel(t, tab.id), exact: true })
          .click()
        await expect(menu).toBeHidden()
      } else {
        await page
          .getByRole('navigation', { name: t.nav.secoesAria })
          .getByRole('link', { name: sectionLabel(t, section.id), exact: true })
          .click()
        await page
          .getByRole('navigation', { name: sectionLabel(t, section.id) })
          .getByRole('link', { name: tabLabel(t, tab.id), exact: true })
          .click()
      }
      await expect(page).toHaveURL(new RegExp(`${pathFor(tab.href)}$`))
      // A tira de abas da seção (visível nos dois perfis) marca a página atual.
      await expect(
        page
          .getByRole('navigation', { name: sectionLabel(t, section.id) })
          .getByRole('link', { name: tabLabel(t, tab.id), exact: true }),
      ).toHaveAttribute('aria-current', 'page')
      if (!isMobile) {
        await expect(
          page
            .getByRole('navigation', { name: t.nav.secoesAria })
            .getByRole('link', { name: sectionLabel(t, section.id), exact: true }),
        ).toHaveAttribute('aria-current', 'true')
      }
    }
  }

  // A última aba de Planejar foi a Despensa: o link da seção passa a levar pra ela.
  const planejar = NAV_SECTIONS.find((s) => s.id === 'planejar')!
  const ultima = planejar.tabs[planejar.tabs.length - 1]
  await page.goto('/pt-BR')
  await waitForHydration(page)
  // No celular o link da seção mora no header oculto (o menu lista as abas direto): confere o destino.
  const planejarLink = page.locator('header nav a[data-tour="nav-planejar"]')
  await expect(planejarLink).toHaveAttribute('href', ultima.href)
  if (!isMobile) {
    await planejarLink.click()
    await expect(page).toHaveURL(new RegExp(`${pathFor(ultima.href)}$`))
  }
})
