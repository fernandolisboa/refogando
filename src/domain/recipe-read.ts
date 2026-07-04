/**
 * Leitura localizada da Receita — módulo PURO de resolução (issue #3, §4).
 *
 * Sem DB e sem I/O: recebe linhas já carregadas (Recipe + traduções + itens) e
 * resolve a VISTA que a rota serializa. O original é a fonte primária; a tradução
 * é assistiva. As decisões inegociáveis vivem aqui:
 *
 *  - `resolveName`: o original SEMPRE primário. Só anexa `(tradução)` quando há
 *    tradução do locale pedido, ela é CONFIÁVEL (`isTranslationReliable`) e o
 *    `titulo` DIFERE do original. Em qualquer outro caso → original NU (sem
 *    parênteses, sem vazar texto não revisado).
 *  - `resolveBody`: por campo, valor do locale pedido se presente/não-vazio; senão
 *    cai no texto do `originalLocale`; senão `null`. Nunca string vazia.
 *  - `resolveFacets`: cozinha/categoria/tags sempre; `restricoes` SÓ quando há ≥ 1
 *    (array vazio ⇒ chave AUSENTE — distingue "sem restrição" de "presente").
 *  - `resolveRecipeView`: selo `origin` + `schemaVersion` + invariantes
 *    (porcoes/dificuldade/ingredientes) IDÊNTICOS qualquer que seja o `requestLocale`.
 *  - `avisos` (#7, ADR-0004): a vista anexa `avisos?` SÓ quando há ≥ 1 contradição
 *    óbvia entre o dado oportunista de alérgeno e uma restrição declarada (mesma regra
 *    "ausente ≠ vazio" das facetas/`restricoes`). O motor PURO `decideRestrictionNotices`
 *    decide os CÓDIGOS (locale-neutros); a vista mapeia cada código → `AvisoView`,
 *    repassando os códigos 1:1 e adicionando a frase `mensagem` já renderizada no
 *    `requestLocale`. NUNCA bloqueia/suprime/gateia nada (Aviso é leitura, não verificação).
 */

