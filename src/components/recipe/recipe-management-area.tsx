'use client'

/**
 * Área de GESTÃO + afordâncias do detalhe (#bug "dono não gerencia a própria receita pública").
 *
 * O detalhe tem DOIS caminhos de leitura (ADR-0020): o PÚBLICO/cacheável (por slug) lê ANÔNIMO (sem
 * cookie) ⇒ `canManage` AUSENTE; e o do DONO/dinâmico (cookie) ⇒ `canManage:true` + campos owner-gated.
 * Toda receita PÚBLICA usa o caminho público (o slug é canônico), então o DONO, vendo a PRÓPRIA receita
 * pública pela URL canônica (de "Minhas criações"/perfil/busca), caía como NÃO-dono: via "Criar minha
 * versão" em vez de Editar, e os blocos de gestão sumiam. (Regressão do #230; antes o detalhe sempre
 * lia com cookie.)
 *
 * O servidor NÃO pode resolver o dono no caminho público sem quebrar a cacheabilidade (cookie ⇒ dinâmico).
 * Então resolvemos NO CLIENTE — MESMO padrão de `RecipeEngagementControls`/`ProfileFollowSection`:
 * `useSession` + fetch `no-store` + confiar no `canManage` do SERVIDOR (nunca re-derivar posse no cliente).
 *
 *  - Caminho do DONO (`view.canManage` já veio true): renderiza a gestão DIRETO (sem fetch, sem flash).
 *  - Caminho público + LOGADO: busca `GET /api/recipes/<id>` (cookie ⇒ devolve a view do dono ou 404
 *    leak-safe). `canManage` ⇒ gestão a partir da view buscada; senão ⇒ "Criar minha versão".
 *  - Caminho público + ANÔNIMO: `RecipeDetailActions` mostra o convite (sem fetch — anônimo nunca é dono).
 *  - PENDENTE (sessão resolvendo, ou logado e fetch não voltou): renderiza NADA — evita o flash de
 *    "Criar minha versão" pro próprio dono antes da gestão aparecer.
 *
 * `RecipeDetailActions` é REUSADO intacto: passando-lhe a view do dono, seu próprio ramo `canManage`
 * renderiza Editar/Regenerar/etc. `RecipeStatusChip` (puro) + `RecipeImageManager` (client) entram ANTES
 * dele, preservando a ordem original (status → imagem → ações).
 */

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeStatusChip } from './recipe-status-chip'
import { RecipeImageManager } from './recipe-image-manager'
import { RecipeDetailActions } from './recipe-detail-actions'

export function RecipeManagementArea({
  view,
  locale,
  reviewImage,
}: {
  view: RecipeView
  locale: string
  /** #131: sugerir revisar a foto após edição — só faz sentido no caminho do dono/dinâmico (PATH 2). */
  reviewImage: boolean
}) {
  const { messages } = useLocale()
  const session = useSession()

  // O servidor já resolveu o dono? (caminho dinâmico/dono). Senão é o caminho público (cacheável).
  const serverManaged = view.canManage ?? false
  const sessionSettled = !session.isPending
  const loggedIn = sessionSettled && !session.error && !!session.data

  // View do dono resolvida no cliente (caminho público + dono). `null` até resolver / se não-dono.
  const [ownerView, setOwnerView] = useState<RecipeView | null>(null)
  const [fetchDone, setFetchDone] = useState(false)

  useEffect(() => {
    // PATH 2 (server já sabe) ou anônimo (nunca é dono) ⇒ não busca.
    if (serverManaged || !loggedIn) return
    let cancelled = false
    fetch(`/api/recipes/${view.id}?locale=${encodeURIComponent(locale)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return
        // SÓ confia no `canManage` do SERVIDOR (posse imposta pela sessão; 404 leak-safe a não-dono).
        if (res.ok) {
          const v = (await res.json()) as RecipeView
          if (v?.canManage) setOwnerView(v)
        }
        setFetchDone(true)
      })
      .catch(() => {
        if (!cancelled) setFetchDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [serverManaged, loggedIn, view.id, locale])

  // Gestão do DONO a partir de uma view com `canManage`: status (puro) → imagem → ações, NESTA ordem.
  function ownerControls(v: RecipeView, reviewSuggested: boolean) {
    return (
      <>
        {v.visibility && <RecipeStatusChip visibility={v.visibility} m={messages} />}
        <RecipeImageManager
          recipeId={v.id}
          hasImage={v.imageUrl != null}
          gallery={v.gallery ?? []}
          reviewSuggested={reviewSuggested}
          aiGenEnabled={v.imageGenEnabled ?? true}
          imageGenBlocked={v.imageGenBlocked ?? false}
        />
        <RecipeDetailActions view={v} locale={locale} />
      </>
    )
  }

  // PATH 2: o servidor já entregou a view do dono — renderiza direto (sem fetch, sem flash).
  if (serverManaged) return ownerControls(view, reviewImage)

  // PATH 1 (público):
  if (!sessionSettled) return null // sessão resolvendo — espera (sem flash).
  // Anônimo: `RecipeDetailActions` resolve o convite pela própria sessão (sem fetch).
  if (!loggedIn) return <RecipeDetailActions view={view} locale={locale} />
  if (!fetchDone) return null // logado, resolvendo posse — espera (evita flash de "Criar minha versão").
  // Dono: gestão a partir da view buscada (PATH 1 não tem o hint reviewImage ⇒ false).
  if (ownerView) return ownerControls(ownerView, false)
  // Logado e NÃO-dono (ou fetch falhou): "Criar minha versão" / derivar.
  return <RecipeDetailActions view={view} locale={locale} />
}
