import { EMBEDDING_DIMENSIONS } from '@/db/schema'

/**
 * Seam ÚNICO e mockável para geração de embedding (issues #14/#119).
 *
 * A camada semântica (pgvector, vetor por linha de tradução, versionamento de modelo, re-embedding
 * em `stale`) é da #14. A impl REAL ficou pra cá (#119): Gemini `gemini-embedding-001` por REST PURO
 * (sem SDK), espelhando o `ImageGenerator` (#132) — `fetch` direto no `:embedContent` com a key lida
 * PREGUIÇOSAMENTE no uso (build/typecheck e os testes — que injetam `FakeEmbedder` — nunca a exigem).
 */
/**
 * Tarefa do embedding (Gemini `taskType`). RECUPERAÇÃO ASSIMÉTRICA: documentos indexados com
 * `RETRIEVAL_DOCUMENT`, consultas com `RETRIEVAL_QUERY`. Sem isso, query e documento compartilham a
 * tarefa default e a geometria fica anisotrópica — textos curtos não-relacionados batem 0.5–0.6 de
 * cosseno (ruído), sem janela limpa pra um piso de similaridade. Com o par, o sinal sobe e o ruído
 * fica pra trás (medido contra o corpus real). Ausente ⇒ legado (nenhuma tarefa enviada).
 */
export type EmbeddingTaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'

export interface Embedder {
  embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]>
}

/**
 * NOME do modelo na API do Gemini (vai no PATH de `:embedContent`). `gemini-embedding-001` (GA)
 * suporta dimensão de saída flexível (MRL); pedimos `EMBEDDING_DIMENSIONS` (1536) p/ casar a coluna
 * `vector(1536)` — 50% do armazenamento da default (3072) com o mesmo MTEB. NÃO mudar sem trocar o
 * modelo de verdade (é o path da URL).
 */
export const EMBEDDING_MODEL = 'gemini-embedding-001'

/**
 * VERSÃO da geometria do embedding, gravada em `recipe_embedding.model` (a coluna é o "o que produziu
 * este vetor", não só o nome do modelo da API). Fonte ÚNICA aqui — `recompute.ts` re-exporta (sem
 * ciclo: embedder ← deps ← recompute). BUMPE este valor sempre que a geometria mudar (modelo, dimensão,
 * `taskType`, normalização): o `NEEDS_EMBEDDING` compara `model <> EMBEDDING_VERSION`, então um deploy
 * marca as linhas da geometria antiga como candidatas e o backfill as reembeda — sem `UPDATE` manual,
 * e o contador "restantes" do /admin mostra o pendente. `-retr` = par de recuperação RETRIEVAL_*.
 */
export const EMBEDDING_VERSION = `${EMBEDDING_MODEL}-retr`

/** Forma mínima da resposta do `:embedContent` que consumimos (`embedding.values` = float[]). */
type EmbedContentResponse = { embedding?: { values?: number[] } }

/**
 * Impl REAL — Gemini REST sem SDK (#119). POST em `:embedContent` com a key e `outputDimensionality`
 * = 1536. Key exigida no USO (lazy): sem ela, lança ANTES de qualquer rede. Como o caminho de geração
 * trata o embed como ASSISTIVO (best-effort, swallow), um erro aqui (sem key / 429 / rede) NÃO derruba
 * a criação — só deixa a Receita sem vetor (a Busca degrada pra FTS+trigram). Este caminho NÃO é
 * exercitado por teste (Fake); só roda ao vivo quando a key estiver no ambiente (gate humano).
 *
 * Distância da Busca é COSSENO (`<=>`), invariante a escala, então NÃO normalizamos o vetor (consistente
 * com o `FakeEmbedder`, que também devolve cru). A mesma key do gerador de imagem serve (mesma API).
 */
export class RealEmbedder implements Embedder {
  private requireKey(): string {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY
    if (!key) {
      throw new Error('GEMINI_API_KEY não definido (embedding real não configurado).')
    }
    return key
  }

  async embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]> {
    const key = this.requireKey()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(EMBEDDING_MODEL)}:embedContent`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS, // 1536 — casa a coluna vector(1536)
        // Recuperação assimétrica (doc vs query) — só enviado quando o chamador especifica.
        ...(taskType ? { taskType } : {}),
      }),
    })
    if (!res.ok) {
      // Corpo do erro do Gemini SERVER-ONLY (nunca volta ao cliente; o chamador é best-effort).
      const detail = await res.text().catch(() => '')
      throw new Error(`embedding falhou: HTTP ${res.status} ${detail.slice(0, 300)}`)
    }
    const body = (await res.json()) as EmbedContentResponse
    const values = body.embedding?.values
    if (!values || values.length === 0) {
      throw new Error('resposta de embedding sem `embedding.values`')
    }
    return values
  }
}

/** Dublê determinístico (vetor estável derivado do texto) para testes. */
export class FakeEmbedder implements Embedder {
  constructor(
    private readonly dimensions = 8,
    private readonly impl?: (text: string, taskType?: EmbeddingTaskType) => number[],
  ) {}

  async embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]> {
    if (this.impl) return this.impl(text, taskType)
    // Vetor determinístico e barato: hash simples por caractere.
    const vec = new Array<number>(this.dimensions).fill(0)
    for (let i = 0; i < text.length; i++) {
      vec[i % this.dimensions] += text.charCodeAt(i)
    }
    return vec
  }
}

/** Dublê que SEMPRE falha — para a #14 exercitar a degradação graciosa
 * (embedding cai ⇒ busca vira só-precisa, 200, não-vazia). */
export class ThrowingEmbedder implements Embedder {
  async embed(): Promise<number[]> {
    throw new Error('embedding indisponível (dublê de degradação)')
  }
}
