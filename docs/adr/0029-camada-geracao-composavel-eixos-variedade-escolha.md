# ADR-0029 — Camada de geração composável: eixos de prompt, variedade e escolha do usuário (refino da IA)

Status: aceito

Refino da camada de IA (issue #381). Hoje a geração viva é **pobre**: três system prompts FIXOS de 2-3 frases (`src/domain/briefing.ts`), **dificuldade entra como número cru sem efeito**, senioridade/persona **não existe**, a imagem sai sempre da **mesma** estética (um único `STYLE_PREAMBLE` em `src/domain/image-prompt.ts`), e a tradução em runtime é um **stub que lança** (`RealTranslator`). As ~225 receitas "ricas" do catálogo foram geradas por um Workflow ad-hoc externo com prompts muito melhores do que o pipeline de produção usa. Decidimos tornar a geração **composável por eixos** e mais variada, sem quebrar o contrato do ADR-0009. Emenda/relaciona: ADR-0009 (texto), ADR-0017/0022 (imagem), ADR-0025 (vocabulário de cozinha).

## Decisões

1. **Composição por fragmentos de prompt nomeados, na chamada da API — NÃO "skill" externa.** Cada eixo é um **fragmento de texto nomeado** que o servidor **compõe no system prompt** (texto) ou no preâmbulo (imagem) na hora de gerar, **threaded da borda** exatamente como o `cozinhaSlugs` já faz (rota resolve → `GenerationInput` → chamada). Não é uma "skill" instalável/runtime (essa é abstração de ferramenta de autoria, categoria errada; a prateleira `lgpd-skills` é análoga só de nome). É composição de string determinística nas funções puras de `briefing.ts` — um `buildSystemPrompt(eixos)`.

2. **Novo eixo "Nível de habilidade"** (glossário): iniciante / intermediário / avançado — **para quem a receita é escrita** (minúcia da explicação, vocabulário técnico, tom), **distinto da Dificuldade** (quão difícil é o *prato*). **Default do Perfil** do usuário, sobrescrevível por geração. **Precedência** entre sinais: palavras explícitas do usuário na hora > campo do formulário > default do perfil; em conflito real a IA **aconselha** (Aviso), nunca contradiz calada — reusa o princípio do Briefing (ADR-0009: "a IA aconselha, o usuário decide"). **UX:** o usuário escolhe o **Nível**; a **Dificuldade do prato passa a ser ESTIMADA pela IA** (saída, não campo de entrada), pra não ter dois seletores irmãos confusos.

3. **Cozinha-como-voz.** Hoje "Cozinha: japonesa" só rotula o campo e constrange o enum de saída (ADR-0025); passa a **instruir o modelo a cozinhar autenticamente**. Camadas: **(a)** uma instrução genérica de autenticidade que usa o nome da cozinha — escala a **toda** cozinha de graça; **(b)** uma **nota de voz curada OPCIONAL por cozinha**, armazenada em `vocabulary_term` (Admin/Curador edita, **sem deploy** — coerente com o data-driven do ADR-0025), que enriquece o genérico quando existe. Distinta da constraint do enum de saída, que continua.

4. **Dificuldade vira saída, não entrada.** Hoje a Dificuldade é campo do Briefing (input) **e** campo da Receita (output), mas o input não muda nada — é número morto. Removemos a Dificuldade como **campo de entrada** (o usuário controla o **Nível de habilidade**); a IA **estima** a dificuldade do prato e a devolve no schema (o campo de saída já existe). Some o número morto e some o risco de dois seletores irmãos confusos (Dificuldade × Nível).

5. **Variedade de imagem.** Troca o `STYLE_PREAMBLE` único por uma **biblioteca composável de fragmentos** (enquadramento / luz / mood / superfície) com **rotação AUTOMÁTICA e determinística por receita** (hash do `id` → preset; estável e reproduzível, puro), **mais mapeamento cozinha → convenção visual** (louça/empratamento/superfície típicos). O **refino de texto livre** continua como override do usuário. **Invariante do ADR-0022 mantido:** o servidor SEMPRE compõe o prato como sujeito; nenhum eixo o substitui.

6. **"Gerar 2, o usuário escolhe."** A variedade vem do **PROMPT, não de sampling** — verificado na doc da Anthropic: **Opus 4.8 rejeita `temperature`/`top_p`/`top_k` (400) e não há `seed`**. Duas versões saem de **uma única chamada structured** cujo schema devolve uma **lista de 2 receitas**, com o prompt instruindo divergência genuína ao longo de um **eixo de divergência config-driven** (ex.: "tradicional / com toque criativo", "rápida / caprichada") — editável **sem deploy** (o "dinâmico, não hardcoded" pedido pelo dono). Cada variação passa pelo mesmo `classify`. **Custo ~2× tokens de saída → opt-in / com teto**, não sempre-ligado sem limite.

7. **Sinal de qualidade = os próprios usuários + portão barato.** Carimbar cada geração com a **versão de prompt/eixos** que a produziu (proveniência). O **veredito** é o que os usuários **já** fazem — **Salvar / Avaliação (estrelas) / publicar** (ADR-0027) — correlacionado à versão do prompt: delegação em escala, quase de graça, sinal comportamental real (inclusive qual das 2 variações foi escolhida). Antes de embarcar um prompt novo, um **comparador admin antes/depois** (poucos briefings fixos, velho vs. novo, lado a lado) serve de portão barato. Juiz-IA por rubrica: deferido.

## Invariantes que este refino NÃO pode quebrar

- **Mesmo `RecipeGenSchema` via structured output** (`messages.parse`, sem parsear prosa); o consultivo (Aviso) fica **fora** do objeto Receita (ADR-0009).
- **Selos de proveniência/disclosure** obrigatórios e não-desligáveis (`ai_*` / imagem `ai_generated`) — nenhum eixo "lava" IA (CONTEXT.md, ADR-0002/0016/0017).
- **Taxonomia lúdico/impossível** (success/degraded/playful/impossible) preservada; playful bloqueia visibilidade pública.
- **Cozinha = vocabulário controlado**; a IA nunca inventa cozinha (saída constrita ao active-set, ADR-0025).
- **Extração ≠ Geração** (ADR-0009 adendo #112) — não fundir.
- **Nome de ingrediente sem medida** (número+unidade em campos próprios).
- **Sampling bloqueado no Opus 4.8** ⇒ toda variedade vem do **conteúdo do prompt**, jamais de temperatura/seed.

## Considered / rejeitadas

- **"Skill" externa/instalável como abstração de eixo** — rejeitada: é ferramenta de autoria, não runtime de geração; composição de prompt na API é o que o código já faz (cozinhaSlugs) e o que o modelo suporta.
- **Fragmentos por cozinha hardcoded no código** — rejeitada: quebraria o data-driven do ADR-0025 (cozinha nova via Admin ficaria muda até um deploy). Por isso a nota curada vive no dado.
- **Variar por `temperature`/`top_p`/`seed`** — impossível no Opus 4.8 (400 / inexistente). **Trocar pra Sonnet 4.6** só pra ter temperatura — rejeitada: mistura tier de qualidade e enviesa o sinal ("ganhou o Opus", não "ganhou o prompt").
- **Presets de estilo de imagem escolhidos pelo usuário como padrão** — rejeitada como padrão: o refino já é opcional e escondido, o usuário típico não usa; a rotação automática ataca a monotonia sem fricção (o refino segue disponível pra quem quer).

## Consequências

- `buildSystemPrompt(eixos)` e uma biblioteca de fragmentos passam a ser o coração da geração; `GenerationInput` ganha os eixos resolvidos na borda (mesmo trilho do `cozinhaSlugs`).
- `vocabulary_term` ganha um campo opcional de "nota de voz"; o Perfil ganha um default de Nível de habilidade.
- A geração de texto passa a **carimbar a versão de prompt** (habilita medir), o que hoje não existe (só imagem tem cost-tracking).
- "Gerar 2" muda o schema de saída pra lista quando ligado — cada item classifica igual.

## Escopo (issue #381) e deferidos

- **No #381:** enriquecer os prompts vivos + os eixos (Nível de habilidade, cozinha-como-voz, dificuldade-comportamental) + variedade de imagem automática + o comparador admin. "Gerar 2" entra opt-in.
- **Fora (issue própria):** **Tradução** — é **greenfield** (o `RealTranslator` lança), amarra no épico bilíngue #187 e conserta o bug do **nome de ingrediente não-traduzido**; não é "melhorar", é "construir".
- **Deferidos:** N variações de imagem por chamada (custo), juiz-IA por rubrica, e o seletor "2 opções" sempre-ligado sem teto.
