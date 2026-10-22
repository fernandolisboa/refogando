import type { ClaudeClient, GenerationInput } from '@/server/claude/client'
import type { ModelCatalog } from '@/server/claude/model-catalog'
import type { ModelProbe } from '@/server/claude/model-probe'
import { FakeEmbedder, type Embedder } from '@/server/embedding/embedder'
import { FakeTranslator, type Translator } from '@/server/translation/translator'
import { FakeImageStore, type ImageStore } from '@/server/images/image-store'
import { FakeImageGenerator, type ImageGenerator } from '@/server/images/image-generator'
import { FakeRecipeImporter, type RecipeImporter } from '@/server/import/recipe-importer'
import { FakeRecipeProbe, type RecipeProbe } from '@/server/import/recipe-probe'
import { FakeWebSearchProvider, type WebSearchProvider } from '@/server/web-search/web-search-provider'
import { FakeMailer, type Mailer } from '@/server/mail/mailer'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import type { GenerationOutput } from '@/domain/generation'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'
import type { ExtractionOutput } from '@/domain/ingredient-extraction'
import type { MenuSuggestionOutput } from '@/domain/menu-suggestion'
import type { ImageSceneDirectorOutput } from '@/domain/image-scene-schema'
import { E2E_CANARY_TITLE } from './canary'

/**
 * Dublês do MODO FAKE do E2E (#589), um por seam de `deps.ts`. Só são construídos quando
 * `e2eFakesActive()` (./mode.ts) devolve `true` — o que exige o ambiente do harness local; em produção
 * a flag está ausente e nada daqui roda (o módulo vai pro bundle, mas é inerte).
 *
 * REGRA: nada de `test/` aqui (este arquivo entra no bundle de produção). Reusa as classes Fake* que
 * já moram ao lado de cada impl Real; o que elas não cobrem (Claude com saída derivada do pedido,
 * catálogo/teste de modelo) vive abaixo, enxuto. Nenhum dublê toca a rede.
 */

/**
 * Nonce que a spec embute no pedido ("arroz de forno 1a2b3c4d") e que volta no TÍTULO. Por quê: slug
 * (UNIQUE por locale) e handle nascem do título sem retry de colisão; dois workers gerando o MESMO
 * título ao mesmo tempo poderiam colidir. Com o nonce, cada geração tem título único e a spec confere o
 * h1 exato. Sem nonce no pedido, o título fica sem sufixo.
 */
const NONCE_RE = /\b([0-9a-f]{8})\b/

function nonceOf(text: string): string | null {
  return NONCE_RE.exec(text.toLowerCase())?.[1] ?? null
}

/**
 * Receita canário: passa no `classify` (porções/quantidades na faixa) com a cozinha `brasileira`, que a
 * migração 0033 semeia ativa. Restrições vazias: não dispara Aviso. Forma copiada do builder dos testes
 * (`makeReceita`), sem importá-lo.
 */
function canaryRecipe(nonce: string | null, suffix = ''): ReceitaGenT {
  const titulo = [E2E_CANARY_TITLE, nonce, suffix].filter(Boolean).join(' ')
  return {
    titulo,
    descricao: 'Arroz assado com queijo, feito pelo dublê do E2E.',
    passos: ['Misture o arroz com o queijo.', 'Leve ao forno por 20 minutos.'],
    notas: 'Sirva quente.',
    originalLocale: 'pt-BR',
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: [],
    porcoes: 4,
    dificuldade: 2,
    ingredientes: [
      { nome: 'arroz cozido', quantidade: '2.000', unidade: 'xicara' },
      { nome: 'queijo muçarela', quantidade: '200.000', unidade: 'g' },
      { nome: 'sal', quantidade: null, unidade: 'a_gosto' },
    ],
  }
}

