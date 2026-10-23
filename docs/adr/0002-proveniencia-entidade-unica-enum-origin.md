# ADR-0002 — Proveniência da receita: entidade única com enum `origin` (não tabelas separadas)

Status: aceito

> **Atualização:** o enum `origin` cresceu, como este ADR previa ("admite uma origem futura sem migração de tipo"). O enum **real** (`src/domain/recipe.ts`) tem **seis** valores: `catalog`, `ai_chat`, `ai_structured`, `ai_free_text`, `user_edited`, `web_imported` (este via ADR-0019). Onde o glossário e outros ADRs falam em selo obrigatório de "`ai_*`", isso abrange `ai_chat`/`ai_structured`/`ai_free_text`. E "acompanha em toda superfície (busca, card, compartilhamento)" refere-se às superfícies **in-app**; o **OG/social card** minimiza rótulos de IA (é vitrine) — exceção deliberada do ADR-0020/0017.

Receita de catálogo e receita gerada por IA são a **mesma entidade** `Recipe`, distinguidas por um campo **`origin`** (`catalog | ai_chat | ai_structured | user_edited`) — **não** por tabelas separadas nem por um boolean `isAiGenerated`. As duas são buscadas, favoritadas e traduzidas de forma idêntica; a diferença é uma propriedade (origem + nível de confiança), não um tipo distinto. `origin` é **imutável** e acompanha a receita em toda superfície (busca, card, compartilhamento): a diferenciação "do catálogo" vs "gerada por IA" é de primeira classe e sempre visível ao usuário.

## Por quê

Modelar como duas entidades duplicaria busca, i18n e favoritos sem ganho e bifurcaria toda query. Um enum (vs boolean) admite uma origem futura (importada, comunidade) sem migração de tipo. "Diferenciar IA de original" é requisito de produto — atendido pelo campo + selo, não por separação estrutural.

## Consequências

- **Visibilidade** (privada/pública) e o ciclo de publicação/comunidade são eixos **separados** de `origin` — em definição num ADR próprio.
- Editar uma receita não muda sua identidade nem muta a base: gera uma **derivada** `user_edited` ligada à base — em definição num ADR próprio.
- O selo de origem precisa viajar especialmente no **pool da comunidade**, onde conteúdo de IA é mostrado a estranhos (ver ADR-0004, aviso de restrições — disclaimer, não verificação).

## Atualização (2026-10-23, #597): selo "texto gerado por IA" na página da receita

Achado 17 do parecer interno de 2026-10-22: a imagem de IA e a tradução automática levavam selo, mas o texto de uma Receita de IA publicada aparecia para terceiros sem indicação. A página da receita (`recipe-detail-view.tsx`) ganha o selo **"✨ texto gerado por IA"** ao lado do selo de seção, para qualquer visitante, no mesmo padrão visual do selo da imagem. A regra é `resolveAiTextSignal` (`src/domain/recipe-read.ts`), e o read model leva `textAiGenerated`:

- **`ai_chat`, `ai_structured`, `ai_free_text`:** sempre. O selo é obrigatório, como os outros de IA, e `origin` é imutável, então editar a própria Receita no lugar não o tira: é a postura conservadora do CDC art. 6º, III (quem lê confia em quantidades, tempos e alergênicos).
- **`user_edited` (derivada ou clone):** enquanto o texto do locale original for o da IA, isto é, a Tradução do `original_locale` tem proveniência `automatica_nao_revisada`. A regra lê só a própria Receita, então vale mesmo depois que a base é apagada.
  - O **clone** copia a proveniência da base e herda o selo.
  - A **derivada** ("Criar minha versão") perde o selo só quando reescreve o **preparo** (passos) no locale original: aí grava `escrita_por_pessoa`. Sem mudar o texto, ou mudando só título, descrição ou notas, a proveniência da base fica (`editedProvenance` em `derive.ts`), porque o modo de preparo (tempo, temperatura, técnica) ainda é o da IA. Mudar ingredientes ou quantidades não mexe na proveniência do texto, nem para pôr nem para tirar o selo. A derivada sempre herda o `original_locale` da base, então editar só outro locale também mantém o selo.
  - A **edição no lugar** pelo dono não mexe na proveniência e mantém o selo, como numa `ai_*`.
  - O **Curador** não revisa o locale original de uma `ai_*` nem de uma `user_edited` (`/translations/<locale>/review` responde 409 `texto_original`): ali `automatica_nao_revisada` quer dizer "texto da IA", não tradução, e revisar não o reescreve. Na `ai_*` o selo não depende disso, mas a cópia futura herdaria o `automatica_revisada` e o perderia.
- **`catalog` e `web_imported`:** nunca. O catálogo é assinado por um Curador (o aviso opcional de colaboração com IA segue à parte), e a importada é sempre privada.

**Lacuna conhecida: os cards** (busca, feed, coleções). O selo de seção de uma `ai_*` no card diz "Da comunidade", que não revela IA, e o da imagem só aparece quando a imagem é `ai_generated`; então um card de Receita de IA com foto do usuário não leva sinal de IA. São vários read models, e o critério da issue é a página pública; o card fica num follow-up (#618). O OG/social card segue sem rótulo de IA (ADR-0020).
