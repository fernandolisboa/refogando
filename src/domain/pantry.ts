/**
 * Kernel PURO da Despensa (ADR-0038) — sem DB, sem I/O. A Despensa é UMA lista privada por Usuário de
 * NOMES de ingredientes que ele tem em casa (sem quantidade, dec.1). Aqui vive: a normalização do nome
 * (exibição + chave de dedup), o parse do campo "vários de uma vez", os básicos (dec.3), os tetos e a
 * separação do resultado em seções (dec.4). O efeito (CRUD, casamento com as Receitas em SQL, pontes pra
 * Lista de compras) mora em `@/server/pantry/pantry`.
 */
import type { Locale } from "@/i18n/locale";

/** Comprimento máximo do nome de um item, por code point (o CHECK do banco espelha: 1–60). */
export const PANTRY_NAME_MAX = 60;

/** Teto de itens por Usuário (anti-abuso barato; checado no servidor antes do INSERT). */
export const MAX_PANTRY_ITEMS = 200;

/** Teto de nomes num único "adicionar" (o campo aceita vários separados por vírgula). */
export const MAX_PANTRY_ADD_BATCH = 50;

/** Uma Receita entra no resultado com no máximo este número de Itens faltando (dec.4). */
export const PANTRY_MAX_MISSING = 3;

/** Teto de Receitas no resultado (dec.4). */
export const PANTRY_MATCH_LIMIT = 30;

/**
 * Normaliza o nome de um item para GRAVAR e EXIBIR: NFC, sem controles/bidi/invisíveis de largura zero (a
 * mesma limpeza da Anotação do Cardápio, ADR-0037), espaços colapsados, sem pontas. Vazio ou acima de
 * `PANTRY_NAME_MAX` ⇒ `'invalid'`. Um nome sem nenhuma letra/dígito ("---", "!!") também é inválido: não
 * casaria com nada e viraria chave vazia.
 */
export function parsePantryName(value: unknown): string | "invalid" {
  if (typeof value !== "string") return "invalid";
  const nome = value
    .normalize("NFC")
    .replace(/[\p{Cc}؜​‎‏‪-‮⁠⁦-⁩﻿]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (nome.length === 0 || [...nome].length > PANTRY_NAME_MAX) return "invalid";
  if (pantryMatchKey(nome).length === 0) return "invalid";
  return nome;
}

/**
 * Chave de DEDUP do item (a UNIQUE `(user_id, match_key)`): minúsculo, sem acento, pontuação/símbolo vira
 * espaço, espaços colapsados. "Ovo", "ovo" e "OVO " são o mesmo item; "pimenta-do-reino" e "pimenta do
 * reino" também. Não é o que casa com as Receitas (isso normaliza o `nome` em SQL, dec.2) — só evita
 * duplicata na lista.
 */
export function pantryMatchKey(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

/**
 * Parse do campo de adicionar: aceita VÁRIOS nomes separados por vírgula, ponto e vírgula ou quebra de
 * linha ("ovo, tomate, queijo"). Cada pedaço passa por `parsePantryName`; pedaços vazios somem (vírgula
 * sobrando não é erro), e repetidos pela chave de dedup colapsam no primeiro. Algum pedaço não-vazio
 * inválido (longo demais) ⇒ `'invalid'` — o servidor responde 400 em vez de gravar só uma parte calada.
 * Acima de `MAX_PANTRY_ADD_BATCH` nomes ⇒ `'too_many'`.
 */
export function splitPantryInput(
  value: unknown,
): string[] | "invalid" | "too_many" {
  const raw =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (raw == null) return "invalid";
  const pieces: string[] = [];
  for (const chunk of raw) {
    if (typeof chunk !== "string") return "invalid";
    for (const p of chunk.split(/[,;\n\r]+/)) {
      if (p.trim().length === 0) continue;
      pieces.push(p);
    }
  }
  if (pieces.length > MAX_PANTRY_ADD_BATCH) return "too_many";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of pieces) {
    const nome = parsePantryName(p);
    if (nome === "invalid") return "invalid";
    const key = pantryMatchKey(nome);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(nome);
  }
  return out.length === 0 ? "invalid" : out;
}

/**
 * Os BÁSICOS (dec.3): o que quase toda casa tem e quase toda Receita pede. Com "Tenho o básico" ligado,
 * entram como termos extras no casamento, mas NUNCA sozinhos justificam mostrar uma Receita (precisa de ao
 * menos um item real da Despensa). Os dois idiomas entram sempre: a Receita pode estar no outro locale.
 * Só nomes inequívocos: "pimenta" sozinha cobriria pimenta dedo-de-moça; "oil" cobriria óleo de gergelim.
 */
export const PANTRY_BASICS: readonly string[] = [
  "sal",
  "água",
  "óleo",
  "óleo vegetal",
  "azeite",
  "azeite de oliva",
  "pimenta-do-reino",
  "salt",
  "water",
  "vegetable oil",
  "olive oil",
  "black pepper",
];

/** Rótulo curto dos básicos na tela, por locale (a lista acima é o que casa; isto é o que se lê). */
export const PANTRY_BASICS_LABEL: Record<Locale, string> = {
  "pt-BR": "sal, água, óleo, azeite e pimenta-do-reino",
  "en-US": "salt, water, oil, olive oil and black pepper",
};

/** Uma Receita casada, já com o que falta (nomes no locale do viewer). */
export type PantryMatchCounts = {
  total: number;
  covered: number;
  missing: readonly string[];
};

/** Seções da tela (dec.4): nada faltando ⇒ "Dá pra fazer agora"; 1–3 ⇒ "Falta pouco". */
export function splitPantryMatches<T extends PantryMatchCounts>(
  matches: readonly T[],
): { ready: T[]; almost: T[] } {
  const ready: T[] = [];
  const almost: T[] = [];
  for (const m of matches) (m.missing.length === 0 ? ready : almost).push(m);
  return { ready, almost };
}

/**
 * O pedido do "Criar receita com o que tenho" (dec.5b): os nomes da Despensa numa frase curta, no idioma da
 * tela. Vai para `/create?q=` pelo mesmo atalho da Busca (`createFromSearchHref`, que corta ao caber).
 */
export function pantryCreatePrompt(
  names: readonly string[],
  locale: Locale,
): string {
  const list = names.join(", ");
  return locale === "en-US"
    ? `a recipe with ${list}`
    : `uma receita com ${list}`;
}
