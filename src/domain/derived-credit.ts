/**
 * Crédito público na Receita derivada (#610, ADR-0052) — módulo PURO (sem DB, sem I/O).
 *
 * Uma derivada ("Criar minha versão" ou "Clonar") publicada mostra de onde veio: "Baseada na receita <título> de
 * @handle", com link para a base e para o perfil. É o direito do autor de ter o nome indicado (Lei 9.610, art. 24,
 * II) e fecha a incoerência com a importação da web, que sempre credita a fonte (ADR-0051, risco (i)).
 *
 * O crédito (`basedOn`) sai só quando TODAS valem (senão a página não mostra nada):
 *  - a receita é uma derivada (`lineageKind='edited'`) com a base ainda ligada (`parentRecipeId`; apagar a base
 *    zera a FK por ON DELETE set null);
 *  - o dono da base não retirou o nome desta derivada (`creditRemovedAt` NULL);
 *  - a base é leitura pública (`eligibleForPublicRead`) e não é importada da web: nada de título ou link de uma
 *    receita privada, playful, removida pela moderação ou rascunho de catálogo;
 *  - base com dono: o dono não é o mesmo da derivada, a conta é pública (o MESMO filtro do perfil `/u/<handle>`,
 *    `publicAccountFilter`: o link nunca leva a um perfil 404; conta eliminada não é creditada) e ele quer ser
 *    creditado (`users.credit_on_derivatives`, em Editar perfil);
 *  - base de catálogo (sem dono): credita "do catálogo". Não há pessoa para optar por sair.
 *
 * Cadeia (D2 copiada de D1, que veio de O): credita o pai IMEDIATO. É de quem a pessoa copiou o texto.
 *
 * `creditoDoAutor` é o controle do DONO DA BASE ("Retirar meu nome" / "Mostrar meu nome de novo"), só para ele
 * (o servidor sabe quem lê pela sessão; o cliente nunca deduz). Aparece só quando o nome dele estaria na página se
 * não fosse a retirada desta derivada: com o nome lá ⇒ retirar; retirado ⇒ desfazer. Base privada, opt-out global ou
 * conta não pública ⇒ nenhum controle (desfazer não mostraria nada).
 */
import { eligibleForPublicRead } from '@/domain/recipe-detail-route'
import type { CurationStatus } from '@/domain/recipe-curation'
import type { LineageKind } from '@/domain/recipe'
import { resolveName, type TranslationNameRow } from '@/domain/recipe-read'

/**
 * O que a vista expõe (PÚBLICO). `author` ausente = a base é do catálogo. Só o `handle` público do dono da base,
 * nunca um id. `titulo` segue `resolveName` (original primário; "Original (Tradução)" com tradução confiável).
 */
export type RecipeBasedOn = {
  titulo: string
  href: string
  author?: { handle: string }
}

/** Controle do dono da base nesta derivada. `exibir=false` ⇒ ele retirou o nome (a página oferece desfazer). */
export type CreditoDoAutor = { exibir: boolean }

export type DerivedCreditDerived = {
  ownerId: string | null
  lineageKind: LineageKind | null
  parentRecipeId: string | null
  creditRemovedAt: Date | null
}

export type DerivedCreditInput = {
  /** A receita exibida (a candidata a derivada). */
  derived: DerivedCreditDerived
  /** A base (o pai), como o loader a leu. `null` = sumiu entre o select da derivada e o do pai. */
  base: {
    id: string
    ownerId: string | null
    visibility: string
    resultKind: string
    moderationRemovedAt: Date | null
    curationStatus: CurationStatus
    origin: string
    originalLocale: string
    /** Traduções da base no idioma original e no pedido (as que existirem). */
    translations: ReadonlyArray<TranslationNameRow>
    /** Slug da base no locale pedido. `null` ⇒ o link cai no uuid, como os cards da Busca. */
    slugNoLocale: string | null
  } | null
  /** Dono da base (só quando ela tem dono). */
  baseOwner: {
    handle: string
    /** Passa no `publicAccountFilter` (ativa e não é cadastro pendente): o perfil dela abre. */
    publicAccount: boolean
    creditOnDerivatives: boolean
  } | null
  locale: string
  /** Quem lê (sessão). Ausente = anônimo ou caminho público sem cookie. */
  viewerId?: string
}

export type DerivedCreditDecision = {
  basedOn?: RecipeBasedOn
  creditoDoAutor?: CreditoDoAutor
}

/**
 * A linha precisa da consulta à base? Barato e síncrono: evita a query em toda receita que não é derivada. Com o
 * crédito retirado, só quando há um leitor logado (pode ser o dono da base, que vê o "desfazer").
 */
export function needsDerivedCreditLookup(derived: DerivedCreditDerived, viewerId?: string): boolean {
  return (
    derived.lineageKind === 'edited' &&
    derived.parentRecipeId != null &&
    (derived.creditRemovedAt == null || viewerId != null)
  )
}

function decideBasedOn(input: DerivedCreditInput): RecipeBasedOn | undefined {
  const { derived, base, baseOwner, locale } = input
  if (derived.creditRemovedAt != null || base == null) return undefined
  if (
    !eligibleForPublicRead({
      ownerId: base.ownerId,
      visibility: base.visibility,
      resultKind: base.resultKind,
      moderationRemovedAt: base.moderationRemovedAt,
      curationStatus: base.curationStatus,
    }) ||
    base.origin === 'web_imported'
  ) {
    return undefined
  }
  const titulo = resolveName({
    originalLocale: base.originalLocale,
    requestLocale: locale,
    translations: base.translations,
  }).trim()
  if (titulo === '') return undefined

  // `/{locale}/recipes/<slug>`; sem slug neste locale, o uuid (a página 308a para o slug ou lê pelo caminho do
  // dono, que serve a pública a qualquer um). Mesmo fallback do card da Busca.
  const href = `/${locale}/recipes/${base.slugNoLocale ?? base.id}`

  if (base.ownerId == null) return { titulo, href }
  if (baseOwner == null || base.ownerId === derived.ownerId) return undefined
  if (!baseOwner.publicAccount || !baseOwner.creditOnDerivatives) return undefined
  return { titulo, href, author: { handle: baseOwner.handle } }
}

export function decideDerivedCredit(input: DerivedCreditInput): DerivedCreditDecision {
  const { derived, base, viewerId } = input
  if (!needsDerivedCreditLookup(derived, viewerId) || base == null || base.id !== derived.parentRecipeId) return {}

  const basedOn = decideBasedOn(input)
  // Controle do dono da base: só ele, nunca o dono da derivada (o crédito não é dele para tirar). Só aparece quando
  // o nome dele estaria na página se não fosse a retirada; aí "Retirar" (nome na página) ou "Mostrar de novo"
  // (retirado). Base privada, opt-out global ou conta não pública ⇒ nada, porque "mostrar de novo" não mostraria.
  const isBaseAuthor =
    viewerId != null && base.ownerId != null && base.ownerId === viewerId && derived.ownerId !== viewerId
  const semRetirada =
    derived.creditRemovedAt == null ? basedOn : decideBasedOn({ ...input, derived: { ...derived, creditRemovedAt: null } })
  const creditoDoAutor: CreditoDoAutor | undefined =
    isBaseAuthor && semRetirada?.author != null ? { exibir: derived.creditRemovedAt == null } : undefined

  return {
    ...(basedOn ? { basedOn } : {}),
    ...(creditoDoAutor ? { creditoDoAutor } : {}),
  }
}
