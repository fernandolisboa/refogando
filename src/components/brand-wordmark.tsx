/**
 * Wordmark "Refogando" (#270) — o R inicial recebe dois fios de vapor em páprica: um nasce
 * ATRÁS do R (desenhado ANTES do `<text>`) e outro passa NA FRENTE, cortando o topo (desenhado
 * DEPOIS). A profundidade é só ordem-de-pintura do SVG; o 'R' continua um CARACTERE REAL.
 *
 * Decisões (revisão adversarial do plano, #270):
 * - O app não baixa fonte (var(--font-display) é stack de serifa de SISTEMA, globals.css). Por
 *   isso a palavra inteira é `<text>` vivo na MESMA serifa do resto do app (não vetorizamos a
 *   letra: outline de UMA letra brigaria com as outras). O vetor pixel-exato da marca é o
 *   favicon (frigideira-lateral), não a wordmark.
 * - Largura DETERMINÍSTICA via `textLength` + `lengthAdjust="spacingAndGlyphs"`: "Refogando"
 *   ocupa sempre a mesma EXTENSÃO, qualquer que seja a serifa instalada — sem `overflow:visible`,
 *   sem vazar por cima da nav, sem folga variável. (Isso fixa a largura da PALAVRA; o registro
 *   vapor↔R é calibrado pra serifa primária (Iowan/Palatino) e degrada com elegância nas outras —
 *   não é âncora por-glifo. A marca pixel-exata continua sendo o favicon vetorial.)
 * - Vapor DENTRO do viewBox (não conta com overflow): nada é cortado quando o header sticky rola.
 * - Cores por TOKEN (ADR-0015): letras = `currentColor` (quem usa passa `text-fg` → café no claro,
 *   creme no escuro); vapor = `stroke-brand` (páprica). No escuro `--color-brand` == `--color-brand-ink`,
 *   então pintar as letras de brand-ink colapsaria com o vapor — `text-fg` mantém o contraste nos dois temas.
 * - Componente SEM estado/hook → não precisa de 'use client'; compila no bundle de quem o importa
 *   (header/footer, que são client e passam `name={messages.app.name}` p/ acompanhar o locale).
 *
 * `decorative`: no rodapé a marca é repetição decorativa (o site já é nomeado pelo link do header),
 * então sai da árvore de acessibilidade (`aria-hidden`) — evita um segundo "imagem, Refogando" e um
 * segundo `role=img`. O `<text>` segue no DOM (visível + lido por crawlers).
 */
import { cn } from '@/lib/utils'

// Geometria congelada (#270, candidato g4_p). viewBox engloba o vapor (y≥1) e os descendentes
// ("g"/"d", até ~y=98). Texto: x=10, baseline 84, fonte 64u (cap ~44u), textLength 446u.
const VIEWBOX = '0 0 484 104'
const WORD_X = 10
const WORD_BASELINE = 84
const WORD_FONT_SIZE = 64
const WORD_TEXT_LENGTH = 446
// Fio de TRÁS: nasce atrás da pança do R e emerge subindo (pintado antes do texto).
const STEAM_BACK = 'M40 48 C45 40 37 37 42 29 C46 23 39 20 43 12 C45 9 42 7 44 4'
// Fio da FRENTE: assenta sobre a coroa do R e sobe, "cortando" o topo (pintado depois do texto).
const STEAM_FRONT = 'M26 44 C21 37 29 33 24 25 C20 19 28 16 23 8 C22 5 25 4 24 1'
// Páprica nos dois fios (token via classe); cap/junção redondos = aparência de vapor.
const STEAM_CLASS = 'fill-none stroke-brand'
const STEAM_PROPS = {
  strokeWidth: 2.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function BrandWordmark({
  name,
  className,
  decorative = false,
}: {
  /** Nome da marca (passe `messages.app.name`); vira o aria-label e o texto. */
  name: string
  className?: string
  /** Marca decorativa (rodapé): sai da árvore de acessibilidade. */
  decorative?: boolean
}) {
  // Nunca renderiza aria-label vazio: link sem nome é violação de a11y (e o jsdom mascara isso
  // caindo no `<text>`, então o teste passaria em falso). `name` deve sempre vir preenchido.
  const label = name || 'Refogando'
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': label } as const)
  return (
    <svg
      viewBox={VIEWBOX}
      className={cn('w-auto', className)}
      {...a11y}
    >
      {/* TRÁS → texto → FRENTE: a ordem de pintura é a profundidade. */}
      <path d={STEAM_BACK} className={STEAM_CLASS} {...STEAM_PROPS} />
      <text
        x={WORD_X}
        y={WORD_BASELINE}
        textLength={WORD_TEXT_LENGTH}
        lengthAdjust="spacingAndGlyphs"
        fontSize={WORD_FONT_SIZE}
        fontWeight={600}
        fill="currentColor"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {label}
      </text>
      <path d={STEAM_FRONT} className={STEAM_CLASS} {...STEAM_PROPS} />
    </svg>
  )
}
