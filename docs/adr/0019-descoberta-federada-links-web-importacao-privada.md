# ADR-0019 — Descoberta federada: links da web quando o acervo é raso + importação privada (sem republicar) + ponte explícita para geração

Status: aceito

> **Atualização (ADR-0020):** onde este ADR diz que "o catálogo nasce **vazio** (não há seed)", leia "**nasce raso**". A iniciativa de SEO introduz um **seed AI-curado** (gerado pelo nosso AI + curadoria humana obrigatória → `origin=catalog`), **pré-requisito do marketing, não do friends-test**. A justificativa da ponte de links-da-web **sobrevive intacta**: o acervo é **raso** (não cobre a cauda longa de pratos tradicionais) no começo, e os links cobrem essa lacuna sem nos tornarmos republicadores. O invariante (importação privada, nunca pública) permanece.

> **Atualização (postura legal — pesquisa de 2026-06-24):** uma pesquisa jurídica com fontes (US/EU/BR) **confirma** esta postura como a de **risco baixo** e adiciona dois refinamentos **inegociáveis**. O eixo do risco **não é "de onde se busca", é "o que se copia"**: a **receita em si é fato não-protegível** (ingredientes + passos funcionais — *Publications Int'l v. Meredith*, 88 F.3d 473, 480; **Lei 9.610 Art. 8** + **TJ-SP**: "receitas culinárias não podem ser registradas"), mas a **camada expressiva é protegida** — a **foto** (vetor de infração **mais provável**) e o **`description`/headnote** (prosa). Refinamentos: **(1) Allowlist curado, não web aberta** — risco BAIXO vs MÉDIO; o allowlist deixa **vetar robots.txt/ToS site a site _antes_** (o risco vivo é contrato-via-ToS, já que CFAA não pega página pública pós-*hiQ*/*Van Buren*/*Meta v. Bright Data*). **(2) Não copiar a camada protegida** — o importador copia **só fatos** (ingredientes, passos, tempo, porções, cozinha); **NÃO** copia a **foto** (receita importada **nasce sem imagem** — o dono completa pela Galeria, ADR-0016) nem o **`description`/headnote** (fica em branco; o dono escreve o dele). **Atribuição é OBRIGATÓRIA, não opcional** — o **direito moral** de atribuição (Lei 9.610) existe mesmo onde o econômico é fraco; crédito+link derrota *passing-off* e ainda manda tráfego pra fonte. **Guard-rails (independem da postura):** respeitar robots.txt · User-Agent identificado (sem fingir browser) · rate-limit (~1 req/s/domínio) · **fetch só por ação explícita do usuário** (nunca crawl de fundo) · canal de **takedown** + remoção sob pedido · **LGPD**: guardar **só nome do autor + URL** (mínimo), base legal (legítimo interesse / dado manifestamente público) + botão de remoção do nome. **Caveat:** advogado de PI/LGPD brasileiro deve **assinar a postura final antes de ligar em produção** (sobretudo se um dia virar web aberta). Web aberta segue **possível**, mas como escalada posterior, com denylist de quem fizer opt-out.

A **Busca continua só encontrando e nunca cria** (invariante de ADR-0008 e do glossário, preservado). O que muda é que a **descoberta** ganha duas **pontes explícitas, sempre acionadas pelo usuário** — nenhuma delas é a Busca "criando":

1. **Gerar com IA** — CTA **permanente** (o mote do app), presente mesmo quando há resultados; leva à Sessão de criação (`/create`). Não dispara automático no zero-resultado.
2. **Links da web** — **quando o nosso acervo é raso/vazio**, a busca exibe **poucos resultados da web como _links externos_ marcados "da web", SEM armazenar nada** (comporta-se como um buscador, não como catálogo). O catálogo nasce vazio (não há seed; só Curador o popula manualmente), então essa ponte é o que cobre uma busca por prato tradicional no lançamento.

**Importação** acontece só quando o Usuário **clica num link e confirma**: o conteúdo é copiado para a **coleção privada** dele (`origin=web_imported`, `owner_id` = quem importou), guardando **URL/fonte de origem** para **atribuição**. A **Autoria** é creditada à **fonte externa** ("fonte: …"), nunca "por \<Usuário\>". A cópia usa o **dado estruturado que o site já publica** (schema.org/Recipe — JSON-LD); sem isso, fica **só link**, sem importar.

**Postura inegociável:** receita importada da web é **sempre privada e não-publicável**. O toggle de Visibilidade pública existe **só** para receitas **criadas pelo próprio Usuário ou geradas por IA**. *Exibir link ≠ importar; importar ≠ republicar.*

## Por quê

- O catálogo nasce **vazio** (sem seed; populado só por curadoria manual). Sem fonte externa, buscar uma tradicional ("feijoada") dá **zero** no lançamento. Links da web cobrem o vazio **sem** nos tornarmos um republicador de conteúdo alheio.
- A linha jurídica que segura tudo: **linkar** é como um buscador (risco baixo); **importar pro privado** é como um recortador de receitas pessoal (uso defensável); **republicar** conteúdo de terceiros no nome do usuário, no pool da comunidade, é o que **evitamos** — colidiria com **Visibilidade** ("pública quando o **próprio dono** autoriza") e **Autoria**, e abriria flanco de copyright.
- Ação **explícita** (clique) em vez de automática preserva "Busca nunca cria" e evita custo/latência de chamada externa **por tecla** na home (a tela mais usada). A web entra **só quando o acervo é raso** — conforme o acervo cresce, ela some sozinha.
- Importar via **JSON-LD** (que os sites já expõem pro Google) é robusto e estruturado; scraping arbitrário de HTML é frágil.

## Alternativas rejeitadas

- **Busca gera sozinha no zero-resultado** — quebra o invariante "Busca nunca cria" e dispara IA a cada busca vazia (a busca roda com debounce, a cada tecla). Rejeitada: vira ponte explícita.
- **Camada canônica de IA compartilhada** (IA gera "feijoada" pública/descobrível pra todos, sem dono) — viola Visibilidade (público exige o dono autorizar), inunda a descoberta com IA não-verificada e fere "catálogo = curado/editorial". Rejeitada: o compartilhado cresce por publicação opt-in + curadoria.
- **Permitir publicar a receita importada** (toggle público na importada) — republicar conteúdo de terceiros sob o nome do usuário. Rejeitada.
- **Importar/scrapear em massa pro catálogo** — copyright e fragilidade. Rejeitada: importação é cópia individual pro privado, sob ação do usuário.

## Consequências

- Nova entrada na **Proveniência imutável**: `web_imported` (migração de enum — ADR-0002 já previa "uma origem futura (importada) sem migração de tipo").
- Novos campos na Receita: **URL/fonte de origem** para atribuição.
- **Dependência externa nova** (busca/recuperação na web) + parser de JSON-LD. O **provedor e o conjunto de sites** ficam para a implementação e são **reversíveis** (o dado armazenado guarda só a URL de origem).
- "Gerar com IA" vira CTA proeminente e **hoje não há rate-limit** na geração de receita → recomenda-se **cap diário por usuário** (como já existe para imagem).
- Importada vive em **"Minhas criações"** marcada como importada; entra na camada **bilíngue** normal (locale de origem + tradução automática sinalizada).
- O **selo de proveniência** (ADR-0002) precisa cobrir `web_imported` em toda superfície, como os demais origins.
- Estende a superfície de descoberta de ADR-0008 (busca híbrida em Postgres) com fontes **fora** do nosso datastore — sempre como link, nunca misturando conteúdo externo não-importado ao ranking interno.
