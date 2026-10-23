'use client'
/**
 * Controle do DONO DA BASE numa Receita derivada (#610, ADR-0052): "Retirar meu nome" do "Baseada na receita … de
 * @você" desta versão, ou "Mostrar meu nome de novo" se ele já o retirou. Só monta quando a view buscada pela
 * sessão traz `creditoDoAutor` (o servidor decide quem é o dono da base; o cliente nunca deduz pelo @).
 *
 * `PUT /api/recipes/[id]/credit { exibir }`. A linha de crédito do topo é da árvore pública (renderizada no
 * servidor), então só muda no próximo carregamento; aqui o texto confirma o novo estado. Erro (rede, 5xx, 404 se a
 * versão saiu do ar) ⇒ mensagem neutra e o estado anterior; dá para tentar de novo. ADR-0010: route handler via
 * fetch, nunca Server Action.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import type { CreditoDoAutor } from '@/domain/derived-credit'

export function DerivedCreditAuthorControl({
  recipeId,
  initial,
}: {
  recipeId: string
  initial: CreditoDoAutor
}) {
  const { messages } = useLocale()
  const m = messages.creditoVersao
  const [exibir, setExibir] = useState(initial.exibir)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(false)

  async function alternar() {
    if (salvando) return
    setSalvando(true)
    setErro(false)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/credit`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exibir: !exibir }),
      })
      if (!res.ok) {
        setErro(true)
        return
      }
      const body = (await res.json()) as { exibir?: unknown }
      if (typeof body.exibir === 'boolean') setExibir(body.exibir)
      else setErro(true)
    } catch {
      setErro(true)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      {/* Região viva: o novo estado é anunciado quando muda (o botão continua no mesmo lugar). */}
      <p aria-live="polite" className="text-muted">
        {exibir ? m.seuNome : m.retirado}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={alternar} disabled={salvando}>
        {salvando ? m.salvando : exibir ? m.retirar : m.mostrarDeNovo}
      </Button>
      {erro && (
        <p role="alert" className="font-medium text-fg">
          {m.erro}
        </p>
      )}
    </div>
  )
}
