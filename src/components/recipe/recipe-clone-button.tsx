'use client'
/**
 * "Clonar" (ADR-0045) — atalho ao lado de "Criar minha versão" numa Receita NÃO-própria: cria a
 * cópia sua NUM CLIQUE, sem o modal de edição. Mesma rota do fork (POST /derive com
 * `{ clone: true }`), mesmas regras (privada, linhagem apontando a original, galeria vazia) e o
 * mesmo destino: navega pra nova Receita. Erro ⇒ mensagem neutra inline; o botão volta a ficar
 * clicável. Guard de duplo clique: enquanto o POST corre, o botão fica desabilitado.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { recipeDetailPath } from '@/domain/recipe-detail-route'

export function RecipeCloneButton({ recipeId, locale }: { recipeId: string; locale: string }) {
  const { messages, locale: currentLocale } = useLocale()
  const m = messages.minhasCriacoes
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [erro, setErro] = useState(false)

  async function clonar() {
    if (pending) return
    setPending(true)
    setErro(false)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/derive?locale=${encodeURIComponent(locale)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clone: true }),
      })
      if (res.status === 201) {
        const data = (await res.json().catch(() => ({}))) as { recipeId?: string }
        if (data.recipeId) {
          // Mantém o botão desabilitado até a navegação trocar a página (sem segundo clone).
          router.push(recipeDetailPath(currentLocale, data.recipeId))
          router.refresh()
          return
        }
      }
      setErro(true)
      setPending(false)
    } catch {
      setErro(true)
      setPending(false)
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={clonar} disabled={pending} title={m.clonarDica}>
        {pending ? messages.system.loading : m.clonar}
      </Button>
      {erro && (
        <p
          role="alert"
          className="basis-full rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.clonarErro}
        </p>
      )}
    </>
  )
}
