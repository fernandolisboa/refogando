/**
 * Motor puro de Aviso de restrição — módulo PURO (issue #7, §3.1).
 *
 * Espelha o padrão `decide*` de `recipe-visibility.ts` (decisão pura, zero DB/I/O,
 * total/determinística, sem throw, sem efeito). Decide SÓ CONTRADIÇÕES óbvias entre
 * o dado oportunista de alérgeno de um ingrediente e uma restrição DECLARADA da
 * Receita (ex.: trigo numa Receita marcada `sem_gluten`). NÃO é verificação nem
 * conformidade (ADR-0004) — a responsabilidade final é do usuário.
 *
 * Locale-neutro por construção: emite APENAS códigos (`kind`/`restricao`/`alergeno`),
 * SEM prosa de usuário. A frase localizada nasce só na vista (resolveRecipeView), no
 * `requestLocale`. O `alergeno` devolvido é o token NORMALIZADO.
 *
 * Ausência de dado NUNCA dispara nem vira falso "tudo certo": `alergenos == null`
 * (raw-text-only ou FK sem dado) e `alergenos == []` (FK com dado explicitamente
 * vazio) não produzem contradição — o motor só fala quando há um match concreto no
 * mapa, e fica calado no resto (sem inventar all-clear).
 *
 * O mapa `ALLERGEN_CONTRADICTIONS` é uma SEMENTE mínima (trigo/glúten → `sem_gluten`;
 * laticínio → `sem_lactose`/`vegano`); cresce em PRs futuros e via base do Curador
 * (story 314, FORA de escopo). Laticínio NÃO contradiz `vegetariano` (ovolacto aceita
 * laticínio — evitaria falso alarme).
 */

import type { Restricao } from '@/domain/vocabulary'

export type RestrictionNotice = { kind: 'contradicao'; restricao: Restricao; alergeno: string }
export type RestrictionDecision = { avisos: RestrictionNotice[] }

/**
 * Normaliza um token textual para comparação por igualdade canônica: NFD + descarte
 * de diacríticos (acentos) + minúsculas + trim. Fonte ÚNICA de normalização de texto
 * do domínio — usada para SEMEAR as chaves do mapa de alérgenos, para o token incoming
 * (via `normalizeAllergen`), e reusada pelo dedup de BriefingItem por `raw_text` em
 * `briefing.ts` (mesma simetria de comparação, sem duplicar a lógica).
 */
export function normalizeText(token: string): string {
  return token
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Normaliza um token de alérgeno para casar contra o mapa. Delega a `normalizeText`
 * (fonte única) — mantém o nome de domínio do motor de Aviso sem reimplementar a regra.
 */
function normalizeAllergen(token: string): string {
  return normalizeText(token)
}

/**
 * Mapa de token NORMALIZADO (lowercase + sem acento) → restrições que ele contradiz.
 * Os valores são tipados pelo enum `Restricao` via `satisfies`, que trava em
 * compile-time qualquer drift (typo como `'sem_glutem'`, valor fora do enum).
 */
const ALLERGEN_CONTRADICTIONS = {
  // glúten / trigo → sem_gluten (exemplo canônico do ADR-0004)
  gluten: ['sem_gluten'],
  trigo: ['sem_gluten'],
  wheat: ['sem_gluten'],
  // laticínio → sem_lactose E vegano (NÃO vegetariano: ovolacto aceita laticínio — D1)
  leite: ['sem_lactose', 'vegano'],
  lactose: ['sem_lactose', 'vegano'],
  laticinio: ['sem_lactose', 'vegano'],
  dairy: ['sem_lactose', 'vegano'],
  milk: ['sem_lactose', 'vegano'],
} satisfies Record<string, Restricao[]>

/**
 * Aviso PÓS-geração (issue #87, endurecimento ADR-0004): re-checa a RECEITA GERADA
 * contra as restrições que o PRÓPRIO LLM declarou. Diferente do pré-geração (que parte
 * do que o usuário DECLAROU no Briefing + alérgenos de catálogo via FK), aqui os
 * ingredientes vêm como `rawText` LIVRE, SEM ingredientId — então o alérgeno é detectado
 * casando as PALAVRAS normalizadas do rawText contra as CHAVES de `ALLERGEN_CONTRADICTIONS`
 * (ex.: 'farinha de trigo' → palavra 'trigo' é chave → contradiz `sem_gluten`).
 *
 * Match por PALAVRA, NUNCA substring: tokeniza por fronteira não-alfanumérica (cobre a
 * pontuação que o LLM emite, ex.: 'farinha de trigo.' → ['farinha','de','trigo']) e exige
 * IGUALDADE exata contra as chaves (assim 'triângulo' NÃO casa 'trigo', 'integral' não casa
 * nada). Mantém SÓ as palavras que são CHAVE conhecida do mapa → o `alergeno` exibido nunca
 * é rawText arbitrário (conjunto fechado, seguro p/ renderAvisos).
 *
 * DELEGA a `decideRestrictionNotices` (reusa o MESMO mapa + dedup por restrição — ADR-0009,
 * zero duplicação de vocabulário). PURO/total/sem-throw: rawText vazio/null vira
 * `{alergenos:null}` (ausência nunca dispara).
 */
export function decidePostGenerationRestrictionNotices(input: {
  restricoes: ReadonlyArray<Restricao>
  ingredientes: ReadonlyArray<{ rawText: string | null }>
}): RestrictionDecision {
  const items = input.ingredientes.map((ing) => {
    if (ing.rawText == null) return { alergenos: null }
    // Tokeniza por fronteira não-alfanumérica APÓS normalizar (cobre pontuação do LLM),
    // mantendo SÓ as palavras que são chave conhecida do mapa (match por palavra, não
    // substring; nunca ecoa rawText arbitrário).
    const palavras = normalizeText(ing.rawText)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w !== '' && Object.hasOwn(ALLERGEN_CONTRADICTIONS, w))
    return { alergenos: palavras }
  })
  return decideRestrictionNotices({ restricoes: input.restricoes, items })
}

export function decideRestrictionNotices(input: {
  restricoes: ReadonlyArray<Restricao>
  items: ReadonlyArray<{ alergenos: string[] | null }>
}): RestrictionDecision {
  const declared = new Set<Restricao>(input.restricoes)
  // Cada Restricao produz NO MÁXIMO uma entrada (dedup por restrição): o primeiro
  // match que toca uma restrição vence. Determinismo: itens já vêm ordenados pelo
  // loader (ordem,id) e os tokens na ordem do array.
  const emitidas = new Set<Restricao>()
  const avisos: RestrictionNotice[] = []

  for (const item of input.items) {
    // Ausência de dado (null) ou dado vazio ([]) nunca dispara.
    if (item.alergenos == null) continue
    for (const token of item.alergenos) {
      const norm = normalizeAllergen(token)
      const contradiz = (ALLERGEN_CONTRADICTIONS as Record<string, Restricao[]>)[norm]
      if (!contradiz) continue
      for (const restricao of contradiz) {
        if (!declared.has(restricao) || emitidas.has(restricao)) continue
        emitidas.add(restricao)
        avisos.push({ kind: 'contradicao', restricao, alergeno: norm })
      }
    }
  }

  return { avisos }
}
