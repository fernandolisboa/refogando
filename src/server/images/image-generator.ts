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
export { DEFAULT_IMAGE_MODEL }

/** Entrada da geração: o prompt já montado (de `buildDishImagePrompt` ou editado pelo usuário). */
export type GenerateImageInput = {
  prompt: string
  /** Modelo a usar (default Nano Banana 2). #134 passa o modelo da config; #132 usa o default. */
  model?: string
}

/** Bytes da imagem gerada + o content-type (pro `ImageStore` e pro recipe_image). */
export type GeneratedImage = {
  data: Buffer
  contentType: string
}

export interface ImageGenerator {
  generateDishImage(input: GenerateImageInput): Promise<GeneratedImage>
}


/** Forma mínima da resposta do `:generateContent` que consumimos (parts com inlineData base64). */
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
  }>
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

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: input.prompt }] }] }),
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
    }
  }
}

/** Dublê determinístico para testes — NUNCA toca o Gemini. Devolve bytes canned (PNG 1x1 fake). */
export class FakeImageGenerator implements ImageGenerator {
  /** Conta chamadas (provar que a geração disparou) e guarda o último prompt/modelo (asserções). */
  public calls = 0
  public lastPrompt: string | null = null
  /** #134: o modelo recebido (da config do admin) — `undefined` quando o chamador não passou modelo. */
  public lastModel: string | undefined = undefined
  constructor(private readonly canned: GeneratedImage = { data: Buffer.from([1, 2, 3, 4]), contentType: 'image/png' }) {}

  async generateDishImage(input: GenerateImageInput): Promise<GeneratedImage> {
    this.calls++
    this.lastPrompt = input.prompt
    this.lastModel = input.model
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
