'use client'
/**
 * Controles de VERSÃO por linhagem (#20 UI / #61) — "Gerar nova versão" pro DONO de uma Receita
 * de IA (`ai_*`). Regenerar cria uma NOVA versão IMUTÁVEL (parent + lineage_kind='regenerated') a
 * partir do MESMO pedido — NUNCA sobrescreve; as versões anteriores ficam salvas. Apresenta o
 * desfecho como uma NOVA versão (navega pra ela) ou uma mensagem honesta.
 *
 * ADR-0010: consome `POST /api/recipes/[id]/regenerate` via `fetch`; o servidor é a verdade (gate
 * owner+origin+fonte ANTES do Claude). Mapa do contrato:
 *  - 201 { recipeId } → nova versão criada → NAVEGA pra ela ("nova versão").
 *  - 200 { outcome:'impossible' } → não deu pra gerar → mensagem (sem Receita nova).
 *  - 409 { error:'sem_fonte_para_regenerar' } → "não dá pra regenerar esta" (graceful).
 *  - 429 { error:'limite_geracao' } → teto diário de geração estourado (#167) → mensagem amigável de
 *    limite (mesma do POST /api/generations) + permite tentar mais tarde.
 *  - 502 { outcome:'invalid' } → erro de sistema → mensagem + permite tentar de novo.
 *  - 404 → não-própria (não deve ocorrer; só aparece sob canManage) → mensagem neutra.
 *
 * Tokens NEUTROS (âmbar é exclusivo do Aviso de restrição, ADR-0004). `<h2>` (o detalhe emite o
 * `<h1>`). Botão de "versão anterior": link de volta a ESTA receita (a predecessora) pós-navegar.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

type ErrorKey = 'semFonte' | 'impossible' | 'invalid' | 'limite' | 'generico' | null

export function LineageVersionControls({ recipeId }: { recipeId: string }) {
  const { messages } = useLocale()
  const m = messages.versao
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<ErrorKey>(null)

  async function regenerar() {
    if (loading) return
    setLoading(true)
    setErrorKey(null)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/regenerate`, { method: 'POST' })

      if (res.status === 201) {
        const data = (await res.json()) as { recipeId: string; imageReviewSuggested?: boolean }
        // Nova versão criada → navega pra ela (a anterior fica salva e acessível por linhagem).
        // #131: se a versão herdou a foto e mudou visualmente, leva a dica de revisar a foto.
        const q = data.imageReviewSuggested ? '?reviewImage=1' : ''
        router.push(`/recipes/${data.recipeId}${q}`)
        router.refresh()
        return
      }
      if (res.status === 409) {
        setErrorKey('semFonte')
        return
      }
      if (res.status === 429) {
        // #167: teto diário de geração estourado → mensagem amigável de limite (não erro cru).
        setErrorKey('limite')
        return
      }
      if (res.status === 200) {
        // outcome:'impossible' — sem Receita nova; mensagem honesta.
        setErrorKey('impossible')
        return
      }
      if (res.status === 502) {
        setErrorKey('invalid')
        return
      }
      setErrorKey('generico')
    } catch {
      setErrorKey('generico')
    } finally {
      setLoading(false)
    }
  }

  const erroMensagem =
    errorKey === 'semFonte'
      ? m.semFonte
      : errorKey === 'impossible'
        ? messages.criar.resultadoImpossivel
        : errorKey === 'invalid'
          ? messages.criar.erroGeracao
          : errorKey === 'limite'
            ? messages.criar.erroLimiteGeracao
            : errorKey === 'generico'
              ? messages.system.error
              : null

  return (
    <section
      aria-labelledby="versao-titulo"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="versao-titulo" className="font-display text-lg font-semibold text-fg">
          {m.novaVersao}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.versaoAtual}</p>
      </div>

      <div>
        <Button
          type="button"
          onClick={regenerar}
          disabled={loading}
          aria-busy={loading}
          className="disabled:opacity-70"
        >
          {loading ? m.regenerando : m.regenerar}
        </Button>
      </div>

      {erroMensagem && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {erroMensagem}
        </p>
      )}
    </section>
  )
}
