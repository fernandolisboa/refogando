/**
 * Seam ÚNICO e mockável para geração de embedding.
 *
 * A camada semântica de verdade (pgvector, vetor por linha de tradução, versionamento
 * de modelo, re-embedding em `stale`) é da issue #14. Aqui só fixamos a interface
 * mockável, espelhando o seam do Claude.
 */
export interface Embedder {
  embed(text: string): Promise<number[]>
}

/** Implementação real — stub até a #14 plugar o modelo de embedding multilíngue. */
export class RealEmbedder implements Embedder {
  async embed(): Promise<number[]> {
    throw new Error('RealEmbedder ainda não implementado — embedding real é da issue #14')
  }
}

/** Dublê determinístico (vetor estável derivado do texto) para testes. */
export class FakeEmbedder implements Embedder {
  constructor(
    private readonly dimensions = 8,
    private readonly impl?: (text: string) => number[],
  ) {}

  async embed(text: string): Promise<number[]> {
    if (this.impl) return this.impl(text)
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
