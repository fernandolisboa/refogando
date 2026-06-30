/**
 * Helpers PUROS da migração one-off "tira a medida do `raw_text`" (ADR-0012/0009 Adendo
 * 2026-06-30, Direção B). A medida estruturada (`quantidade`/`unidade`) é a fonte ÚNICA e JÁ está
 * correta; a migração só REMOVE a medida do texto pra `raw_text` virar o NOME ("320 g de arroz
 * arbóreo" → "arroz arbóreo"). A remoção em si é uma tarefa de LINGUAGEM (um modelo barato a faz —
 * ver `scripts/strip-measure-from-raw-text.ts`), mas a DECISÃO de quais linhas tocar, a VALIDAÇÃO
 * da saída do modelo (anti-alucinação) e a VERIFICAÇÃO pós-migração são puras/determinísticas e
 * testáveis aqui. Nada de DB, nada de SDK.
 */

import { UNIT_ALIASES } from '@/domain/recipe-import-parse'

// Frases de "a gosto"/"q.b." (+ equivalentes EN) que indicam medida não-mensurável embutida no texto.
const TASTE_PHRASE_RE = /(a\s+gosto|à\s+gosto|q\.?\s?b\.?|quanto\s+baste|to\s+taste|as\s+needed)/i

// Conectores líderes ("de"/"of"…) que ligam a medida ao nome — REMOVÍVEIS, não palavras do nome.
const CONNECTORS = new Set(['de', 'do', 'da', 'dos', 'das', 'of'])
// Palavras das frases "a gosto"/"q.b." (normalizadas) — removíveis quando a unidade é a_gosto/q_b.
const TASTE_WORDS = new Set(['a', 'gosto', 'q', 'b', 'qb', 'quanto', 'baste', 'to', 'taste', 'as', 'needed'])

