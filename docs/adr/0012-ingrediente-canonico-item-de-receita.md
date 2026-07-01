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

## Adendo 2 (2026-06-30) — Reprovação do "zero gramática"; exibição em prosa natural com plural correto

A Direção B (Adendo anterior) foi implementada (PR #357) e **reprovada pelo dono ao ver na tela de produção** — lição reforçada: **validar na superfície real**, não só em teste verde (ver [verificar-arte-na-superficie-real]). Três falhas concretas, vistas ao vivo:

1. **A unidade não flexionava** ("3 dente", "4 colher de sopa", "2 louro"). A decisão "zero gramática" (não pluralizar a unidade) leu como **amador** — "site escrito errado parece email de phishing", e joga o custo de conserto pro Curador, linha a linha (responsabilidade que **cresce exponencialmente**).
2. **O em-dash "—" era ruim**: feio, **inconsistente** (contável não levava traço, não-contável levava) e às vezes **não renderizava** na fonte de produção.
3. **A migração assistida por IA over-stripou palavras de porção** que não cabem no enum de unidades: "4 folhas de alga nori" → "alga nori"; "2 folhas de louro" → "2 louro". **101 linhas** afetadas (91 quebradas na tela). É perda de **dado**, não só display.

Causa raiz do item 3: o **enum fechado** de unidades (`g/kg/ml/l/colher_de_sopa/colher_de_cha/xicara/dente/fatia/pitada/unidade/a_gosto/q_b`) **não representa** palavras de porção/recipiente abertas — "folha", "talo", "ramo", "maço", "lata", "punhado", "pacote", "vidro", "caixa". Quando a contagem é uma dessas, a "unidade" **pertence ao nome**, não ao campo estruturado.

Decisão (mantém `quantidade`/`unidade` como **fonte única da medida**; corrige a EXIBIÇÃO e repara o dado — **revoga só o "zero gramática" da unidade**):

- A exibição **compõe prosa natural com plural correto**, em "de":
  - não-contável: `"{qtd} {unidade flexionada} de {nome}"` — "3 dentes de alho", "200 g de farinha", "2 colheres de sopa de azeite". A flexão da **unidade** é um **rótulo plural estático** por unidade do enum (conjunto **fechado**, todas **regulares**: colher→colheres, dente→dentes, xícara→xícaras, fatia→fatias, pitada→pitadas; `g/kg/ml/l` invariáveis). Plural escolhido pela quantidade (qty ≠ 1 → plural; fração < 1 → singular). **Sem traço.**
  - contável (`unidade`): `"{qtd} {nome}"` — "2 cebolas".
  - `a_gosto`/`q_b`: **sufixo** — "sal a gosto", "farinha q.b.".
- **O NOME nunca é flexionado no render.** O nome já nasce concordando com a quantidade na geração/fonte; flexionar nome arbitrário no display quebraria os **plurais especiais** do pt-BR (-ão → -ões/-ãos/-ães **por dicionário**; -il, -s, -x, -m; concordância de sintagma "ovos mexidos"). A flexão de nome **sob escala** continua diferida ao **Ingrediente canônico** (formas singular/plural na tabela de tradução do ADR-0001) — não a um heurístico de string.
- **Números são formatados por locale** (`Intl.NumberFormat`): pt-BR vírgula, en-US ponto, **sem casas decimais forçadas** (zeros à direita cortados). Frações comuns viram **glifos** (½ ⅓ ⅔ ¼ ¾ ⅛…), inclusive misto ("2½ colheres"); o que não casa numa fração comum cai no decimal localizado. Vale pra exibição **e** pro formulário de edição (que cuspia o `numeric(10,3)` cru "3.000").

Reparo do dado existente (one-time, **ledgerado e reversível**, supera a migração com IA do PR #357):

- **Over-strip (101 linhas, 91 quebradas):** restauração **determinística** a partir do `before` do ledger — remove só o número líder (e a unidade do enum + conector, quando a unidade estruturada é do enum), **mantendo** a palavra de porção no nome ("folhas de alga nori", qty=4, `unidade='unidade'` → "4 folhas de alga nori"). **Sem IA.**
- **Cauda de plural da geração (~uma dúzia):** itens contáveis (`unidade` ou qty solta) com qty > 1 e nome no singular ("ovo" qty 10 → leria "10 ovo"). Decisão do dono: **não** flexionar o nome por código — **listar** essas linhas para correção humana (Curador no catálogo HITL; o dono nas suas). Zero risco de cuspir um "corações" errado.

Trade-off revisto: paga-se um rótulo plural estático por unidade (conjunto fechado, trivial) e um formatador de número/fração, em troca de **tom profissional** na superfície pública e **menos trabalho manual** do Curador. O "zero gramática" do Adendo anterior fica **revogado para a unidade**; o nome continua não-flexionado no render — a diferença é que a unidade é **fechada e regular**, o nome é **aberto e cheio de casos especiais**.
