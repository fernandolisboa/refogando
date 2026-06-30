# ADR-0012 — Ingrediente canônico e item-de-receita

Status: aceito

"Ingrediente" são **dois conceitos**, modelados como duas entidades:

- **Item de receita** (`RecipeIngredient`) — a ocorrência dentro de uma Receita: **quantidade** (numérica) + **unidade** + nota de preparo, mais o `raw_text` (o que a IA/fonte disse). Pertence ao agregado Receita. Quantidade e unidade são **invariantes** (não traduzíveis); a unidade vem do Vocabulário culinário (kernel de enums). O texto do item é conteúdo traduzível (ADR-0001).
- **Ingrediente** (canônico) — entidade **language-neutral**, id estável, com nome/aliases traduzidos pela **mesma tabela de tradução** do ADR-0001 e dado de **alérgeno opcional/oportunista** (ADR-0004). Habilita a busca por ingrediente cross-locale (ADR-0008) e o aviso de contradição óbvia.

## Ligação

O item referencia o canônico por **FK opcional, resolvida best-effort** — a IA cospe texto livre e não se pode travar a geração quando um ingrediente não resolve. Item não-resolvido fica só com `raw_text` (exibe normal); a busca por ingrediente **degrada para FTS** quando não há canônico, e o aviso de alérgeno só dispara quando há canônico com dado. Um pipeline de normalização (texto-livre → ingrediente_id) cresce a base canônica por **curadoria** (papel Curador, ADR-0011).

## Por quê

Conflacionar os dois faria a busca por ingrediente virar matching de string frágil e impediria o aviso de alérgeno. Mas exigir canônico no dia 1 travaria a IA — daí a FK opcional best-effort. O diff da derivada (ADR-0005) exige o item **estruturado**, não prosa. Este é o último pré-requisito do schema canônico de Receita (ADR-0009).

## Adendo (2026-06-30) — `raw_text` é o NOME (sem medida); a medida é estruturada e ÚNICA

Refinamento de "raw_text = o que a IA/fonte disse". Na prática a IA/seed/importação **embutiam a medida no `raw_text`** ("320 g de arroz arbóreo") **e** também a gravavam em `quantidade`/`unidade` — **duas fontes da mesma medida**, que o formulário deixava **divergir** (editar a quantidade sem tocar no texto), tornando a receita inconsistente, poluindo o prompt de regeneração (`rotuloItem` mandava nome="320 g…" + "quantidade: 100 g", contraditório) e o diff de derivar, e **impossível de escalar** sem IA.

Decisão:
- `quantidade`/`unidade` são a **fonte ÚNICA da medida**; nunca repetidas em texto.
- `raw_text` é o **nome/texto do ingrediente SEM a medida** ("arroz arbóreo"). Enquanto o canônico não resolve (FK best-effort, ainda diferida), `raw_text` **É** o nome exibido; quando resolver, o nome canônico (traduzido) o supera — sem contradição com o corpo original do ADR.
- A **exibição compõe** "medida + nome", formato **em-dash** ("320 g — arroz arbóreo"): **zero gramática** (não pluraliza a unidade, sem conector "de", locale-neutro — o que evita o buraco que tentava a IA a despejar a linha no texto). Contáveis (`unidade`) largam a palavra "unidade" e exibem "{qty} {nome}" ("2 cebolas"); `a_gosto`/`q_b` como **sufixo** ("sal — a gosto").
- **Escalar por porções** (plano futuro) vira `quantidade × ratio` — **aritmética, não IA** (uma calculadora, não um modelo). A **flexão de plural sob escala** (1 cebola → 3 cebolas) é da feature de escala, alimentada pelo **Ingrediente canônico** (formas singular/plural na tabela de tradução do ADR-0001) — **não** um heurístico de string (que erraria `limão`/`pão`/concordância). A exibição **estática** não precisa flexionar: o nome já nasce concordando com a quantidade gerada.

Trade-off aceito: o em-dash lê um pouco mais mecânico que a prosa natural ("2 colher de sopa" em vez de "colheres"), em troca de medida estruturada confiável, escala sem IA e zero manutenção de gramática por locale.

Migração dos dados existentes (medida embutida no `raw_text`): **script único assistido por IA** — dada a linha + a `quantidade`/`unidade` **já corretas**, devolve só o nome (tarefa de **linguagem**, one-off, ≠ a aritmética da escala). Roda **antes** de retomar a curadoria; o catálogo é **HITL** (curador revisa cada um, ADR-0026) como rede de segurança. Supera o remendo anterior (PR #354, que exibia `raw_text` cru — "texto solto sem quantidade estruturada", anti-padrão do CONTEXT.md).
