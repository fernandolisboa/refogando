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

  // Resolução da posse no caminho público:
  //  - 'idle'      → ainda buscando (ou nem começou).
  //  - 'owner'     → o servidor confirmou `canManage` (view do dono em `ownerView`).
  //  - 'not-owner' → resposta DEFINITIVA de não-posse (200 sem canManage = pública de outro; 404 = privada
  //                  de outro / inexistente). Pode mostrar "Criar minha versão" com segurança.
  //  - 'error'     → INDETERMINADO (5xx/401/rede/JSON inválido): NÃO sabemos se é o dono ⇒ não arriscamos
  //                  a afordância errada (mostrar "Criar minha versão" ao próprio dono faria ele DERIVAR
  //                  uma cópia em vez de editar). Recupera no reload/navegação.
  type Resolution = 'idle' | 'owner' | 'not-owner' | 'error'
  const [ownerView, setOwnerView] = useState<RecipeView | null>(null)
  const [resolution, setResolution] = useState<Resolution>('idle')

  useEffect(() => {
    // PATH 2 (server já sabe) ou anônimo (nunca é dono) ⇒ não busca.
    if (serverManaged || !loggedIn) return
    let cancelled = false
    fetch(`/api/recipes/${view.id}?locale=${encodeURIComponent(locale)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return
        // SÓ confia no `canManage` do SERVIDOR (posse imposta pela sessão; nunca re-deriva no cliente).
        if (res.ok) {
          const v = (await res.json()) as RecipeView
          if (v?.canManage) {
            setOwnerView(v)
            setResolution('owner')
          } else {
            setResolution('not-owner') // pública de outro: 200 sem canManage.
          }
        } else if (res.status === 404) {
          setResolution('not-owner') // 404 leak-safe: privada de outro / inexistente — não-gerenciável.
        } else {
          setResolution('error') // 5xx/401/etc: indeterminado.
        }
      })
      .catch(() => {
        if (!cancelled) setResolution('error') // rede caiu / JSON inválido: indeterminado.
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
  // DONO já resolvido = STICKY (checado ANTES de !loggedIn): um blip transitório da sessão (refetch on
  // focus devolvendo erro/null) NÃO deve jogar o dono de volta pro convite "Entrar"/derivar. (PATH 1 não
  // tem o hint reviewImage ⇒ false.)
  if (resolution === 'owner' && ownerView) return ownerControls(ownerView, false)
  if (!sessionSettled) return null // sessão resolvendo — espera (sem flash).
  // Anônimo: `RecipeDetailActions` resolve o convite pela própria sessão (sem fetch).
  if (!loggedIn) return <RecipeDetailActions view={view} locale={locale} />
  // Não-dono DEFINITIVO (pública de outro / 404): "Criar minha versão" / derivar.
  if (resolution === 'not-owner') return <RecipeDetailActions view={view} locale={locale} />
  // Em voo ('idle') OU indeterminado ('error'): NADA. Evita o flash de "Criar minha versão" enquanto
  // resolve, e — no erro — evita mostrar a afordância ERRADA ao próprio dono (derivaria em vez de editar).
  // O custo é uma região vazia breve pro logado-não-dono (maioria) — preço de não piscar a afordância
  // errada; recupera no reload/navegação. (Derivar continua disponível pra não-dono assim que resolve.)
  return null
}
