# ADR-0002 — Proveniência da receita: entidade única com enum `origin` (não tabelas separadas)

Status: aceito

> **Atualização:** o enum `origin` cresceu, como este ADR previa ("admite uma origem futura sem migração de tipo"). O enum **real** (`src/domain/recipe.ts`) tem **seis** valores: `catalog`, `ai_chat`, `ai_structured`, `ai_free_text`, `user_edited`, `web_imported` (este via ADR-0019). Onde o glossário e outros ADRs falam em selo obrigatório de "`ai_*`", isso abrange `ai_chat`/`ai_structured`/`ai_free_text`.

Receita de catálogo e receita gerada por IA são a **mesma entidade** `Recipe`, distinguidas por um campo **`origin`** (`catalog | ai_chat | ai_structured | user_edited`) — **não** por tabelas separadas nem por um boolean `isAiGenerated`. As duas são buscadas, favoritadas e traduzidas de forma idêntica; a diferença é uma propriedade (origem + nível de confiança), não um tipo distinto. `origin` é **imutável** e acompanha a receita em toda superfície (busca, card, compartilhamento): a diferenciação "do catálogo" vs "gerada por IA" é de primeira classe e sempre visível ao usuário.

## Por quê

Modelar como duas entidades duplicaria busca, i18n e favoritos sem ganho e bifurcaria toda query. Um enum (vs boolean) admite uma origem futura (importada, comunidade) sem migração de tipo. "Diferenciar IA de original" é requisito de produto — atendido pelo campo + selo, não por separação estrutural.

## Consequências

- **Visibilidade** (privada/pública) e o ciclo de publicação/comunidade são eixos **separados** de `origin` — em definição num ADR próprio.
- Editar uma receita não muda sua identidade nem muta a base: gera uma **derivada** `user_edited` ligada à base — em definição num ADR próprio.
- O selo de origem precisa viajar especialmente no **pool da comunidade**, onde conteúdo de IA é mostrado a estranhos (ver ADR-0004, aviso de restrições — disclaimer, não verificação).
