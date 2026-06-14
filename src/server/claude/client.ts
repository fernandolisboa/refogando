/**
 * Seam ÚNICO e mockável para o cliente do Claude (Anthropic).
 *
 * Na fundação (#2) a interface é deliberadamente mínima — só `echo` — o suficiente
 * para provar que toda chamada ao Claude passa por uma interface e que o teste pode
 * trocá-la por um dublê determinístico sem tocar a rede.
 *
 * A issue #8 (dona do kernel de geração) ESTENDE esta interface com o método de
 * geração, já com a forma real: structured outputs via schema canônico, taxonomia
 * de resultado (success/degraded/playful) e comentário consultivo FORA da Receita
 * (ADR-0009). Não declaramos esse método agora para não congelar a forma errada.
 */
export interface ClaudeClient {
  echo(text: string): Promise<string>
}

/** Implementação real. Em #2 `echo` é puro (sem rede); o SDK Anthropic entra na #8. */
export class RealClaudeClient implements ClaudeClient {
  async echo(text: string): Promise<string> {
    return text
  }
}

/** Dublê determinístico para testes. Por padrão ecoa; aceita uma resposta custom. */
export class FakeClaudeClient implements ClaudeClient {
  constructor(private readonly reply: (text: string) => string = (text) => text) {}

  async echo(text: string): Promise<string> {
    return this.reply(text)
  }
}
