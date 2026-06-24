/**
 * Seam ÚNICO e mockável para a GERAÇÃO de imagem por IA (issue #132, ADR-0017). Espelha a forma dos
 * outros seams (`image-store.ts`/`embedder.ts`/`translator.ts`): interface + impl Real + Fake +
 * Throwing, resolvidos por DI em `@/server/deps`. O resultado (bytes) vai pro `ImageStore` e vira
 * uma linha `recipe_image` com `provenance = ai_generated`.
 *
 * Real = **Nano Banana 2** (`gemini-3.1-flash-image`, Google) via **REST PURO, sem SDK** — `fetch`
 * direto no endpoint `:generateContent` com a API key. Driblar o SDK mata o problema crônico de
 * cutoff de npm (ADR-0017) e deixa o provedor trocável. O modelo DEVOLVE OS BYTES (base64
 * `inlineData`) → vão direto pro blob, sem 2º fetch nem corrida de URL expirável.
 *
 * Como o `ImageStore` real, a API key é lida PREGUIÇOSAMENTE no uso (não no import): build/typecheck
 * e os testes (que injetam `FakeImageGenerator`) nunca a exigem. O wire-format do `generateContent`
 * (contents→parts→inlineData) é estável entre os modelos de imagem do Gemini; este caminho NÃO é
 * exercitado por teste (Fake) e só roda ao vivo quando a key estiver no ambiente (gate humano).
 */

// Modelo default (Nano Banana 2) — fonte ÚNICA no DOMÍNIO (`image-gen-config.ts`), de onde o teto/
// allowlist/config também saem (direção de camada: server depende de domínio). Re-exportado pra
// conveniência dos consumidores históricos do seam.
import { DEFAULT_IMAGE_MODEL } from '@/domain/image-gen-config'
import type { ImageUsage } from '@/domain/image-cost'
export { DEFAULT_IMAGE_MODEL }
export type { ImageUsage }

/** Entrada da geração: o prompt já montado (de `buildDishImagePrompt` ou editado pelo usuário). */
export type GenerateImageInput = {
  prompt: string
  /** Modelo a usar (default Nano Banana 2). #134 passa o modelo da config; #132 usa o default. */
  model?: string
  /**
   * #285 (image-to-image): imagem-base OPCIONAL. Quando presente, vira uma part `inlineData` ao lado do
   * texto na chamada multimodal do Gemini (editar a partir dela). Ausente ⇒ geração do zero (texto-só).
   */
  source?: { data: Buffer; contentType: string }
}

/**
 * Bytes da imagem gerada + content-type + telemetria de custo (#224, ADR-0022 dec.4). O `usageMetadata`
 * (tokens) + `model` alimentam `computeImageCost` e viram o snapshot `cost_usd` no ledger. Ambos são
 * OPCIONAIS e BEST-EFFORT: o caminho Real só popula se o Gemini mandou `usageMetadata`; sem ele a
 * geração NÃO falha (a linha nasce com usage/custo nulos). O Fake devolve um usage canned.
 */
export type GeneratedImage = {
  data: Buffer
  contentType: string
  /** Tokens da geração (prompt/output-imagem/thinking/total) — ausente ⇒ telemetria indisponível. */
  usageMetadata?: ImageUsage
  /** Modelo efetivamente usado (pro snapshot de preço); ausente ⇒ o caller usa o modelo da config. */
  model?: string
}

export interface ImageGenerator {
  generateDishImage(input: GenerateImageInput): Promise<GeneratedImage>
}


/** Forma mínima da resposta do `:generateContent` que consumimos (parts com inlineData base64 +
 * usageMetadata de tokens). TODOS os campos opcionais — o caminho Real mapeia defensivamente. */
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    totalTokenCount?: number
  }
}

/**
 * Mapeia o `usageMetadata` cru do Gemini → `ImageUsage` normalizado. DEFENSIVO: cada campo é opcional
 * (default 0), NUNCA lança. Se o bloco `usageMetadata` está ausente, devolve `undefined` (telemetria
 * indisponível — a geração segue, a linha do ledger nasce com usage/custo nulos). Caminho Real não
 * exercitado por teste (roda ao vivo só com a key).
 */