import {
  isTranslationReliable,
  type LineageKind,
  type Origin,
  type ResultKind,
  type TranslationProvenance,
  type Visibility,
} from '@/domain/recipe'
import type { DerivedDiff } from '@/domain/recipe-diff'
import {
  decideRestrictionNotices,
  type RestrictionNotice,
} from '@/domain/recipe-restrictions'
import { isRestricao, type Restricao } from '@/domain/vocabulary'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Autoria exibível (#129, CONTEXT.md: _Owner / Autoria_) — o crédito "por <name>" linkando o
 * perfil público `/u/<handle>`. Presente SÓ quando a Receita tem dono humano (`owner_id`
 * não-NULL); Catálogo/sistema NÃO carrega autor (o badge de proveniência já distingue a origem).
 * Distinta do Owner: aqui só o `name` + `handle` PÚBLICOS, NUNCA o `id`/`owner_id` interno.
 * Definida aqui (módulo fundamental) e RE-EXPORTADA por `recipe-search-read` (evita ciclo).
 */
export type RecipeAuthor = {
  name: string
  handle: string
}

/**
 * Atribuição à FONTE de uma receita importada da web (#169, ADR-0019) — o crédito "fonte: …" que
 * SUBSTITUI o byline de autoria humana ("por <name>") nas Receitas `web_imported`. `url` é o link de
 * origem (sempre presente quando há atribuição); `name` é o nome legível do site/publisher
 * (`source_name`), AUSENTE quando o import não capturou um — a UI cai no host derivado da `url`.
 * Distinta de `RecipeAuthor`: a importada é creditada à fonte EXTERNA, NUNCA ao Usuário que importou
 * (ADR-0019: "A Autoria é creditada à fonte externa, nunca por <Usuário>").
 */
export type RecipeSource = {
  url: string
  name?: string
}

/** Linha de Receita conforme retorna de `db.select().from(recipe)`. */
export type RecipeRow = {
  id: string
  origin: Origin
  visibility: Visibility
  resultKind: ResultKind
  originalLocale: string
  cozinha: string | null
  categoria: string | null
  restricoes: string[]
  porcoes: number | null
  dificuldade: number | null
  // Tempo de preparo (#261, ADR-0023): OPCIONAIS no tipo (mesma razão do ownerId abaixo — o
  // select().from(recipe) os traz em runtime; opcional poupa as fixtures puras de mudar).
  tempoAtivoMin?: number | null
  tempoTotalMin?: number | null
  schemaVersion: number
  /**
   * Dono da Receita (#59) — `null` para catálogo/sistema (ADR-0011). OPCIONAL no tipo:
   * `loadRecipeRows` faz `select().from(recipe)` (SELECT *) e JÁ o traz em runtime; deixá-lo
   * opcional poupa as fixtures puras (`recipeRow()` em testes) de mudar. Insumo de
   * `canManage` — NUNCA sai na vista; compara-se contra `viewerId` (decisão de ownership da
   * camada de servidor, que conhece a sessão).
   */
  ownerId?: string | null
  /**
   * Linhagem da DERIVADA (#17) — OPCIONAIS no tipo (mesma razão do `ownerId` acima: o
   * `select().from(recipe)` os traz em runtime; deixá-los opcionais poupa as fixtures puras).
   * `ausente ≠ vazio`: `derivedDiff` ausente/`null` ⇒ a receita NÃO é uma derivada (catálogo/
   * geração nascem `null`). Só linhas `lineageKind='edited'` carregam o diff congelado
   * (invariante de rota — `derive.ts`). `derivedDiff` é insumo da projeção OWNER-GATED (espelha
   * `canManage`): só o dono da derivada vê o próprio diff. `parentRecipeId` pode virar `null`
   * quando a base é apagada (FK ON DELETE set null) — o diff ARMAZENADO sobrevive.
   */
  parentRecipeId?: string | null
  lineageKind?: LineageKind | null
  derivedDiff?: DerivedDiff | null
  /**
   * Imagem da receita (#130/#131) — FK para `recipe_image`. OPCIONAL no tipo (mesma razão de
   * `ownerId`: `select().from(recipe)` o traz em runtime; opcional poupa as fixtures puras). É
   * insumo do CARRY-FORWARD (#131): a versão nova herda este `image_id`. NUNCA sai na vista (a
   * vista expõe só `imageUrl` resolvido); aqui é o id interno usado pela camada de servidor.
   */
  imageId?: string | null
  /**
   * Linhagem da galeria (#222, ADR-0022 dec.1) — chave OPACA `lineage_id`. OPCIONAL no tipo (mesma
   * razão de `ownerId`: `select().from(recipe)` JÁ a traz em runtime; opcional poupa as fixtures
   * puras de a setar). NUNCA sai na vista pública; é a chave que o servidor usa para montar a Galeria
   * (`recipe_image WHERE lineage_id = X`) e carimbar imagens novas. A coluna é NOT NULL no banco.
   */
  lineageId?: string
  /**
   * Atribuição da importação da web (#165/#169, ADR-0019) — `source_url`/`source_name` da Receita.
   * SÓ Receitas `origin=web_imported` os carregam (toda outra os deixa NULL). OPCIONAIS no tipo
   * (mesma razão de `ownerId`: o `select().from(recipe)` os traz em runtime; opcional poupa as
   * fixtures puras). Insumo do crédito "fonte: …" (`RecipeSource`) que SUBSTITUI o byline humano.
   */
  sourceUrl?: string | null
  sourceName?: string | null
  /**
   * Data de criação da Receita (#234, ADR-0020 dec.7) — vira `datePublished` no JSON-LD. OPCIONAL no
   * tipo (mesma razão de `ownerId`: `select().from(recipe)` JÁ a traz em runtime; opcional poupa as
   * fixtures puras de a setar). NUNCA sai na vista pública direta; é insumo só do markup de SEO.
   */
  createdAt?: Date
}

/** Linha de tradução conforme `db.select().from(recipeTranslation)`. */
export type TranslationRow = {
  locale: string
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  provenance: TranslationProvenance
  stale: boolean
  /**
   * Nome de ingrediente por-locale (#426, ADR-0030) — por `ordem`, o `nome` traduzido + o `nomeOrigem`
   * (o `raw_text` da origem no momento da tradução). O display só usa o `nome` quando `nomeOrigem`
   * ainda casa com o `raw_text` ATUAL (senão o item foi renomeado/reordenado ⇒ cai no `raw_text`).
   * `null`/ausente = sem tradução. Insumo de `resolveRecipeView` p/ `ingredients[].rawText` — NUNCA sai
   * cru na vista. OPCIONAL no tipo (fixtures puras não precisam setá-lo; o `select().from` o traz).
   */
  ingredientes?: { ordem: number; nome: string; nomeOrigem: string }[] | null
}

/**
 * Item de ingrediente conforme o LOADER projeta (entrada de `resolveRecipeView`) —
 * parte das INVARIANTES (não traduzido na #3). `quantidade` é `numeric(10,3)` e VOLTA
 * COMO STRING do driver: mantém-se string (ex. `'2.500'`), nunca número.
 *
 * `alergenos` (#7) é REQUERIDO: o loader SEMPRE o projeta via LEFT JOIN na tabela PAI
 * `ingredient` (`null` quando a FK é nula/sem dado, ou um `string[]`). É dado de
 * decisão do motor de Aviso — NUNCA sai na vista (ver `IngredientView`, que o omite).
 */
export type IngredientItem = {
  ordem: number
  quantidade: string | null
  unidade: string | null
  rawText: string | null
  alergenos: string[] | null
}

/**
 * Item de ingrediente como sai na VISTA serializada: `IngredientItem` SEM `alergenos`.
 * O dado de alérgeno é insumo do motor de Aviso (decisão), não conteúdo da vista —
 * o `Omit` garante em compile-time que ele NUNCA vaza em `view.ingredients`.
 */
export type IngredientView = Omit<IngredientItem, 'alergenos'>

export type ResolveInput = {
  recipe: RecipeRow
  translations: ReadonlyArray<TranslationRow>
  ingredients: ReadonlyArray<IngredientItem>
  tags: ReadonlyArray<string>
  requestLocale: string
  /**
   * Id do requester (#59) — OPCIONAL; ausente = leitor anônimo (leitura pública/catálogo).
   * Só habilita os campos de gestão (`canManage`/`visibility`/`resultKind`) quando casa com
   * `recipe.ownerId`. NUNCA altera nome/corpo/facetas/avisos — leitura é idêntica p/ todos.
   */
  viewerId?: string
  /**
   * Estado social (#16/#362) — campo ADITIVO opcional que o SERVER (que conhece sessão+pool)
   * calcula e passa. `resolveRecipeView` apenas PROJETA (não decide gate/pool):
   *  - `viewerSaved`: estado do PRÓPRIO viewer. O server só o carrega quando há `viewerId`.
   *    A projeção é gateada por `viewerId != null` (viewer-self, distinto de canManage que é
   *    owner-only): anônimo ⇒ ausente.
   */
  viewerSaved?: boolean
  /**
   * Autoria (#129) — `name` + `handle` PÚBLICOS do dono, que o server carrega via JOIN em `users`
   * sobre `recipe.owner_id`. Insumo do crédito "por <name>" linkando `/u/<handle>` no detalhe.
   * `undefined` (Catálogo/sistema sem dono humano, OU o server não pediu) ⇒ a vista OMITE
   * `author` (sem byline; o badge de proveniência já marca a origem). DISTINTO de `viewerId`/
   * `ownerId` (gestão, owner-gated): a Autoria é PÚBLICA — visível a qualquer leitor.
   */
  author?: { name: string | null; handle: string | null }
  /**
   * Imagem da receita (#130, ADR-0016) — `blob_url` PÚBLICO da foto do prato (o server o carrega de
   * `recipe_image` via `recipe.image_id`). `undefined` (Receita sem imagem) ⇒ a vista OMITE
   * `imageUrl` ("ausente ≠ vazio"). PÚBLICO — visível a qualquer leitor que vê a Receita (NÃO
   * owner-gated). NUNCA carrega o `image_id` interno.
   */
  imageUrl?: string
  /** Imagem gerada por IA (#132)? Dirige o selo "✨ gerada por IA". AUSENTE quando não/foto. */
  imageAiGenerated?: boolean
  /**
   * Imagem MODERADA pelo Curador (#133, ADR-0016)? Quando `true` E o requester NÃO é o dono
   * (`!canManage`), a vista ESCONDE `imageUrl` E `imageAiGenerated` — a imagem some do público em
   * toda parte (espelha o gate de pool do feed/busca). O Owner (`canManage`) CONTINUA vendo a
   * própria imagem moderada no privado (ADR-0016: a moderação esconde do público, não apaga). Eixo
   * ORTOGONAL à moderação da Receita (#18) — a Receita segue legível/no pool; só a foto some.
   * AUSENTE/`false` (caso normal: sem imagem ou imagem não moderada) ⇒ a imagem aparece p/ todos.
   */
  imageModerated?: boolean
  /**
   * Geração de imagem por IA LIGADA? (#134) — a config admin-controlada (`app_config.image_gen_enabled`)
   * que o detalhe GET carrega SÓ quando o requester é o dono (a ação de gerar é OWNER-ONLY). Projetado
   * apenas sob `canManage` (junto dos demais campos de gestão) ⇒ a UI esconde o botão "Gerar por IA"
   * quando desligado. O servidor reimpõe o gate (403) — isto é só a afordância de esconder. AUSENTE
   * quando não-dono OU o server não pediu (outras rotas que montam a view do dono não o carregam).
   */
  imageGenEnabled?: boolean
  /**
   * Geração-por-IA BLOQUEADA p/ este usuário? (#226, ADR-0022 dec.3 / 1º gancho do ADR-0007) —
   * OWNER-GATED como `imageGenEnabled`. O server o carrega SÓ quando o requester é o dono (a flag é
   * por-USUÁRIO em `users`, e a ação de gerar é owner-only). Projetado apenas sob `canManage` ⇒ a UI
   * do dono esconde "Gerar com IA" + mostra uma nota clara quando o Curador o bloqueou. AUSENTE para
   * não-dono OU quando o server não pediu. DISTINTO de `imageGenEnabled` (config-global do admin):
   * este é a restrição por-conta do Curador. O servidor reimpõe o gate (403 geracao_bloqueada).
   */
  imageGenBlocked?: boolean
  /**
   * Galeria de imagens da LINHAGEM (#222, ADR-0022 dec.1/5) — OWNER-GATED. O server a carrega SÓ
   * quando o requester é o dono (mirror de `imageGenEnabled`, NUNCA dentro de `loadRecipeRows`, que
   * o caminho público-por-slug reusa). Projetada apenas sob `canManage` — o caminho público/by-slug
   * NUNCA tem este campo. `undefined` (não-dono OU o server não pediu) ⇒ a vista OMITE `gallery`.
   */
  gallery?: ReadonlyArray<GalleryImage>
}

/**
 * Item da Galeria de imagens (#222, ADR-0022 dec.1) — uma imagem da LINHAGEM da Receita, como sai na
 * vista OWNER-GATED. `selected = (id === recipe.image_id)` (a face pública atual). NUNCA expõe o
 * blob interno além da `url` servível. Distinto do `imageUrl` público (a face): a galeria é o
 * HISTÓRICO re-selecionável, visível SÓ ao dono (`canManage`); a galeria em si nunca é pública.
 */
export type GalleryImage = {
  id: string
  url: string
  /** `true` quando `provenance = 'ai_generated'` — dirige o selo "✨ gerada por IA" no thumbnail. */
  aiGenerated: boolean
  /** `true` para a imagem que é a face pública atual (`recipe.image_id`). */
  selected: boolean
  /**
   * `true` quando o Curador MODEROU esta imagem (`recipe_image.moderated_at` ≠ null). A flag por-imagem
   * e suas semânticas (esconder a foto do público, ORTOGONAL à Visibilidade) são do #133/ADR-0016; a
   * INTERAÇÃO galeria×moderação é o #225/ADR-0022: o dono ainda a vê na galeria, marcada "removida", e
   * ela NÃO pode virar a face pública (selecioná-la é bloqueado no seam, 409). Se for a face atual numa
   * Receita pública, o gate público do #133 (resolveRecipeView) já a esconde do público (placeholder).
   * Owner-gated como a galeria toda — nunca vaza no caminho público.
   */
  moderated: boolean
  /**
   * #285 (ADR-0022 atualização): id da **imagem-base** quando esta é uma VARIANTE editada a partir de
   * outra (image-to-image). `null` = gerada do zero / upload. Dirige o selo "✨ Editada com IA" (vs
   * "✨ Gerada por IA") no estúdio do Owner. Owner-gated como a galeria toda.
   */
  editedFromId: string | null
}

/** Facetas: `restricoes` é opcional — ausente quando o array vier vazio. */
export type RecipeFacets = {
  cozinha: string | null
  categoria: string | null
  tags: ReadonlyArray<string>
  restricoes?: ReadonlyArray<string>
}

export type RecipeBody = {
  descricao: string | null
  passos: string[] | null
  notas: string | null
}

export type TranslationFlags = {
  locale: string
  provenance: TranslationProvenance
  reliable: boolean
  stale: boolean
}

/**
 * Aviso de contradição como sai na VISTA (#7): os CÓDIGOS do domínio
 * (`kind`/`restricao`/`alergeno`, repassados 1:1 do `RestrictionNotice`) MAIS a frase
 * `mensagem` já renderizada no `requestLocale`. DISTINTO do `RestrictionNotice` (que é
 * só códigos, locale-neutro): a vista é quem adiciona o texto localizado. Expor os
 * códigos permite a UI estilizar/agrupar sem re-parsear a `mensagem`.
 */
export type AvisoView = {
  kind: 'contradicao'
  restricao: Restricao
  alergeno: string
  mensagem: string
}

/**
 * Aviso de tradução obsoleta como sai na VISTA (#23, AC3): a tradução do `requestLocale`
 * está marcada `stale` (o original mudou depois da tradução). Traz a `mensagem` leve já
 * renderizada no requestLocale + o rótulo "ver o original" + os locales. A UI lincа o
 * "ver o original" pro GET com `?locale=originalLocale` (NÃO embutimos o corpo original).
 * AUSENTE quando se vê a origem (`requestLocale === originalLocale`) — a origem nunca é
 * sinalizada (alinha com `resolveName` Branch 1).
 */
export type StaleNotice = {
  locale: string
  originalLocale: string
  mensagem: string
  verOriginalLabel: string
}

export type RecipeView = {
  id: string
  name: string
  origin: Origin
  schemaVersion: number
  body: RecipeBody
  facets: RecipeFacets
  porcoes: number | null
  dificuldade: number | null
  // Tempo de preparo (#261, ADR-0023): facetas invariantes, OPCIONAIS no tipo (poupa as fixtures de
  // view nos testes; o detalhe condiciona em `!= null`). ativo-sozinho é impossível (CHECK do DB).
  tempoAtivoMin?: number | null
  tempoTotalMin?: number | null
  ingredients: ReadonlyArray<IngredientView>
  translations: ReadonlyArray<TranslationFlags>
  /**
   * Selo "tradução automática" (#161) — `true` quando a leitura localizada repousa numa
   * tradução AUTOMÁTICA NÃO-REVISADA (`automatica_nao_revisada`, i.e. NÃO confiável). Rastreia a
   * proveniência da linha-BASE do nome PRIMÁRIO (não o parêntese assistivo): a tradução do
   * `originalLocale` quando existe; senão a do `requestLocale`; ambos ausentes ⇒ `true` (tratado
   * como não-confiável, "nunca afirma revisado sem prova"). Espelha BYTE-A-BYTE o
   * `autoTranslationSignal` da Busca/Feed (`recipe-search-read.displayedProvenance` +
   * `isTranslationReliable`) — a mesma regra de proveniência, sem re-derivar no componente PURO.
   * SEMPRE presente (booleano de display derivado), distinto dos campos "ausente ≠ vazio".
   */
  autoTranslationSignal: boolean
  /** Avisos de contradição — AUSENTE quando vazio (ausente ≠ "verificado OK"). */
  avisos?: AvisoView[]
  /** Aviso de tradução obsoleta — AUSENTE salvo quando a tradução pedida é stale e ≠ origem. */
  staleNotice?: StaleNotice
  /**
   * Autoria (#129) — `{ name, handle }` PÚBLICOS do dono, p/ o crédito "por <name>" linkando
   * `/u/<handle>`. AUSENTE ("ausente ≠ vazio") quando a Receita não tem dono humano (Catálogo/
   * sistema) OU o server não carregou o autor. PÚBLICO (qualquer leitor vê) — NÃO owner-gated
   * como `canManage`/`visibility`. Nunca expõe o `owner_id` interno.
   */
  author?: RecipeAuthor
  /**
   * Atribuição à FONTE (#169, ADR-0019) — `{ url, name? }` da receita importada da web. Presente SÓ
   * para `web_imported` COM `sourceUrl`; SUBSTITUI o byline `author` (o detalhe mostra "fonte: …" no
   * lugar de "por <name>"). PÚBLICO (qualquer leitor que vê a Receita). "ausente ≠ vazio": a chave só
   * existe quando há atribuição. Mutuamente exclusiva com `author` na prática (importada não tem
   * autor humano creditável).
   */
  source?: RecipeSource
  /**
   * Imagem da receita (#130, ADR-0016) — `blob_url` PÚBLICO da foto do prato. AUSENTE
   * ("ausente ≠ vazio") quando a Receita não tem imagem (caso normal). PÚBLICO (qualquer leitor que
   * vê a Receita vê a foto) — NÃO owner-gated como `canManage`. Nunca expõe o `image_id` interno.
   */
  imageUrl?: string
  /**
   * Imagem gerada por IA (#132, ADR-0017)? `true` quando a foto é `ai_generated` — dirige o selo
   * PÚBLICO "✨ gerada por IA" (honestidade). AUSENTE ("ausente ≠ vazio") quando não há imagem ou é
   * foto do usuário. PÚBLICO (qualquer leitor vê o selo).
   */
  imageAiGenerated?: boolean
  /**
   * Campos de GESTÃO (#59) — a mesma regra "ausente ≠ vazio" das facetas/avisos. Os TRÊS
   * saem JUNTOS e SÓ quando o requester é o dono (`viewerId === recipe.ownerId`); para
   * leitor anônimo / não-dono / catálogo ficam AUSENTES (zero vazamento — o contrato de
   * leitura pública fica IDÊNTICO ao atual: nem `visibility` nem `resultKind` vazam).
   * A UI renderiza os controles de Visibilidade SÓ sob `canManage`.
   */
  canManage?: boolean
  /** Visibilidade atual — presente SÓ quando `canManage` (dono). */
  visibility?: Visibility
  /** Desfecho da geração — presente SÓ quando `canManage` (gateia o caso playful no toggle). */
  resultKind?: ResultKind
  /**
   * Geração de imagem por IA LIGADA? (#134) — OWNER-GATED (presente SÓ quando `canManage` E o server
   * carregou a config). A UI do dono esconde o botão "Gerar por IA" quando `false`. AUSENTE para
   * não-dono / quando o server não carregou (mesma regra "ausente ≠ vazio").
   */
  imageGenEnabled?: boolean
  /**
   * Geração-por-IA BLOQUEADA p/ este usuário? (#226, ADR-0022 dec.3) — OWNER-GATED (presente SÓ sob
   * `canManage` E quando o server carregou o flag). A UI do dono esconde "Gerar com IA" + mostra uma
   * nota clara quando `true`. AUSENTE para não-dono / quando o server não pediu ("ausente ≠ vazio").
   * Restrição por-CONTA do Curador (#226), distinta de `imageGenEnabled` (config-global do admin).
   */
  imageGenBlocked?: boolean
  /**
   * Galeria de imagens da LINHAGEM (#222, ADR-0022 dec.1) — OWNER-GATED (sai SÓ sob `canManage` E
   * quando o server a carregou). A UI do dono lista os thumbnails (selecionar/apagar). AUSENTE para
   * não-dono / caminho público (nunca vaza — a galeria em si nunca é pública). "ausente ≠ vazio".
   */
  gallery?: ReadonlyArray<GalleryImage>
  /**
   * Diff DERIVADO congelado (#17) — a forma versionada que o fork ARMAZENOU em
   * `recipe.derived_diff`, REPASSADA 1:1 (NUNCA recomputada na leitura — história 289: a base
   * pode ter sido apagada, anulando `parentRecipeId`). OWNER-GATED como os campos de gestão:
   * presente SÓ quando o requester é o dono da derivada (`canManage`) E a linha de fato carrega
   * um diff (`derivedDiff != null`, i.e. é uma `lineageKind='edited'`). AUSENTE para anônimo /
   * não-dono / catálogo / receitas não-derivadas (mesma regra "ausente ≠ vazio").
   */
  derivedDiff?: DerivedDiff
  /**
   * Vínculo com a base PERDIDO (#21, história #289) — `true` SÓ quando esta é uma derivada
   * (`lineageKind='edited'` ⇒ `derivedDiff != null`) cuja base foi APAGADA (hard-delete da #21
   * ⇒ FK `parent_recipe_id` virou NULL por ON DELETE set null). Sinaliza que o conteúdo
   * CONTINUA completo (o diff congelado sobrevive — nunca recomputado), só o ponteiro pra
   * original sumiu — para o dono "não estranhar a ausência do diff". OWNER-GATED como
   * `derivedDiff` (sai junto com ele, sob `canManage`). DERIVADO de colunas já carregadas
   * (parentRecipeId + derivedDiff) — NENHUMA query nova. AUSENTE ("ausente ≠ vazio") quando a
   * base existe, quando não é derivada, ou para não-dono.
   */
  vinculoPerdido?: boolean
  /**
   * Estado do PRÓPRIO viewer (#16/#362) — `viewerSaved`. Presente SÓ quando há `viewerId`
   * (ator autenticado vê SÓ o próprio estado); AUSENTE para anônimo. NÃO gateado por ownership
   * (viewer-self, distinto de canManage owner-only): um usuário logado vê seu próprio save mesmo
   * na Receita de outro / no Catálogo.
   */
  viewerSaved?: boolean
}

/** Acha a tradução do locale pedido (ou `undefined`). */
function findTranslation(
  translations: ReadonlyArray<TranslationRow>,
  locale: string,
): TranslationRow | undefined {
  return translations.find((t) => t.locale === locale)
}

/** Trata `null`/`undefined`/string vazia como ausente. */
function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Nome de ingrediente por-locale (#426, ADR-0030 dec.5): `Map<ordem, {nome, nomeOrigem}>` a partir da
 * tradução do requestLocale. O CONSUMIDOR valida `nomeOrigem === raw_text atual` antes de usar o `nome`
 * traduzido — assim uma edição só-de-medida MANTÉM a tradução (o nome-fonte bate) e um rename/reorder
 * cai no `raw_text` (nome novo, correto), nunca um nome traduzido ERRADO ao lado da medida. Isso também
 * neutraliza a corrida read-não-transacional e o `ordem` duplicado (mismatch ⇒ fallback). Espelha
 * `resolveBody` (usa o valor do requestLocale se presente, SEM gate de confiabilidade). O locale ORIGINAL
 * nunca carrega `ingredientes` (só o target) ⇒ cai no `raw_text`.
 */
export function resolveIngredientNames(input: {
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): Map<number, { nome: string; nomeOrigem: string }> {
  const requested = findTranslation(input.translations, input.requestLocale)
  const map = new Map<number, { nome: string; nomeOrigem: string }>()
  for (const it of requested?.ingredientes ?? []) {
    map.set(it.ordem, { nome: it.nome, nomeOrigem: it.nomeOrigem })
  }
  return map
}

/**
 * Nome resolvido: original primário. Só `Original (Tradução)` quando a tradução do
 * locale pedido existe, é confiável e DIFERE do original. Caso contrário, original nu.
 */
export function resolveName(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): string {
  const original = findTranslation(input.translations, input.originalLocale)
  // O original é a fonte: seu `titulo` é o nome-base. Se faltar (não deveria),
  // cai no que houver do locale pedido como último recurso.
  const baseName =
    original?.titulo ?? findTranslation(input.translations, input.requestLocale)?.titulo ?? ''

  // Branch 1 (AC#2): mesmo locale ⇒ original nu, sem parênteses.
  if (input.requestLocale === input.originalLocale) return baseName

  const requested = findTranslation(input.translations, input.requestLocale)

  // Branch 2: não há tradução do locale pedido ⇒ original nu.
  if (!requested) return baseName

  // Branch 3 (AC#1 negativo): tradução não-confiável (automatica_nao_revisada) ⇒
  // original nu, NUNCA vaza o texto não revisado.
  if (!isTranslationReliable(requested.provenance)) return baseName

  // `titulo` em-branco-após-trim é tratado como AUSENTE: nada de `(   )` no nome.
  const requestedTitulo = requested.titulo.trim()

  // Branch 4 (AC#2 redundante): tradução confiável mas IGUAL ao original ⇒ sem parênteses.
  if (requestedTitulo === baseName) return baseName

  // Positivo (AC#1): confiável e diferente ⇒ `Original (Tradução)`. Nunca `()` vazio.
  if (!present(requestedTitulo)) return baseName
  return `${baseName} (${requestedTitulo})`
}

/**
 * Selo "tradução automática" (#161): `true` quando a leitura localizada repousa numa
 * tradução AUTOMÁTICA NÃO-REVISADA. Rastreia a proveniência da linha-BASE do nome PRIMÁRIO
 * (não o parêntese), ESPELHANDO `resolveName`: a base é a tradução do `originalLocale` quando
 * existe; na sua ausência, a do `requestLocale`. Ambos ausentes (não deveria ocorrer — toda
 * Receita tem ≥1 tradução) ⇒ `true` (tratado como NÃO-confiável; "nunca afirma revisado sem
 * prova"). Mesma regra do `autoTranslationSignal` da Busca/Feed (`displayedProvenance` +
 * `isTranslationReliable`) — repetida aqui (não re-exportada) para não acoplar o módulo
 * fundamental de leitura ao módulo de busca (este é insumo daquele, não o contrário).
 */
export function resolveAutoTranslationSignal(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): boolean {
  const base =
    findTranslation(input.translations, input.originalLocale) ??
    findTranslation(input.translations, input.requestLocale)
  return base == null ? true : !isTranslationReliable(base.provenance)
}

/**
 * Corpo resolvido: por campo, valor do locale pedido se presente/não-vazio; senão
 * o do `originalLocale`; senão `null`.
 */
export function resolveBody(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): RecipeBody {
  const source = findTranslation(input.translations, input.originalLocale)
  const requested = findTranslation(input.translations, input.requestLocale)

  // Candidatos em locais: o `present()` estreita o valor diretamente — sem `!`.
  const reqDescricao = requested?.descricao
  const srcDescricao = source?.descricao
  const descricao = present(reqDescricao) ? reqDescricao : present(srcDescricao) ? srcDescricao : null

  const reqPassos = requested?.passos
  const srcPassos = source?.passos
  const passos =
    reqPassos && reqPassos.length > 0
      ? reqPassos
      : srcPassos && srcPassos.length > 0
        ? srcPassos
        : null

  const reqNotas = requested?.notas
  const srcNotas = source?.notas
  const notas = present(reqNotas) ? reqNotas : present(srcNotas) ? srcNotas : null

  return { descricao, passos, notas }
}

/**
 * Facetas: cozinha/categoria/tags sempre; `restricoes` só quando há ≥ 1 (vazio ⇒
 * chave AUSENTE — distingue "sem restrição" de "presente").
 */
export function resolveFacets(input: {
  cozinha: string | null
  categoria: string | null
  tags: ReadonlyArray<string>
  restricoes: ReadonlyArray<string>
}): RecipeFacets {
  const facets: RecipeFacets = {
    cozinha: input.cozinha,
    categoria: input.categoria,
    tags: input.tags,
  }
  if (input.restricoes.length > 0) facets.restricoes = input.restricoes
  return facets
}

/**
 * Renderiza cada `RestrictionNotice` (códigos, locale-neutro) → `AvisoView` (códigos +
 * frase localizada). PURO: o catálogo `MESSAGES` é constante importada (não I/O).
 *
 * O `requestLocale` é estreitado por `isSupportedLocale`; locale desconhecido cai em
 * `DEFAULT_LOCALE` — mesma política "nunca tela quebrada" de `resolveLocale`. A restrição
 * vira RÓTULO amigável localizado (`restricaoLabel`, cobre todo o enum — sem chave
 * faltante); o token de alérgeno é interpolado CRU (free-text, sem vocabulário de
 * rótulos — limitação menor conhecida, §D3). Interpolação por `String.replace`, sem ICU.
 */
export function renderAvisos(
  notices: ReadonlyArray<RestrictionNotice>,
  requestLocale: string,
): AvisoView[] {
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE
  const msgs = MESSAGES[locale]
  return notices.map((n) => {
    const label = msgs.restricaoLabel[n.restricao]
    // Replacers como FUNÇÃO (não string): o 2º arg-string de String.replace interpreta
    // `$&`, `$\``, `$'`, `$$`, `$n` como diretivas; a função devolve o valor literal, sem
    // substituição — protege contra um `$` no token de alérgeno/rótulo corromper a frase.
    const mensagem = msgs.aviso.contradicao
      .replace('{restricao}', () => label)
      .replace('{alergeno}', () => n.alergeno)
    return { kind: n.kind, restricao: n.restricao, alergeno: n.alergeno, mensagem }
  })
}

/**
 * Aviso de tradução obsoleta (#23, AC3): PURO, renderiza a frase + o rótulo no
 * requestLocale. Devolve `undefined` SALVO quando a tradução de `requestLocale` existe,
 * está `stale` E `requestLocale !== originalLocale` (a origem NUNCA é sinalizada — alinha
 * com `resolveName` Branch 1). `loc` cai em `DEFAULT_LOCALE` se o requestLocale não for
 * suportado (mesma guarda de `renderAvisos`, "nunca tela quebrada").
 */
export function renderStaleNotice(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): StaleNotice | undefined {
  if (input.requestLocale === input.originalLocale) return undefined
  const requested = findTranslation(input.translations, input.requestLocale)
  if (!requested || !requested.stale) return undefined
  const loc = isSupportedLocale(input.requestLocale) ? input.requestLocale : DEFAULT_LOCALE
  const msgs = MESSAGES[loc]
  return {
    locale: input.requestLocale,
    originalLocale: input.originalLocale,
    mensagem: msgs.traducao.staleAviso,
    verOriginalLabel: msgs.traducao.verOriginal,
  }
}

/**
 * Vista completa: nome + corpo + selo `origin` SEMPRE + facetas + invariantes
 * (porcoes/dificuldade/ingredientes) + `schemaVersion` + flags de tradução (display) +
 * `avisos?` (anexado SÓ quando há contradição). As invariantes e o selo são IDÊNTICOS
 * qualquer que seja o `requestLocale`; só `name`/`body`/`avisos.mensagem` variam por locale.
 */
export function resolveRecipeView(input: ResolveInput): RecipeView {
  const name = resolveName({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
  })
  const body = resolveBody({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
  })
  const facets = resolveFacets({
    cozinha: input.recipe.cozinha,
    categoria: input.recipe.categoria,
    tags: input.tags,
    restricoes: input.recipe.restricoes,
  })

  // Selo "tradução automática" (#161): a leitura localizada repousa numa tradução automática
  // não-revisada? Derivado da proveniência da linha-BASE do nome (espelha resolveName).
  const autoTranslationSignal = resolveAutoTranslationSignal({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
  })

  // Nome de ingrediente localizado (#426, ADR-0030 dec.5): nome do requestLocale por `ordem`, com
  // fallback ao `raw_text` original (espelha resolveBody, sem gate de confiabilidade). A MEDIDA
  // (quantidade/unidade) NÃO muda por locale — só o nome (Direção B).
  const localizedNames = resolveIngredientNames({
    requestLocale: input.requestLocale,
    translations: input.translations,
  })

  // Aviso de restrição (#7): o motor PURO decide os CÓDIGOS; a vista os renderiza no
  // requestLocale. `restricoes` vem como `string[]` do loader — filtra por `isRestricao`
  // (defensivo, sem `as`) antes de passar ao motor, que só conhece valores do enum.
  const decision = decideRestrictionNotices({
    restricoes: input.recipe.restricoes.filter(isRestricao),
    items: input.ingredients.map((i) => ({ alergenos: i.alergenos })),
  })
  const avisos = renderAvisos(decision.avisos, input.requestLocale)

  // Aviso de tradução obsoleta (#23, AC3): só quando a tradução pedida é stale e ≠ origem.
  const staleNotice = renderStaleNotice({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
  })

  // Gestão (#59): o requester é o dono? Catálogo (ownerId null) ⇒ nunca; anônimo
  // (viewerId ausente) ⇒ nunca. Quando dono, os TRÊS campos de gestão saem juntos.
  const canManage =
    input.viewerId != null &&
    input.recipe.ownerId != null &&
    input.recipe.ownerId === input.viewerId

  // Autoria (#129): crédito "por <name>" linkando /u/<handle>. Só quando o server carregou
  // o autor E há AMBOS name+handle (Catálogo/sistema sem dono humano ⇒ author undefined ou
  // campos NULL). "ausente ≠ vazio": a chave `author` só sai quando há autor — nunca falso.
  // Atribuição à FONTE (#169, ADR-0019): receita importada da web (`web_imported`) é creditada à
  // fonte externa via `source_url`/`source_name`, NUNCA "por <Usuário>". Presente SÓ p/ web_imported
  // COM sourceUrl; `name` é OMITIDO quando o import não capturou `source_name` (a UI cai no host).
  const source: RecipeSource | undefined =
    input.recipe.origin === 'web_imported' && input.recipe.sourceUrl != null
      ? {
          url: input.recipe.sourceUrl,
          ...(input.recipe.sourceName != null ? { name: input.recipe.sourceName } : {}),
        }
      : undefined

  // Autoria (#129): SUPRIMIDA quando há `source` (importada credita a fonte, não o importador —
  // mutuamente exclusivas). Caso contrário, "por <name>" linkando /u/<handle> quando há autor humano.
  const author =
    source === undefined &&
    input.author != null &&
    input.author.name != null &&
    input.author.handle != null
      ? { name: input.author.name, handle: input.author.handle }
      : undefined

  return {
    id: input.recipe.id,
    name,
    origin: input.recipe.origin,
    schemaVersion: input.recipe.schemaVersion,
    body,
    facets,
    porcoes: input.recipe.porcoes,
    dificuldade: input.recipe.dificuldade,
    // Tempo de preparo (#261, ADR-0023): `?? null` coage o undefined das fixtures (campo opcional
    // no RecipeRow) — em runtime o select().from(recipe) sempre traz o valor (ou NULL do banco).
    tempoAtivoMin: input.recipe.tempoAtivoMin ?? null,
    tempoTotalMin: input.recipe.tempoTotalMin ?? null,
    // Projeta SEM `alergenos`: insumo de decisão, não conteúdo da vista (Omit guard). O `rawText` da
    // vista é o NOME resolvido por-locale (#426): usa o nome traduzido SÓ quando ele foi traduzido DESTE
    // mesmo nome-fonte (`nomeOrigem === raw_text atual`) — se o ingrediente foi renomeado/reordenado
    // desde a tradução, o nome-fonte não bate e caímos no `raw_text` (nome novo, correto), nunca um
    // nome traduzido ERRADO ao lado da medida. Zero chave nova — a chave `rawText` segue (guardas intactas).
    ingredients: input.ingredients.map(({ ordem, quantidade, unidade, rawText }) => {
      const traduzido = localizedNames.get(ordem)
      const nomeLocalizado =
        traduzido != null && traduzido.nomeOrigem === (rawText ?? '') && present(traduzido.nome)
          ? traduzido.nome
          : null
      return { ordem, quantidade, unidade, rawText: nomeLocalizado ?? rawText }
    }),
    translations: input.translations.map((t) => ({
      locale: t.locale,
      provenance: t.provenance,
      reliable: isTranslationReliable(t.provenance),
      stale: t.stale,
    })),
    // Selo "tradução automática" (#161): SEMPRE presente (booleano de display derivado).
    autoTranslationSignal,
    // Ausente ≠ vazio: anexa `avisos` SÓ quando há ≥ 1 (espelha `resolveFacets.restricoes`).
    ...(avisos.length > 0 ? { avisos } : {}),
    // Ausente quando a tradução pedida não é stale (ou é a origem) — espelha `avisos?`.
    ...(staleNotice ? { staleNotice } : {}),
    // Autoria (#129): crédito PÚBLICO "por <name>" (linka /u/<handle>). "ausente ≠ vazio":
    // só sai quando há autor humano. NÃO owner-gated — qualquer leitor vê o crédito.
    ...(author ? { author } : {}),
    // Atribuição à FONTE (#169, ADR-0019): "fonte: …" da importada da web. "ausente ≠ vazio":
    // só sai p/ web_imported com sourceUrl. SUBSTITUI o byline (são mutuamente exclusivos acima).
    ...(source ? { source } : {}),
    // Imagem da receita (#130): foto PÚBLICA do prato. "ausente ≠ vazio": só sai quando há imagem.
    // NÃO owner-gated — qualquer leitor que vê a Receita vê a foto. Repassa 1:1 o que o server carregou.
    // #133: MODERADA esconde a foto do público (`imageModerated && !canManage`) — o Owner ainda vê.
    // O selo de IA acompanha a imagem: imagem escondida ⇒ selo escondido (não há foto a rotular).
    ...(input.imageUrl != null && (!input.imageModerated || canManage)
      ? {
          imageUrl: input.imageUrl,
          // Selo "✨ gerada por IA" (#132): só quando há imagem VISÍVEL e é ai_generated. "ausente ≠ vazio".
          ...(input.imageAiGenerated ? { imageAiGenerated: true } : {}),
        }
      : {}),
    // Gestão (#59): os TRÊS campos saem JUNTOS e SÓ p/ o dono — leitura pública intacta.
    ...(canManage
      ? {
          canManage: true,
          visibility: input.recipe.visibility,
          resultKind: input.recipe.resultKind,
          // #134: flag de geração-por-IA-ligada, owner-gated. Só sai quando o server a carregou
          // (detalhe GET do dono); outras rotas que montam a view do dono não a pedem ⇒ ausente.
          ...(input.imageGenEnabled !== undefined ? { imageGenEnabled: input.imageGenEnabled } : {}),
          // #226: flag de geração-por-IA-BLOQUEADA p/ este usuário, owner-gated (mirror do enabled).
          // Só sai quando o server a carregou (detalhe GET do dono / view montada pelos cores de imagem).
          ...(input.imageGenBlocked !== undefined ? { imageGenBlocked: input.imageGenBlocked } : {}),
          // #222: Galeria da linhagem, OWNER-GATED (sai SÓ aqui, junto da gestão). Só quando o server
          // a carregou (detalhe GET do dono / a view montada pelos cores de imagem). Caminho público/
          // by-slug nunca passa `gallery` ⇒ ausente. "ausente ≠ vazio".
          ...(input.gallery !== undefined ? { gallery: input.gallery } : {}),
        }
      : {}),
    // Diff DERIVADO (#17): OWNER-GATED como a gestão (só o dono da derivada vê o próprio diff)
    // E presente só quando a linha de fato CARREGA um diff (`lineageKind='edited'` ⇒
    // derivedDiff != null). Repassado 1:1 do que o fork ARMAZENOU — NUNCA recomputado aqui
    // (história 289). Catálogo / não-dono / receita não-derivada ⇒ ausente ("ausente ≠ vazio").
    ...(canManage && input.recipe.derivedDiff != null
      ? {
          derivedDiff: input.recipe.derivedDiff,
          // Vínculo perdido (#289): a derivada carrega diff (logo é lineageKind='edited') MAS
          // seu parentRecipeId é NULL ⇒ a base foi apagada (FK set null). Sinaliza SÓ aqui (sai
          // junto com o diff, owner-gated). "ausente ≠ vazio": só quando perdido (parent NULL).
          ...(input.recipe.parentRecipeId == null ? { vinculoPerdido: true } : {}),
        }
      : {}),
    // Estado do PRÓPRIO viewer (#16/#362): presente SÓ com viewerId (viewer-self, NÃO
    // owner-only). Default false (server passa só quando logado). ADITIVO e estruturalmente
    // incapaz de tocar `avisos` (AC4/ADR-0004).
    ...(input.viewerId != null
      ? {
          viewerSaved: input.viewerSaved ?? false,
        }
      : {}),
  }
}
