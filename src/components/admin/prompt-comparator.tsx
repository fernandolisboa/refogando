'use client'

/**
 * Comparador de prompt antes/depois (#425, ADR-0029 dec.7) — Admin-only (a page `/admin/comparador`
 * revalida `min='admin'` server-side; a rota `/api/admin/prompt-compare` reforça `requireRole 'admin'`).
 * SÓ-LEITURA: dispara a comparação e RENDERIZA o antes/depois; não salva nada.
 *
 * ADR-0010: consome o ROUTE HANDLER `POST /api/admin/prompt-compare` via `fetch` (NÃO Server Action).
 * O servidor é a verdade (roda as duas gerações + imagem opcional e classifica); aqui só ofertamos o
 * gatilho e desenhamos o que a rota devolve. FAN-OUT POR-FIXTURE: uma chamada por índice de fixture
 * (rodar todas de uma vez estouraria o `maxDuration=60`), sequencialmente, pintando cada resultado
 * assim que chega. Texto-só por default; imagem é opt-in (checkbox) por ser ~2× mais lenta/cara.
 *
 * `FIXED_BRIEFINGS` é DOMÍNIO PURO (sem DB/server) — seguro no bundle do cliente; só lemos o
 * comprimento/`id`/`mode` para iterar e rotular. O DTO `ComparisonResponse` entra como `import type`
 * (apagado na compilação) — nenhum código de servidor vaza pro cliente.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { FIXED_BRIEFINGS } from '@/domain/prompt-comparator'
import type {
  ComparisonResponse,
  ComparatorSideResult,
  ComparisonSide,
} from '@/domain/prompt-comparator'
import type { GenerationOutcome } from '@/domain/generation'
import type { Messages } from '@/i18n/messages'

type Cell = { status: 'idle' | 'loading' | 'done' | 'error'; data?: ComparisonResponse }

/** Rótulo i18n do outcome (flat keys — o Messages type não suporta sub-objetos). */
function outcomeLabel(m: Messages['admin'], outcome: GenerationOutcome): string {
  switch (outcome) {
    case 'success':
      return m.comparadorOutcomeSuccess
    case 'degraded':
      return m.comparadorOutcomeDegraded
    case 'playful':
      return m.comparadorOutcomePlayful
    case 'impossible':
      return m.comparadorOutcomeImpossible
    case 'invalid':
      return m.comparadorOutcomeInvalid
  }
}

/** Uma coluna (velho|novo): outcome + systemPrompt colapsável + receita (título/ingredientes/passos) + imagem. */
function SideColumn({
  side,
  result,
  m,
}: {
  side: ComparisonSide
  result: ComparatorSideResult
  m: Messages['admin']
}) {
  const heading = side === 'old' ? m.comparadorVelho : m.comparadorNovo
  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm font-semibold text-fg">{heading}</span>
        <span className="rounded bg-muted/20 px-2 py-0.5 text-xs font-medium text-muted">
          {outcomeLabel(m, result.outcome)}
        </span>
      </div>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer">{m.comparadorSystemPrompt}</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">{result.systemPrompt}</pre>
      </details>

      {result.recipe ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <p className="font-medium text-fg">{result.recipe.titulo}</p>
          <div>
            <p className="text-xs font-semibold text-muted uppercase">{m.comparadorIngredientes}</p>
            <ul className="list-disc pl-5">
              {result.recipe.ingredientes.map((ing, i) => (
                <li key={i}>{ing}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted uppercase">{m.comparadorPassos}</p>
            <ol className="list-decimal pl-5">
              {result.recipe.passos.map((passo, i) => (
                <li key={i}>{passo}</li>
              ))}
            </ol>
          </div>
          {result.advisory ? <p className="text-xs text-muted italic">{result.advisory}</p> : null}
          {result.imageDataUrl ? (
            <img
              src={result.imageDataUrl}
              alt={m.comparadorImagemAlt}
              className="mt-1 max-w-full rounded"
            />
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {m.comparadorSemReceita}
          {result.advisory ? ` ${result.advisory}` : ''}
        </p>
      )}
    </div>
  )
}

export function PromptComparator() {
  const { messages } = useLocale()
  const m = messages.admin

  const [withImage, setWithImage] = useState(false)
  const [running, setRunning] = useState(false)
  // Um Cell por índice de fixture (paralelo ao array FIXED_BRIEFINGS).
  const [cells, setCells] = useState<Cell[]>(() => FIXED_BRIEFINGS.map(() => ({ status: 'idle' })))

  async function runAll() {
    if (running) return
    setRunning(true)
    setCells(FIXED_BRIEFINGS.map(() => ({ status: 'idle' })))
    // Fan-out POR-FIXTURE, sequencial: uma chamada por índice (cada uma roda os dois lados no servidor).
    for (let i = 0; i < FIXED_BRIEFINGS.length; i++) {
      setCells((prev) => prev.map((c, j) => (j === i ? { status: 'loading' } : c)))
      try {
        const res = await fetch('/api/admin/prompt-compare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fixtureIndex: i, withImage }),
        })
        if (!res.ok) {
          setCells((prev) => prev.map((c, j) => (j === i ? { status: 'error' } : c)))
          continue
        }
        const data = (await res.json()) as ComparisonResponse
        setCells((prev) => prev.map((c, j) => (j === i ? { status: 'done', data } : c)))
      } catch {
        setCells((prev) => prev.map((c, j) => (j === i ? { status: 'error' } : c)))
      }
    }
    setRunning(false)
  }

  return (
    <section aria-labelledby="comparador-titulo" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="comparador-titulo" className="font-display text-lg font-semibold text-fg">
          {m.comparadorTitulo}
        </h2>
        <p className="text-sm text-muted">{m.comparadorDescricao}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" size="sm" onClick={() => void runAll()} disabled={running}>
          {running ? m.comparadorRodando : m.comparadorRodar}
        </Button>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={withImage}
            disabled={running}
            onChange={(e) => setWithImage(e.target.checked)}
          />
          {m.comparadorGerarImagem}
        </label>
      </div>

      <div aria-live="polite" className="flex flex-col gap-6">
        {FIXED_BRIEFINGS.map((fixture, i) => {
          const cell = cells[i]
          return (
            <div key={fixture.id} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted uppercase">
                {fixture.id} · {fixture.mode}
              </p>
              {cell.status === 'loading' ? (
                <p className="text-sm text-muted">{m.comparadorRodando}</p>
              ) : cell.status === 'error' ? (
                <p className="text-sm text-muted">{m.comparadorErro}</p>
              ) : cell.status === 'done' && cell.data ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SideColumn side="old" result={cell.data.old} m={m} />
                  <SideColumn side="new" result={cell.data.new} m={m} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
