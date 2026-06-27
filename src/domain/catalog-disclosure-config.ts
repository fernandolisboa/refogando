/**
 * Config do AVISO de catálogo AI-assistido (#237, épico SEO #187; ADR-0002/0016/0017 sobre selos).
 * PURO: tipos + defaults + validação + a DECISÃO "mostra o aviso?". Espelha a forma dos demais
 * configs admin (`web-search-config`/`image-gen-config`/`recipe-gen-config`): um punhado de campos
 * no singleton `app_config`, fonte ÚNICA compartilhada pela leitura (server) e pelo PUT do admin.
 *
 * O aviso é uma CORTESIA EDITORIAL — uma frase opcional, ligável/desligável e com texto editável,
 * dizendo que uma receita de CATÁLOGO pode ter sido produzida "em colaboração entre curadoria e IA".
 * NÃO é um selo obrigatório de proveniência: ele renderiza SÓ em receitas `origin=catalog` quando
 * LIGADO, e NUNCA suprime/oculta/substitui os selos OBRIGATÓRIOS (`origin=ai_*` ⇒ selo de
 * proveniência da Busca; imagem `ai_generated` ⇒ selo "✨ gerada por IA"). Esses selos vivem em
 * caminhos SEPARADOS (`ProvenanceBadge`, `view.imageAiGenerated`) — este config não os toca.
 *
 * Forma `catalogDisclosure { enabled, text }`:
 *  - `enabled`: liga/desliga o aviso (desligado ⇒ NUNCA renderiza, mesmo em catálogo).
 *  - `text`: a frase exibida (editável pelo admin). Default seguro em pt-BR; nunca vazio na persistência.
 */

/** Config do aviso de catálogo AI-assistido (singleton `app_config`). */
export type CatalogDisclosureConfig = {
  enabled: boolean
  /** Frase do aviso (editável). Nunca vazia na persistência — o parse rejeita string vazia/só-espaço. */
  text: string
}

/**
 * Texto default do aviso (pt-BR). Frase editorial, NÃO um disclaimer legal: posiciona o Catálogo como
 * curadoria humana ASSISTIDA por IA, sem afirmar que toda receita foi gerada por IA (o selo obrigatório
 * de `origin=ai_*` é quem afirma isso, caso a caso). O admin pode reescrever; este é só o ponto de
 * partida seguro quando ninguém ainda editou.
 */
export const DEFAULT_CATALOG_DISCLOSURE_TEXT =
  'Algumas receitas do nosso catálogo são produzidas em colaboração entre a nossa curadoria e a IA.'

/**
 * Teto de tamanho do texto (defesa contra texto gigante / abuso no jsonb-ish da linha singleton).
 * Cobre uma frase editorial real com folga; bem abaixo de qualquer limite de coluna text.
 */
const MAX_TEXT_LENGTH = 500

/**
 * Default: aviso DESLIGADO + texto padrão. Fail-safe por construção — o aviso é cortesia OPT-IN: só
 * aparece quando o admin o liga DELIBERADAMENTE. Antes disso o Catálogo renderiza exatamente como hoje
 * (sem a frase). Reversível pela `/admin/catalog`. O texto vem preenchido para o admin editar a partir dele.
 */
export const DEFAULT_CATALOG_DISCLOSURE_CONFIG: CatalogDisclosureConfig = {
  enabled: false,
  text: DEFAULT_CATALOG_DISCLOSURE_TEXT,
}

export type CatalogDisclosureConfigParse =
  | { ok: true; value: CatalogDisclosureConfig }
  | { ok: false }

/**
 * Valida o objeto `catalogDisclosure` cru do PUT (substituição COMPLETA — a UI sempre envia os 2
 * campos). `enabled` boolean; `text` string NÃO-vazia após trim e dentro do teto. O texto é
 * TRIMADO na persistência (sem espaço-fantasma nas pontas). Qualquer desvio ⇒ `{ ok: false }`
 * (o route mapeia a 400). PURO: sem DB/I/O.
 */
export function parseCatalogDisclosureConfig(raw: unknown): CatalogDisclosureConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as { enabled?: unknown; text?: unknown }
  if (typeof obj.enabled !== 'boolean') return { ok: false }
  if (typeof obj.text !== 'string') return { ok: false }
  const text = obj.text.trim()
  if (text === '' || text.length > MAX_TEXT_LENGTH) return { ok: false }
  return { ok: true, value: { enabled: obj.enabled, text } }
}

/**
 * DECISÃO PURA "mostra o aviso de catálogo?" — fonte ÚNICA reusada pela página de detalhe (caminho
 * público E caminho do dono). `true` SÓ quando a receita é de CATÁLOGO (`origin === 'catalog'`) E o
 * aviso está LIGADO. Qualquer outra origem (`ai_*`/`user_edited`/`web_imported`) ⇒ `false`: o aviso é
 * editorial e específico do Catálogo, NÃO um substituto dos selos obrigatórios de proveniência.
 *
 * INEGOCIÁVEL: esta decisão governa SÓ a frase de cortesia. Ela é estruturalmente incapaz de tocar os
 * selos obrigatórios — não recebe nem retorna nada sobre `ai_*`/`ai_generated`; esses selos são
 * decididos em outro lugar (`classifySection`/`ProvenanceBadge`, `view.imageAiGenerated`) e seguem
 * inalterados com o aviso ligado OU desligado.
 */
export function shouldShowCatalogDisclosure(input: {
  origin: string
  enabled: boolean
}): boolean {
  return input.enabled && input.origin === 'catalog'
}
