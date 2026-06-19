'use client'
/**
 * Vista do DIFF da DERIVADA (#61) — renderiza o `derivedDiff` CONGELADO (recipe-diff.ts) que a
 * rota projeta SÓ pro dono da derivada (`view.derivedDiff`, owner-gated). PURO de domínio: não
 * recomputa nada — itera os arrays/campos prontos e os rotula com `messages.derivada`/`detalhe`.
 *
 * Âmbar é EXCLUSIVO do Aviso de restrição (ADR-0004): este bloco é informativo (o que mudou em
 * relação à original), NÃO um alerta — tokens NEUTROS (border-border/bg-surface/text-muted/fg).
 *
 * `vinculoPerdido`: quando a base foi apagada (FK anulada), o diff congelado SOBREVIVE; mostramos
 * a nota de que a original sumiu mas a versão continua completa (história #289). NEUTRA.
 *
 * Sem `<h1>` (o detalhe já emite o seu): a seção abre num `<h2>` subordinado.
 */
import { useLocale } from '@/i18n/provider'
import type { DerivedDiff } from '@/domain/recipe-diff'
import { isRestricao } from '@/domain/vocabulary'

/** Junta de/para num texto legível ("a → b"), tratando null como travessão. */
function dePara(de: string | null, para: string | null): string {
  const a = de == null || de === '' ? '—' : de
  const b = para == null || para === '' ? '—' : para
  return `${a} → ${b}`
}

export function RecipeDiffView({
  diff,
  vinculoPerdido,
}: {
  diff: DerivedDiff
  vinculoPerdido?: boolean
}) {
  const { messages } = useLocale()
  const m = messages.minhasCriacoes
  const md = messages.derivada

  const { ingredientes, restricoes, campos } = diff

  const restricaoLabel = (r: string) => (isRestricao(r) ? messages.restricaoLabel[r] : r)

  // Linhas de campo textual alteradas (titulo/descricao/passos) — só as presentes.
  const camposAlterados: Array<{ rotulo: string; texto: string }> = []
  if (campos.titulo) {
    camposAlterados.push({ rotulo: messages.criar.titulo, texto: dePara(campos.titulo.de, campos.titulo.para) })
  }
  if (campos.descricao) {
    camposAlterados.push({
      rotulo: messages.detalhe.descricao,
      texto: dePara(campos.descricao.de, campos.descricao.para),
    })
  }
  if (campos.passos) {
    const de = campos.passos.de && campos.passos.de.length > 0 ? campos.passos.de.join(' · ') : null
    const para = campos.passos.para && campos.passos.para.length > 0 ? campos.passos.para.join(' · ') : null
    camposAlterados.push({ rotulo: messages.detalhe.passos, texto: dePara(de, para) })
  }

  const temAlgo =
    ingredientes.adicionados.length > 0 ||
    ingredientes.removidos.length > 0 ||
    ingredientes.quantidadeAlterada.length > 0 ||
    restricoes.adicionadas.length > 0 ||
    restricoes.removidas.length > 0 ||
    camposAlterados.length > 0

  return (
    <section
      aria-labelledby="diff-titulo"
      className="flex flex-col gap-4 rounded-md border border-border bg-surface px-4 py-3"
    >
      <h2 id="diff-titulo" className="font-display text-lg font-semibold text-fg">
        {m.diffTitulo}
      </h2>

      {vinculoPerdido && (
        <p className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg">
          {messages.edicaoPropria.vinculoPerdido}
        </p>
      )}

      {!temAlgo ? (
        <p className="text-sm text-muted">{md.copiaTitulo}</p>
      ) : (
        <dl className="flex flex-col gap-3 text-sm">
          {ingredientes.adicionados.length > 0 && (
            <div className="flex flex-col gap-1">
              <dt className="font-medium text-muted">{md.adicionado}</dt>
              <dd className="text-fg">
                <ul role="list" className="flex flex-col gap-0.5">
                  {ingredientes.adicionados.map((nome, i) => (
                    <li key={`add-${i}`}>{nome}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          {ingredientes.removidos.length > 0 && (
            <div className="flex flex-col gap-1">
              <dt className="font-medium text-muted">{md.removido}</dt>
              <dd className="text-fg">
                <ul role="list" className="flex flex-col gap-0.5">
                  {ingredientes.removidos.map((nome, i) => (
                    <li key={`rem-${i}`}>{nome}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          {ingredientes.quantidadeAlterada.length > 0 && (
            <div className="flex flex-col gap-1">
              <dt className="font-medium text-muted">{md.quantidadeAlterada}</dt>
              <dd className="text-fg">
                <ul role="list" className="flex flex-col gap-0.5">
                  {ingredientes.quantidadeAlterada.map((q, i) => (
                    <li key={`qty-${i}`}>
                      {q.nome}: {dePara(q.de, q.para)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          {(restricoes.adicionadas.length > 0 || restricoes.removidas.length > 0) && (
            <div className="flex flex-col gap-1">
              <dt className="font-medium text-muted">{md.restricaoAlterada}</dt>
              <dd className="text-fg">
                <ul role="list" className="flex flex-col gap-0.5">
                  {restricoes.adicionadas.map((r, i) => (
                    <li key={`radd-${i}`}>
                      {md.adicionado}: {restricaoLabel(r)}
                    </li>
                  ))}
                  {restricoes.removidas.map((r, i) => (
                    <li key={`rrem-${i}`}>
                      {md.removido}: {restricaoLabel(r)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          {camposAlterados.map((c, i) => (
            <div key={`campo-${i}`} className="flex flex-col gap-1">
              <dt className="font-medium text-muted">{c.rotulo}</dt>
              <dd className="text-fg">{c.texto}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
