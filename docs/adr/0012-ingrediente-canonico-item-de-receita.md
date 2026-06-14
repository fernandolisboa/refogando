# ADR-0012 — Ingrediente canônico e item-de-receita

Status: aceito

"Ingrediente" são **dois conceitos**, modelados como duas entidades:

- **Item de receita** (`RecipeIngredient`) — a ocorrência dentro de uma Receita: **quantidade** (numérica) + **unidade** + nota de preparo, mais o `raw_text` (o que a IA/fonte disse). Pertence ao agregado Receita. Quantidade e unidade são **invariantes** (não traduzíveis); a unidade vem do Vocabulário culinário (kernel de enums). O texto do item é conteúdo traduzível (ADR-0001).
- **Ingrediente** (canônico) — entidade **language-neutral**, id estável, com nome/aliases traduzidos pela **mesma tabela de tradução** do ADR-0001 e dado de **alérgeno opcional/oportunista** (ADR-0004). Habilita a busca por ingrediente cross-locale (ADR-0008) e o aviso de contradição óbvia.

## Ligação

O item referencia o canônico por **FK opcional, resolvida best-effort** — a IA cospe texto livre e não se pode travar a geração quando um ingrediente não resolve. Item não-resolvido fica só com `raw_text` (exibe normal); a busca por ingrediente **degrada para FTS** quando não há canônico, e o aviso de alérgeno só dispara quando há canônico com dado. Um pipeline de normalização (texto-livre → ingrediente_id) cresce a base canônica por **curadoria** (papel Curador, ADR-0011).

## Por quê

Conflacionar os dois faria a busca por ingrediente virar matching de string frágil e impediria o aviso de alérgeno. Mas exigir canônico no dia 1 travaria a IA — daí a FK opcional best-effort. O diff da derivada (ADR-0005) exige o item **estruturado**, não prosa. Este é o último pré-requisito do schema canônico de Receita (ADR-0009).
