'use client'

/**
 * Atendimento ao autor externo (titular B, sem conta) — #396/GAP-4 (`docs/legal/
 * takedown-e-remocao-titular.md` §4.2). Admin-only (a page `/admin/descoberta` revalida `min='admin'`
 * server-side; a API `POST /api/admin/attribution/clear` reforça `requireRole 'admin'`). O operador
 * informa o NOME e/ou a URL da fonte e remove o nome de TODAS as receitas web_imported que casam —
 * inclusive privadas de outros usuários (sem ownership). A URL NUNCA é tocada.
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch` (NÃO Server Action) — o servidor é a verdade (a regra
 * `hasRemovableSourceName` e a auditoria DSAR vivem lá). Dois passos: PRÉVIA (`apply:false`, só conta,
 * sem efeito) e REMOVER (`apply:true`, muta + audita na mesma transação). Cores: só tokens AA (#54).
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

type ClearResult = {
  applied: boolean
  matched: number
  recipeIds: string[]
  distinctSourceNames: string[]
}

export function OperatorAttributionSection() {
  const { messages } = useLocale()
  const m = messages.admin

  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [caseId, setCaseId] = useState('')
  const [busy, setBusy] = useState<'idle' | 'previa' | 'remover'>('idle')
  const [result, setResult] = useState<ClearResult | null>(null)
  const [errorKey, setErrorKey] = useState<'criterio' | 'caseId' | 'generico' | null>(null)

  const hasCriteria = sourceName.trim() !== '' || sourceUrl.trim() !== ''

  async function run(apply: boolean) {
    if (busy !== 'idle') return
    // Reflete a validação do servidor no cliente (evita um round-trip só p/ o 400).
    if (!hasCriteria) {
      setResult(null)
      setErrorKey('criterio')
      return
    }
    setBusy(apply ? 'remover' : 'previa')
    setResult(null)
    setErrorKey(null)
    try {
      const res = await fetch('/api/admin/attribution/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceName: sourceName.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          caseId: caseId.trim() || undefined,
          apply,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(
          body?.error === 'criterio_obrigatorio'
            ? 'criterio'
            : body?.error === 'case_id_invalido'
              ? 'caseId'
              : 'generico',
        )
        return
      }
      setResult((await res.json()) as ClearResult)
    } catch {
      setErrorKey('generico')
    } finally {
      setBusy('idle')
    }
  }

  const errorText =
    errorKey === 'criterio'
      ? m.takedownCriterioObrigatorio
      : errorKey === 'caseId'
        ? m.takedownCaseIdInvalido
        : errorKey === 'generico'
          ? m.takedownErro
          : null

  return (
    <section aria-labelledby="takedown-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="takedown-titulo" className="font-display text-lg font-semibold text-fg">
          {m.takedownTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.takedownDescricao}</p>
      </div>

      <div className="flex max-w-md flex-col gap-1">
        <label htmlFor="takedown-nome" className="text-sm font-medium text-fg">
          {m.takedownNomeLabel}
        </label>
        <input
          id="takedown-nome"
          type="text"
          value={sourceName}
          placeholder={m.takedownNomePlaceholder}
          onChange={(e) => {
            setSourceName(e.target.value)
            setResult(null)
            setErrorKey(null)
          }}
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex max-w-md flex-col gap-1">
        <label htmlFor="takedown-url" className="text-sm font-medium text-fg">
          {m.takedownUrlLabel}
        </label>
        <input
          id="takedown-url"
          type="url"
          value={sourceUrl}
          placeholder={m.takedownUrlPlaceholder}
          onChange={(e) => {
            setSourceUrl(e.target.value)
            setResult(null)
            setErrorKey(null)
          }}
          className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex max-w-md flex-col gap-1">
        <label htmlFor="takedown-caseid" className="text-sm font-medium text-fg">
          {m.takedownCaseIdLabel}
        </label>
        <input
          id="takedown-caseid"
          type="text"
          value={caseId}
          placeholder={m.takedownCaseIdPlaceholder}
          onChange={(e) => {
            setCaseId(e.target.value)
            setResult(null)
            setErrorKey(null)
          }}
          className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void run(false)}
          disabled={busy !== 'idle' || !hasCriteria}
          aria-busy={busy === 'previa'}
        >
          {busy === 'previa' ? m.takedownPreviaRodando : m.takedownPrevia}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void run(true)}
          disabled={busy !== 'idle' || !hasCriteria}
          aria-busy={busy === 'remover'}
        >
          {busy === 'remover' ? m.takedownRemovendo : m.takedownRemover}
        </Button>
      </div>

      <div aria-live="polite" className="text-sm">
        {errorText && (
          <p
            role="alert"
            className="rounded-md border border-border bg-bg px-3 py-2 font-medium text-fg"
          >
            {errorText}
          </p>
        )}
        {result && !errorText && (
          <div role="status" className="flex flex-col gap-2 font-medium text-fg">
            <p>
              {result.applied
                ? result.recipeIds.length === 0
                  ? m.takedownNada
                  : m.takedownRemovido.replace('{removiveis}', String(result.recipeIds.length))
                : m.takedownPreviaResultado
                    .replace('{casaram}', String(result.matched))
                    .replace('{removiveis}', String(result.recipeIds.length))}
            </p>
            {/* Prévia: lista os nomes DISTINTOS que serão zerados, para o operador conferir o escopo
                (um match por URL pode arrastar outro import da mesma url com nome diferente). */}
            {!result.applied && result.distinctSourceNames.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted">{m.takedownNomesRemovidos}</span>
                <ul className="list-disc pl-5 text-fg">
                  {result.distinctSourceNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
