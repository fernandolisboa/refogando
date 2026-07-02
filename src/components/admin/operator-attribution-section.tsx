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

type EscalateAction = 'url_unlink' | 'record_deletion'

type EscalateResult = {
  applied: boolean
  action: EscalateAction
  matched: number
  recipeIds: string[]
  distinctSourceNames: string[]
  distinctSourceUrls: string[]
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

  // Escalada além do nome (#397/GAP-3): estado próprio. `escBusy` gateia; `escResult` guarda a prévia
  // (apply:false) OU o resultado do apply. A CONFIRMAÇÃO destrutiva só habilita DEPOIS de uma prévia
  // com escopo > 0 — o operador precisa ver o que será desvinculado/apagado antes de confirmar.
  const [escAction, setEscAction] = useState<EscalateAction>('url_unlink')
  const [escBusy, setEscBusy] = useState<'idle' | 'previa' | 'aplicar'>('idle')
  const [escResult, setEscResult] = useState<EscalateResult | null>(null)
  const [escErrorKey, setEscErrorKey] = useState<'caseId' | 'generico' | null>(null)

  const hasCriteria = sourceName.trim() !== '' || sourceUrl.trim() !== ''
  // A confirmação destrutiva exige uma PRÉVIA recém-rodada, com a MESMA ação e escopo não-vazio.
  const canConfirm =
    escResult != null &&
    !escResult.applied &&
    escResult.action === escAction &&
    escResult.recipeIds.length > 0

  function resetEscalate() {
    setEscResult(null)
    setEscErrorKey(null)
  }

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

  async function runEscalate(apply: boolean) {
    if (escBusy !== 'idle') return
    if (!hasCriteria) {
      resetEscalate()
      setErrorKey('criterio') // reaproveita o alerta de critério do bloco de cima
      return
    }
    setEscBusy(apply ? 'aplicar' : 'previa')
    setEscResult(null)
    setEscErrorKey(null)
    try {
      const res = await fetch('/api/admin/attribution/escalate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: escAction,
          sourceName: sourceName.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          caseId: caseId.trim() || undefined,
          apply,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setEscErrorKey(body?.error === 'case_id_invalido' ? 'caseId' : 'generico')
        return
      }
      setEscResult((await res.json()) as EscalateResult)
    } catch {
      setEscErrorKey('generico')
    } finally {
      setEscBusy('idle')
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

  const escErrorText =
    escErrorKey === 'caseId'
      ? m.takedownCaseIdInvalido
      : escErrorKey === 'generico'
        ? m.escalonarErro
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
            resetEscalate()
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
            resetEscalate()
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
            resetEscalate()
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

      {/* Escalada além do nome (#397/GAP-3): desvincular a URL inteira ou apagar a importada. Reusa o
          nome/URL/caseId acima. A POLÍTICA de quando usar aguarda o sign-off jurídico (aviso explícito);
          a CONFIRMAÇÃO destrutiva só habilita depois de uma prévia com escopo não-vazio. */}
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-base font-semibold text-fg">{m.escalonarTitulo}</h3>
          <p
            role="note"
            className="max-w-[60ch] rounded-md border border-border bg-bg px-3 py-2 text-sm text-muted"
          >
            {m.escalonarAviso}
          </p>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-fg">{m.escalonarAcaoLabel}</legend>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="radio"
              name="escalonar-acao"
              value="url_unlink"
              checked={escAction === 'url_unlink'}
              onChange={() => {
                setEscAction('url_unlink')
                resetEscalate()
              }}
            />
            {m.escalonarAcaoUnlink}
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="radio"
              name="escalonar-acao"
              value="record_deletion"
              checked={escAction === 'record_deletion'}
              onChange={() => {
                setEscAction('record_deletion')
                resetEscalate()
              }}
            />
            {m.escalonarAcaoDelete}
          </label>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void runEscalate(false)}
            disabled={escBusy !== 'idle' || !hasCriteria}
            aria-busy={escBusy === 'previa'}
          >
            {escBusy === 'previa' ? m.escalonarPreviaRodando : m.escalonarPrevia}
          </Button>
          {/* Confirmação destrutiva — só aparece após uma prévia com escopo > 0 (o operador viu o que
              será removido). `variant="destructive"` sinaliza o risco. */}
          {canConfirm && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void runEscalate(true)}
              disabled={escBusy !== 'idle'}
              aria-busy={escBusy === 'aplicar'}
            >
              {escBusy === 'aplicar'
                ? m.escalonarAplicando
                : escAction === 'url_unlink'
                  ? m.escalonarConfirmUnlink
                  : m.escalonarConfirmDelete}
            </Button>
          )}
        </div>

        <div aria-live="polite" className="text-sm">
          {escErrorText && (
            <p
              role="alert"
              className="rounded-md border border-border bg-bg px-3 py-2 font-medium text-fg"
            >
              {escErrorText}
            </p>
          )}
          {escResult && !escErrorText && (
            <div role="status" className="flex flex-col gap-2 font-medium text-fg">
              <p>
                {escResult.applied
                  ? escResult.recipeIds.length === 0
                    ? m.escalonarNada
                    : (escResult.action === 'url_unlink'
                        ? m.escalonarUnlinkOk
                        : m.escalonarDeleteOk
                      ).replace('{n}', String(escResult.recipeIds.length))
                  : escResult.recipeIds.length === 0
                    ? m.escalonarNada
                    : m.escalonarPreviaResultado.replace('{casaram}', String(escResult.matched))}
              </p>
              {/* Prévia: lista URLs e nomes DISTINTOS do escopo, para conferência antes de confirmar. */}
              {!escResult.applied && escResult.distinctSourceUrls.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted">{m.escalonarUrlsAfetadas}</span>
                  <ul className="list-disc pl-5 font-mono text-fg">
                    {escResult.distinctSourceUrls.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!escResult.applied && escResult.distinctSourceNames.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted">{m.escalonarNomesAfetados}</span>
                  <ul className="list-disc pl-5 text-fg">
                    {escResult.distinctSourceNames.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