/** Normaliza p/ comparar palavras: minúsculas, sem acento, só alfanumérico ('Açúcar,' → 'acucar'). */
export function normalizeWord(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * `true` quando a linha NÃO tem medida estruturada a remover — então NÃO precisa do modelo: sem
 * `quantidade` E sem `unidade` não há medida pra tirar (o texto JÁ é o nome, mesmo que contenha um
 * número legítimo tipo "leite 2%"). Conservador: qualquer medida estruturada (quantidade OU unidade)
 * manda a linha pro modelo, que devolve o nome — se já estava limpo, devolve igual e o guard valida.
 */
export function looksAlreadyClean(quantidade: string | null, unidade: string | null): boolean {
  return (quantidade == null || quantidade === '') && (unidade == null || unidade === '')
}

/**
 * Heurística de VERIFICAÇÃO pós-migração: a linha AINDA aparenta ter medida embutida? Começa com
 * número/fração (medida-prefixo provável) OU é `a_gosto`/`q_b` com a frase ainda no texto (sufixo).
 * Conservadora: um nome legítimo que comece com número ("7 grãos") é falso-positivo — o script lista
 * os remanescentes pra inspeção manual, não os trata como falha automática.
 */
export function stillEmbedsMeasure(rawText: string | null, unidade: string | null): boolean {
  const t = (rawText ?? '').trim()
  if (t === '') return false
  if (/^(½|\d)/.test(t)) return true
  if ((unidade === 'a_gosto' || unidade === 'q_b') && TASTE_PHRASE_RE.test(t)) return true
  return false
}

/** Palavras (normalizadas) das formas de superfície de UMA unidade do enum — REMOVÍVEIS (são medida,
 * não nome). Fonte única: o `UNIT_ALIASES` do importador (+ o próprio slug do enum, ex.
 * colher_de_sopa → colher/de/sopa). Vazio quando `unidade` é null. */
function unitSurfaceWords(unidade: string | null): Set<string> {
  const out = new Set<string>()
  if (unidade == null) return out
  for (const part of unidade.split('_')) {
    const n = normalizeWord(part)
    if (n !== '') out.add(n)
  }
  for (const [surface, u] of Object.entries(UNIT_ALIASES)) {
    if (u !== unidade) continue
    for (const word of surface.split(/\s+/)) {
      const n = normalizeWord(word)
      if (n !== '') out.add(n)
    }
  }
  return out
}

/** Um token do original é parte da MEDIDA (removível) — número, conector, palavra-de-unidade, ou
 * (em a_gosto/q_b) palavra da frase "a gosto"? Senão é palavra do NOME, que TEM de sobreviver. */
function isMeasureWord(token: string, unidade: string | null): boolean {
  const n = normalizeWord(token)
  if (n === '') return true // pontuação/fração solta (½) — removível
  if (/^\d+$/.test(n)) return true // número (incl. "1/2"→"12")
  if (CONNECTORS.has(n)) return true
  if (unitSurfaceWords(unidade).has(n)) return true
  if ((unidade === 'a_gosto' || unidade === 'q_b') && TASTE_WORDS.has(n)) return true
  return false
}

export type StripValidation = { ok: true } | { ok: false; reason: string }

/**
 * GUARD anti-alucinação da saída do modelo: o `nome` proposto tem de ser uma REDUÇÃO do original que
 * só TIRA a MEDIDA — não inventa, não traduz, não reescreve, e (crucial) NÃO DROPA palavra do nome.
 * Cruza com a `unidade` conhecida pra separar palavra-de-medida de palavra-de-nome. Rejeita se:
 *  - vazio (após trim);
 *  - mais COMPRIDO que o original (strip só encurta);
 *  - introduz um TOKEN novo (palavra ausente no original, ignorando acento/caixa) — pega tradução/rephrase;
 *  - introduz um DÍGITO ausente no original (a medida SAI, não entra);
 *  - SUME com uma palavra do NOME (token do original que NÃO é medida e não aparece no candidato) —
 *    pega a omissão, a classe de alucinação mais natural de um "tira o texto" ("queijo parmesão ralado"
 *    → "parmesão" é REJEITADO).
 * Linha rejeitada mantém o `raw_text` original e é SINALIZADA pro dono revisar à mão (nunca corrompe).
 */
export function validateStrippedName(
  original: string,
  candidate: string,
  unidade: string | null,
): StripValidation {
  const orig = original.trim()
  const cand = candidate.trim()
  if (cand === '') return { ok: false, reason: 'nome vazio' }
  if (cand.length > orig.length) return { ok: false, reason: 'nome mais comprido que o original' }

  const candTokens = cand.split(/\s+/).map(normalizeWord).filter((w) => w !== '')
  const candSet = new Set(candTokens)

  const origTokens = new Set(orig.split(/\s+/).map(normalizeWord).filter((w) => w !== ''))
  for (const n of candTokens) {
    if (!origTokens.has(n)) return { ok: false, reason: `token novo "${n}" (não estava no original)` }
  }

  // Toda palavra do NOME (token do original que não é medida) TEM de sobreviver — pega a omissão.
  for (const w of orig.split(/\s+/)) {
    if (isMeasureWord(w, unidade)) continue
    const n = normalizeWord(w)
    if (n !== '' && !candSet.has(n)) {
      return { ok: false, reason: `palavra do nome sumiu "${w}"` }
    }
  }

  const origDigits = new Set(orig.match(/\d/g) ?? [])
  for (const d of cand.match(/\d/g) ?? []) {
    if (!origDigits.has(d)) return { ok: false, reason: `dígito novo "${d}"` }
  }
  return { ok: true }
}

/** Tira UM conector líder ("de"/"of"…) do candidato — limpa um resíduo tipo "de farinha" → "farinha".
 * Só o PRIMEIRO token, e só se for conector; preserva "queijo de Minas" (conector no meio fica). */
export function stripLeadingConnector(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length > 1 && CONNECTORS.has(normalizeWord(words[0]))) return words.slice(1).join(' ')
  return name.trim()
}

/** System prompt (fixo) do modelo barato que tira a medida do nome. */
export const STRIP_SYSTEM_PROMPT = [
  'Você normaliza nomes de ingredientes de receitas.',
  'Recebe a LINHA de um ingrediente e a sua medida estruturada (quantidade + unidade) JÁ correta.',
  'Sua tarefa: devolver SOMENTE o NOME do ingrediente, SEM a quantidade e SEM a unidade.',
  'Regras estritas: não traduza, não invente, não reescreva — preserve as palavras do nome verbatim, na mesma língua.',
  'Tire também conectores soltos que ligavam a medida ao nome ("de"/"of") no começo.',
  'Se a linha já for só o nome (sem medida), devolva-a igual.',
  'Exemplos: "320 g de arroz arbóreo" → "arroz arbóreo"; "2 xícaras de farinha" → "farinha"; "sal a gosto" → "sal"; "3 ovos" → "ovos".',
].join('\n')

/** PURO: monta o user prompt pra UMA linha. Estável/testável byte-a-byte. */
export function buildStripUserPrompt(
  rawText: string,
  quantidade: string | null,
  unidade: string | null,
): string {
  const medida = [quantidade, unidade].filter((x) => x != null && x !== '').join(' ')
  return [
    `Linha: ${rawText}`,
    medida !== ''
      ? `Medida estruturada (já correta — NÃO a repita no nome): ${medida}`
      : 'Medida estruturada: (nenhuma)',
    'Devolva só o nome do ingrediente, sem a medida.',
  ].join('\n')
}
