# ADR-0009 — Contrato de geração da IA: schema canônico, streaming no chat, e taxonomia de resultado

Status: aceito

> **Nota (ADR-0033, 2026-09-24):** o modelo deixou de ser uma allowlist de duas opções em código. O default passa a `claude-opus-5-5` e o admin escolhe entre o mais novo de Opus, Sonnet e Fable, listados pela Models API da Anthropic.

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

## Adendo (#112) — A Extração de ingredientes é um SEGUNDO uso da mesma disciplina de structured output

A **Extração de ingredientes** (entrada inteligente do modo Formulário) reusa a mesma disciplina deste ADR — schema flat, `messages.parse()`, reparo de uma tentativa, fallback `parse_failed` que vira erro de sistema (502, nunca lixo) — só que num schema próprio (`IngredientExtractionSchema`, com `unidade` como string nullable normalizada no app via `isUnidade`) e num **modelo BARATO dedicado** (`EXTRACTION_MODEL`, env-overridable; intencionalmente NÃO o `default_model` compartilhado da Geração). A Extração **organiza** os ingredientes que o Usuário escreveu; **não inventa nem gera a Receita** — é distinta da Geração (ver CONTEXT.md: Extração ≠ Geração).

## Adendo (2026-06-30) — Campo de ingrediente é `nome` (sem medida), não a linha-com-medida

O schema de geração nasceu com `rawText: z.string()` **sem descrição**. Sem o sinal, o modelo preenchia `rawText` com a **linha humana completa** ("320 g de arroz arbóreo"), **duplicando** a medida que também vai em `quantidade`/`unidade`. Isso violava o contrato estruturado (ADR-0012: `quantidade`/`unidade` são a fonte única da medida) e inviabilizava escalar por porções sem IA. Afetou TODOS os caminhos (chat/estruturado/free-text), a importação web e o seed de catálogo (#238).

Correção do contrato: o campo de texto do ingrediente no schema de geração é **`nome`** (renomeado de `rawText`), com descrição explícita — *"nome do ingrediente SEM quantidade/unidade (ex.: `arroz arbóreo`, nunca `320 g de arroz arbóreo`); a medida vai em `quantidade` + `unidade`"*. O **nome do campo + a descrição** são os principais sinais que o structured output lê. Mapeia para `recipe_ingredient.raw_text` (sem rename de coluna). A Extração (Adendo #112) e a importação web seguem a regra: a medida fica nos campos estruturados, `raw_text` é só o nome (na importação, best-effort — tira a medida da linha do JSON-LD). Defesa em profundidade opcional: se o modelo ainda vazar a medida no `nome`, um strip leve no servidor a remove — best-effort, **nunca rejeição dura** (um nome pode conter número legítimo, ex.: "leite 2%").

**Refinação (2026-06-30, ver ADR-0012 Adendo 2):** "tirar a medida" significa tirar só o **número** e a **unidade do enum** (`g/kg/ml/l/colher_de_sopa/colher_de_cha/xicara/dente/fatia/pitada`). **Palavras de porção/recipiente que NÃO são unidades do enum** — "folha", "talo", "ramo", "maço", "lata", "punhado", "pacote", "vidro", "caixa" — **ficam no nome** ("4 folhas de alga nori" → `nome` = "folhas de alga nori", `quantidade=4`, `unidade='unidade'`), porque o enum não as representa e a exibição as precisa para ler certo. Strip que come a palavra de porção é o bug que reprovou o PR #357.