/**
 * "Claude" do E2E: determinístico, mas com a Receita derivada do pedido (nonce no título). Os demais
 * métodos devolvem desfechos válidos e neutros — o smoke não depende deles, mas uma tela que os chame
 * não pode estourar com o "nenhum enlatado" do `FakeClaudeClient` dos testes.
 */
export class E2eClaudeClient implements ClaudeClient {
  async echo(text: string): Promise<string> {
    return text
  }

  async generateRecipe(input: GenerationInput): Promise<GenerationOutput> {
    return {
      kind: 'object',
      modelKind: 'success',
      recipe: canaryRecipe(nonceOf(input.userPrompt)),
      advisory: null,
    }
  }

  async generateRecipeVariants(input: GenerationInput): Promise<GenerationOutput[]> {
    const nonce = nonceOf(input.userPrompt)
    return [
      { kind: 'object', modelKind: 'success', recipe: canaryRecipe(nonce, 'clássico'), advisory: null, variacao: 'tradicional' },
      { kind: 'object', modelKind: 'success', recipe: canaryRecipe(nonce, 'criativo'), advisory: null, variacao: 'criativa' },
    ]
  }

  async *streamConversation(): AsyncIterable<string> {
    for (const token of ['Que tal ', 'um arroz ', 'de forno?']) yield token
  }

  async extractIngredients(input: GenerationInput): Promise<ExtractionOutput> {
    // Organiza por vírgula/linha: o bastante para a tela Criar seguir em frente.
    const items = input.userPrompt
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((rawText) => ({ rawText, quantidade: null, unidade: null, strength: 'required' as const }))
    return { kind: 'ok', items }
  }

  async suggestMenu(): Promise<MenuSuggestionOutput> {
    // Sugestão vazia é válida: a UI mostra "nada a sugerir" em vez de inventar Receita fora da lista.
    return { kind: 'ok', suggestion: { itens: [], comentario: 'Sugestão do dublê do E2E.' } }
  }

  async directImageScene(): Promise<ImageSceneDirectorOutput> {
    // Mesmo desfecho de produção quando o diretor falha: a imagem segue com as regras de reserva.
    return { kind: 'failed' }
  }
}

/** PNG 1×1 válido (o `FakeImageGenerator` dos testes devolve 4 bytes que o `sharp` recusaria). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** Fábricas por seam. Cada getter de `deps.ts` chama a sua UMA vez por processo (instância preguiçosa). */
export const e2eFakes = {
  claude: (): ClaudeClient => new E2eClaudeClient(),
  // Mesma resposta dos testes (test/setup.ts): lista vazia ⇒ fallback pinado, sem log de erro.
  modelCatalog: (): ModelCatalog => ({ listModels: async () => [] }),
  modelProbe: (): ModelProbe => ({ probe: async () => ({ kind: 'ok' }) }),
  // A coluna é vector(EMBEDDING_DIMENSIONS): o default de 8 dimensões do dublê falharia no INSERT.
  embedder: (): Embedder => new FakeEmbedder(EMBEDDING_DIMENSIONS),
  translator: (): Translator => new FakeTranslator(),
  imageGenerator: (): ImageGenerator =>
    new FakeImageGenerator({ data: PNG_1X1, contentType: 'image/png' }),
  // URLs em `https://fake-blob.local/...`: o smoke não exibe imagem enviada/gerada; se um dia exibir, o
  // guarda de rede do navegador (e2e/fixtures/test.ts) acusa o host de fora.
  imageStore: (): ImageStore => new FakeImageStore(),
  recipeImporter: (): RecipeImporter => new FakeRecipeImporter(),
  recipeProbe: (): RecipeProbe =>
    new FakeRecipeProbe({ fetched: true, jsonLd: 'present', robotsAllowed: true }),
  webSearchProvider: (): WebSearchProvider => new FakeWebSearchProvider(),
  // Sem e-mail de conta (`canSendAccountEmail` false): o cadastro entra direto, como produção sem Resend.
  mailer: (): Mailer => new FakeMailer({ accountEmailConfigured: false }),
}