function mapGeminiUsage(raw: GeminiResponse['usageMetadata']): ImageUsage | undefined {
  if (!raw) return undefined
  return {
    promptTokens: raw.promptTokenCount ?? 0,
    outputTokens: raw.candidatesTokenCount ?? 0,
    thinkingTokens: raw.thoughtsTokenCount ?? 0,
    totalTokens: raw.totalTokenCount ?? 0,
  }
}

/**
 * Impl REAL — Gemini REST sem SDK. POST em `:generateContent` com a API key; lê a 1ª part com
 * `inlineData` (base64) → Buffer. Key exigida no USO (lazy): sem ela, lança ANTES de qualquer rede.
 */
export class RealGeminiImageGenerator implements ImageGenerator {
  private requireKey(): string {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY
    if (!key) {
      throw new Error('GEMINI_API_KEY não definido (geração de imagem por IA não configurada).')
    }
    return key
  }

  async generateDishImage(input: GenerateImageInput): Promise<GeneratedImage> {
    const key = this.requireKey()
    const model = input.model ?? DEFAULT_IMAGE_MODEL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

    // #285: parts multimodais — o texto (sempre) + (se edição) a imagem-base como `inlineData` base64.
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: input.prompt },
    ]
    if (input.source) {
      parts.push({
        inlineData: {
          mimeType: input.source.contentType,
          data: input.source.data.toString('base64'),
        },
      })
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }] }),
    })
    if (!res.ok) {
      // Inclui o corpo do erro do Gemini na mensagem (SERVER-ONLY — nunca volta ao cliente; a rota
      // mapeia para um 503 genérico). Diagnóstico do caminho ao vivo (não exercitado por teste).
      const detail = await res.text().catch(() => '')
      throw new Error(`geração de imagem falhou: HTTP ${res.status} ${detail.slice(0, 500)}`)
    }
    const body = (await res.json()) as GeminiResponse
    const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    const b64 = part?.inlineData?.data
    if (!b64) {
      throw new Error('resposta da geração de imagem sem bytes (inlineData ausente)')
    }
    return {
      data: Buffer.from(b64, 'base64'),
      contentType: part?.inlineData?.mimeType ?? 'image/png',
      // #224: telemetria de custo (best-effort). `usageMetadata` ausente ⇒ undefined (não falha).
      usageMetadata: mapGeminiUsage(body.usageMetadata),
      model,
    }
  }
}

/** Usage canned default do Fake (#224) — números plausíveis (output ≈ 1 imagem) p/ exercitar o custo. */
export const FAKE_IMAGE_USAGE: ImageUsage = {
  promptTokens: 25,
  outputTokens: 1290,
  thinkingTokens: 0,
  totalTokens: 1315,
}

/** Dublê determinístico para testes — NUNCA toca o Gemini. Devolve bytes canned (PNG 1x1 fake) +
 * `usageMetadata`/`model` canned (#224) — o custo grava no ledger. O `model` do canned é null por
 * default: o caller cai no modelo da config (genConfig.model), espelhando o caminho Real. */
export class FakeImageGenerator implements ImageGenerator {
  /** Conta chamadas (provar que a geração disparou) e guarda o último prompt/modelo (asserções). */
  public calls = 0
  public lastPrompt: string | null = null
  /** #134: o modelo recebido (da config do admin) — `undefined` quando o chamador não passou modelo. */
  public lastModel: string | undefined = undefined
  /** #285: a imagem-base recebida (image-to-image) — `undefined` na geração do zero. */
  public lastSource: { data: Buffer; contentType: string } | undefined = undefined
  constructor(
    private readonly canned: GeneratedImage = {
      data: Buffer.from([1, 2, 3, 4]),
      contentType: 'image/png',
      usageMetadata: FAKE_IMAGE_USAGE,
    },
  ) {}

  async generateDishImage(input: GenerateImageInput): Promise<GeneratedImage> {
    this.calls++
    this.lastPrompt = input.prompt
    this.lastModel = input.model
    this.lastSource = input.source
    return this.canned
  }
}

/** Dublê que SEMPRE falha — exercita a degradação (rota deve responder erro) E prova, em casos de
 * autorização negada (anon/não-dono), que o seam NUNCA foi tocado (calls fica em 0). */
export class ThrowingImageGenerator implements ImageGenerator {
  public calls = 0
  async generateDishImage(): Promise<GeneratedImage> {
    this.calls++
    throw new Error('geração de imagem indisponível (dublê de degradação)')
  }
}
