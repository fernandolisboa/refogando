'use client'

/**
 * Fila de moderação reativa (#63, AC4) — Curador+ (o servidor reforça requireRole 'curador').
 *
 * ADR-0010: consome `GET /api/curate/reports` + `POST .../{keep,remove}` via `fetch` (NÃO
 * Server Action). Ações otimistas (remove o card na hora) que REVERTEM no erro com mensagem
 * neutra. SEM `router.refresh()`: o sucesso é só ausência de erro (corpo `{ok:true}`) e nada
 * na árvore server deriva da fila — o estado local é autoritativo.
 *
 * Rótulos de VALOR localizados (ADR-0001/0014): `origin`/`resultKind` chegam como TOKEN cru
 * do enum; renderizamos o RÓTULO via lookup `satisfies Record<Enum,string>` (trava drift de
 * enum no TS), nunca o token. NÃO colorimos por origin — accent é selo de item de Catálogo na
 * descoberta, não etiqueta de fila admin (ADR-0015). Remover-do-pool ≠ despublicar (ADR-0003):
 * a Receita sai do pool de descoberta; o motivo é OBRIGATÓRIO (espelha `decideModerationReason`).
 *
 * Shape: `createdAt` chega como STRING ISO via `res.json()`; o card NÃO renderiza data, então
 * nunca chamamos método de `Date`. Cores: só neutros/brand AA-verificados; sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ORIGENS, RESULT_KINDS, type Origin, type ResultKind } from '@/domain/recipe'
import type { ReportQueueItem } from '@/server/curate/reports'

export function ModerationQueue() {
  const { messages } = useLocale()
  const m = messages.moderacao
  const sys = messages.system

  const [items, setItems] = useState<ReportQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Qual ação está em voo no card ocupado — distingue o rótulo "Removendo…" (Receita) de
  // "Removendo imagem…" (só a foto) e "Bloqueando…" (geração do autor, #226) para não piscar
  // os botões ao mesmo tempo (#133/#226).
  const [busyAction, setBusyAction] = useState<'remove' | 'image' | 'block' | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<
    | 'erroJaResolvido'
    | 'erroMotivo'
    | 'erroSemImagem'
    | 'erroGenerico'
    | 'erroUsuarioNaoEncontrado'
    | null
  >(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})
  // #226: motivo do BLOQUEIO da geração-de-imagem do autor (eixo separado do motivo de remoção do
  // pool). Painel revelado por `blockingId`; só quando a receita tem dono (Catálogo → sem ação).
  const [blockingId, setBlockingId] = useState<string | null>(null)
  const [blockReasonDraft, setBlockReasonDraft] = useState<Record<string, string>>({})
  // #226: bloqueio/desbloqueio é POR-AUTOR; um autor pode ter várias receitas reportadas na fila.
  // Após (des)bloquear, alternamos o rótulo de TODOS os cards desse autor via este override local
  // (o servidor é a verdade; isto evita um `load()` que perderia a posição na fila).
  const [ownerBlockOverride, setOwnerBlockOverride] = useState<Record<string, boolean>>({})

  // Rótulo localizado por valor de enum — `satisfies` trava drift (chave faltante/extra).
  const originLabel = {
    catalog: m.origemCatalog,
    ai_chat: m.origemAiChat,
    ai_structured: m.origemAiStructured,
    ai_free_text: m.origemAiFreeText,
    user_edited: m.origemUserEdited,
    web_imported: m.origemWebImported,
  } satisfies Record<Origin, string>
  const resultKindLabel = {
    success: m.tipoSucesso,
    degraded: m.tipoDegradado,
    playful: m.tipoPlayful,
  } satisfies Record<ResultKind, string>

  function labelOrigin(value: string): string {
    return (ORIGENS as readonly string[]).includes(value) ? originLabel[value as Origin] : value
  }
  function labelResultKind(value: string): string {
    return (RESULT_KINDS as readonly string[]).includes(value)
      ? resultKindLabel[value as ResultKind]
      : value
  }

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/reports')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { reports: ReportQueueItem[] }
      setItems(body.reports)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono do effect) p/ não disparar setState em cascata
    // na montagem — mesmo padrão de `search-experience.tsx`. O retry redispara `load`.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  function clearError() {
    setErrorId(null)
    setErrorKey(null)
  }

  async function handleKeep(item: ReportQueueItem) {
    if (busyId) return
    setBusyId(item.id)
    clearError()
    const snapshot = items
    // Otimista: remove o card.
    setItems((prev) => prev.filter((it) => it.id !== item.id))
    try {
      const res = await fetch(`/api/curate/reports/${item.id}/keep`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorId(item.id)
        setErrorKey(body?.error === 'ja_resolvido' ? 'erroJaResolvido' : 'erroGenerico')
      }
    } catch {
      setItems(snapshot)
      setErrorId(item.id)
      setErrorKey('erroGenerico')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(item: ReportQueueItem) {
    const reason = (reasonDraft[item.id] ?? '').trim()
    if (busyId || reason.length === 0) return
    setBusyId(item.id)
    setBusyAction('remove')
    clearError()
    const snapshot = items
    setItems((prev) => prev.filter((it) => it.id !== item.id))
    try {
      const res = await fetch(`/api/curate/reports/${item.id}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorId(item.id)
        setErrorKey(
          body?.error === 'ja_resolvido'
            ? 'erroJaResolvido'
            : body?.error === 'dados_invalidos'
              ? 'erroMotivo'
              : 'erroGenerico',
        )
      } else {
        setRemovingId(null)
      }
    } catch {
      setItems(snapshot)
      setErrorId(item.id)
      setErrorKey('erroGenerico')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  /**
   * "Remover só a imagem" (#133) — espelha `handleRemove` (mesmo motivo OBRIGATÓRIO, mesma forma
   * otimista que reverte no erro), mas POST em `.../remove-image`: esconde a foto do público SEM
   * tirar a Receita do pool. A rota resolve o MESMO report ⇒ o card sai da fila no sucesso (idêntico
   * ao remove). Mapeia o 422 `sem_imagem` (Receita reportada sem foto a remover) → `erroSemImagem`.
   */
  async function handleRemoveImage(item: ReportQueueItem) {
    const reason = (reasonDraft[item.id] ?? '').trim()
    if (busyId || reason.length === 0) return
    setBusyId(item.id)
    setBusyAction('image')
    clearError()
    const snapshot = items
    setItems((prev) => prev.filter((it) => it.id !== item.id))
    try {
      const res = await fetch(`/api/curate/reports/${item.id}/remove-image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorId(item.id)
        setErrorKey(
          body?.error === 'ja_resolvido'
            ? 'erroJaResolvido'
            : body?.error === 'sem_imagem'
              ? 'erroSemImagem'
              : body?.error === 'dados_invalidos'
                ? 'erroMotivo'
                : 'erroGenerico',
        )
      } else {
        setRemovingId(null)
      }
    } catch {
      setItems(snapshot)
      setErrorId(item.id)
      setErrorKey('erroGenerico')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  /** O autor deste card está bloqueado? Override local (pós-ação) vence o valor do servidor. */
  function isOwnerBlocked(item: ReportQueueItem): boolean {
    if (item.ownerId == null) return false
    return ownerBlockOverride[item.ownerId] ?? item.ownerImageGenBlocked
  }

  /**
   * "Bloquear/Desbloquear geração de imagem do autor" (#226, ADR-0022 dec.3 / 1º gancho do ADR-0007).
   * POST em `/api/curate/users/[ownerId]/image-gen-restriction` `{ blocked, reason? }`. Espelha o
   * `handleRemove` (motivo OBRIGATÓRIO ao BLOQUEAR; desbloquear não exige) MAS é NÃO-otimista: o card
   * NÃO some (a Receita segue na fila — bloquear o autor é ortogonal a resolver o report). Só atualiza
   * o override local do rótulo do autor. NÃO resolve o report. Catálogo (sem dono) nunca chama isto.
   */
  async function handleToggleImageGenBlock(item: ReportQueueItem) {
    if (item.ownerId == null || busyId) return
    const willBlock = !isOwnerBlocked(item)
    const reason = willBlock ? (blockReasonDraft[item.id] ?? '').trim() : ''
    // Bloquear exige motivo (o servidor reimpõe 400 dados_invalidos); desbloquear não.
    if (willBlock && reason.length === 0) return
    setBusyId(item.id)
    setBusyAction('block')
    clearError()
    try {
      const res = await fetch(`/api/curate/users/${item.ownerId}/image-gen-restriction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(willBlock ? { blocked: true, reason } : { blocked: false }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorId(item.id)
        setErrorKey(
          body?.error === 'dados_invalidos'
            ? 'erroMotivo'
            : body?.error === 'not_found'
              ? 'erroUsuarioNaoEncontrado'
              : 'erroGenerico',
        )
      } else {
        // Sucesso: alterna o rótulo de TODOS os cards do autor; fecha o painel de motivo.
        setOwnerBlockOverride((prev) => ({ ...prev, [item.ownerId as string]: willBlock }))
        setBlockingId(null)
      }
    } catch {
      setErrorId(item.id)
      setErrorKey('erroGenerico')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  return (
    <section aria-labelledby="moderacao-titulo" className="flex flex-col gap-3">
      <h2 id="moderacao-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>

      {/* Região persistente com `aria-live`/`aria-busy`: anuncia o fim do loading e o que
          chegou (fila, vazio ou erro) a um leitor de tela que ficou na seção. O wrapper não é
          desmontado entre estados; só o conteúdo troca. Mesmo recorte de search-experience.tsx. */}
      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-muted">{sys.loading}</p>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-2">
            <p
              role="alert"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
            >
              {sys.error}
            </p>
            <Button type="button" size="sm" onClick={() => void load()}>
              {sys.retry}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{m.filaVazia}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
              >
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="font-medium text-fg">{m.receita}</dt>
                  <dd className="truncate text-muted" title={item.recipeId}>
                    {item.recipeId}
                  </dd>
                  <dt className="font-medium text-fg">{m.origem}</dt>
                  <dd className="text-muted">{labelOrigin(item.origin)}</dd>
                  <dt className="font-medium text-fg">{m.tipoResultado}</dt>
                  <dd className="text-muted">{labelResultKind(item.resultKind)}</dd>
                  <dt className="font-medium text-fg">{m.motivoReport}</dt>
                  <dd className="text-muted">{item.reason}</dd>
                  <dt className="font-medium text-fg">{m.status}</dt>
                  <dd className="text-muted">{m.statusPendente}</dd>
                </dl>

                {/* Assimetria de peso (sem token de cor destrutiva — decisão do design):
                    "Manter no pool" é a ação benigna/encorajada → primário; "Remover do pool"
                    é a saída de descoberta → secundário, de-emphasized. Espelha
                    recipe-visibility-controls (CTA primário vs ação menos destacada secundária). */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleKeep(item)}
                    disabled={busyId === item.id}
                    className="disabled:opacity-70"
                  >
                    {m.manter}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      clearError()
                      setRemovingId(removingId === item.id ? null : item.id)
                    }}
                    disabled={busyId === item.id}
                    aria-expanded={removingId === item.id}
                    className="disabled:opacity-70"
                  >
                    {m.remover}
                  </Button>
                </div>

                {/* #226: ação por-AUTOR — bloquear/desbloquear a geração-de-imagem-por-IA do dono da
                    Receita reportada (abuso confirmado). Só quando há dono (Catálogo → sem ação). */}
                {item.ownerId != null && (
                  <div className="flex flex-wrap items-center gap-2">
                    {isOwnerBlocked(item) ? (
                      // Já bloqueado ⇒ desbloquear (sem motivo).
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleToggleImageGenBlock(item)}
                        disabled={busyId === item.id}
                        aria-busy={busyId === item.id && busyAction === 'block'}
                        className="disabled:opacity-70"
                      >
                        {busyId === item.id && busyAction === 'block'
                          ? m.desbloqueandoGeracao
                          : m.desbloquearGeracao}
                      </Button>
                    ) : (
                      // Não bloqueado ⇒ revela o painel de motivo (bloquear exige motivo).
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          clearError()
                          setBlockingId(blockingId === item.id ? null : item.id)
                        }}
                        disabled={busyId === item.id}
                        aria-expanded={blockingId === item.id}
                        className="disabled:opacity-70"
                      >
                        {m.bloquearGeracao}
                      </Button>
                    )}
                  </div>
                )}

                {blockingId === item.id && item.ownerId != null && !isOwnerBlocked(item) && (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.motivoBloqueioGeracao}
                      <Textarea
                        value={blockReasonDraft[item.id] ?? ''}
                        onChange={(e) =>
                          setBlockReasonDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        placeholder={m.motivoBloqueioPlaceholder}
                        aria-required="true"
                        rows={2}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleToggleImageGenBlock(item)}
                        disabled={
                          busyId === item.id ||
                          (blockReasonDraft[item.id] ?? '').trim().length === 0
                        }
                        aria-busy={busyId === item.id && busyAction === 'block'}
                        className="disabled:opacity-70"
                      >
                        {busyId === item.id && busyAction === 'block'
                          ? m.bloqueandoGeracao
                          : m.confirmarBloqueio}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setBlockingId(null)}
                        disabled={busyId === item.id}
                        className="disabled:opacity-70"
                      >
                        {m.cancelar}
                      </Button>
                    </div>
                  </div>
                )}

                {removingId === item.id && (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.motivoRemocao}
                      <Textarea
                        value={reasonDraft[item.id] ?? ''}
                        onChange={(e) =>
                          setReasonDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        placeholder={m.motivoPlaceholder}
                        aria-required="true"
                        rows={2}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleRemove(item)}
                        disabled={
                          busyId === item.id || (reasonDraft[item.id] ?? '').trim().length === 0
                        }
                        aria-busy={busyId === item.id && busyAction === 'remove'}
                        className="disabled:opacity-70"
                      >
                        {busyId === item.id && busyAction === 'remove'
                          ? m.removendo
                          : m.confirmarRemocao}
                      </Button>
                      {/* "Remover só a imagem" (#133): mesmo motivo, eixo ORTOGONAL ao remover-do-pool.
                          Secundário (a Receita SEGUE no pool — ação mais branda que tirá-la). */}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleRemoveImage(item)}
                        disabled={
                          busyId === item.id || (reasonDraft[item.id] ?? '').trim().length === 0
                        }
                        aria-busy={busyId === item.id && busyAction === 'image'}
                        className="disabled:opacity-70"
                      >
                        {busyId === item.id && busyAction === 'image'
                          ? m.removendoImagem
                          : m.removerImagem}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setRemovingId(null)}
                        disabled={busyId === item.id}
                        className="disabled:opacity-70"
                      >
                        {m.cancelar}
                      </Button>
                    </div>
                  </div>
                )}

                {errorId === item.id && errorKey && (
                  <p
                    role="alert"
                    className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
                  >
                    {m[errorKey]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
