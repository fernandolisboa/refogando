# ADR-0009 — Contrato de geração da IA: schema canônico, streaming no chat, e taxonomia de resultado

Status: aceito

A geração por IA (Anthropic / Claude) tem um **contrato estrito** entre a saída probabilística do modelo e o dado do app:

- **Um schema canônico de Receita** (derivado do mesmo Zod/Drizzle do banco) emitido via **structured outputs** (`output_config.format`, validado com `messages.parse()`) — nada de parsear prosa. Faixas numéricas (porções, dificuldade) são validadas no app, porque o JSON Schema do recurso **não** suporta `min/max`, recursão nem `minLength`.
- **Chat e estruturado compartilham o MESMO schema de saída**; muda só a entrada. O **modo conversa streama** texto pra UX e **destila** a Receita numa chamada constrita ao fim (o chat e o objeto são chamadas distintas). O **modo estruturado** é uma chamada constrita direta a partir do Briefing.
- A IA pode anexar um **comentário consultivo** ("troquei manteiga por azeite porque você pediu vegano") — fora do objeto Receita, nunca dentro dele.
- **Modelo**: default `claude-opus-4-8` (qualidade/criatividade); `claude-sonnet-4-6` como opção de custo para alto volume. A escolha é reversível (troca de uma linha).

## Taxonomia de resultado de geração

| Resultado | O que acontece | Publicável? |
|---|---|---|
| **Sucesso** | Receita válida conforme o schema | Sim |
| **Degradado** | Possível, mas não atendeu tudo; gera + comentário ("não consegui 100% vegano") | Sim — qualidade é escolha do usuário; o app não mete o bedelho em receita só "meia-boca" |
| **Lúdico (zoeira)** | Pedido claramente brincalhão/absurdo ("bolo sem ingredientes") → a IA **entra na brincadeira** com uma receita de humor | **Não** — pode ser salva no privado, mas não vai pro pool da comunidade |
| **Impossível (honesto)** | Pedido genuinamente impossível e sem graça → **hard stop** honesto ("não dá pra fazer isso, ajusta o pedido") | — (não gera Receita) |
| **Inválido (schema)** | Saída falhou na validação mesmo após retry/repair → erro de sistema, **nunca exibe lixo** | — |

A IA **julga** brincadeira vs. erro honesto pela intenção/tom (Claude infere isso bem); na dúvida, responde com leveza mas oferece o caminho sério.

## Por quê

O schema-contrato é herdado por persistência, busca, i18n e UI, e por todos os dados já gerados — é caro reverter. Structured outputs (vs parsear prosa) dá saídas confiáveis e persistíveis. A taxonomia evita os dois extremos ruins: mostrar lixo/receita inválida, e ser um chato que recusa toda brincadeira — o lúdico é personalidade de produto. O não-publicável da zoeira protege o catálogo/comunidade de poluição, sem tirar a graça do usuário.

## Consequências

- O schema canônico único é a fonte de verdade; mudá-lo é migração.
- `refusal` / `max_tokens` no streaming são tratados como falha honesta (cai em "inválido"), nunca como Receita parcial silenciosa.
- A receita lúdica precisa de um marcador que **bloqueia visibilidade pública** (ADR-0003) mantendo o salvar privado.
- Se o volume de receitas de zoeira virar problema de banco, opção futura: persistir essas **só local/on-device** (SQLite no celular, cache do navegador), fora do servidor. Deferido — não construído agora.
