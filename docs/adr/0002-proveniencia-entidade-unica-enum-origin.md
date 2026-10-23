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

**Cards (#618, 2026-10-23).** Os cards levam o mesmo sinal, calculado pela mesma `resolveAiTextSignal` nos três read models de card: `projectResult` (`recipe-search-read.ts`: Busca, "Talvez você queira", Descoberta, Seguindo, Receitas semelhantes, Receita da semana), `resolveRecipeListItem` (`recipe-list-read.ts`: Minhas receitas, Salvos e coleções) e `projectProfileRecipe` (`recipe-profile-read.ts`: perfil `/u/<handle>`). Cada um projeta `textAiGenerated` (ausente quando não). No card de lista (`RecipeResultItem`) o rótulo entra no kicker como sufixo, no lugar do de tradução automática ("Da comunidade · ✨ texto gerado por IA"): com o texto da IA, o original fica `automatica_nao_revisada`, que ali quer dizer texto da IA e não tradução, e o kicker não ganha um terceiro pedaço. Pelo mesmo motivo, a página da receita deixa de mostrar o "tradução automática" quando mostra o selo do texto. O selo do texto fica junto do título e o da imagem continua sobre a foto, então uma Receita de IA com foto do dono ainda leva o sinal. Em Minhas receitas e nos Salvos ele vira mais um selo neutro acima do título (os Salvos ganharam também o selo da imagem, que faltava), e no preview de 3 receitas do cartão de Cozinheiro (`recommended-cooks.ts`, também via `projectResult`) ele vai numa linha miúda sob o título. Ficam de fora as miniaturas do Cardápio e da Despensa (só o selo da imagem) e o OG/social card, que segue sem rótulo de IA (ADR-0020).
