# ADR-0019 — Descoberta federada: links da web quando o acervo é raso + importação privada (sem republicar) + ponte explícita para geração

Status: aceito

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
