# ADR-0021 — Overhaul de UX criar/editar: editar = modal in-place, criar = drawer-wizard, `/create` vira shell de deep-link, visibilidade comita no Salvar

Status: aceito

A criação e a edição de receita migram para **dois contêineres, mesma pele**, deixando a tela de detalhe **só-leitura** (estilo Instagram, #161):

- **Editar = modal centralizado**, tarefa focada e fechada. Editar a própria receita é **in-place** (`PATCH /api/recipes/[id]`, `owner-edit.ts`) — a mesma Receita é alterada, **nunca forka** (derivar só ao editar uma que não é sua; ADR-0005).
- **Criar = drawer da direita + wizard**, tarefa exploratória e multi-etapa, aberto por cima da Busca. É **reorganização da geração por IA que já existe** — os três caminhos mapeiam aos três modos da Sessão de criação (`structured` / `free_text` / `conversation` → `ai_structured` / `ai_free_text` / `ai_chat`). **Não há autoria manual nem proveniência nova**; "digitar receita do zero sem IA" foi descartado por ora (exigiria um `origin` novo + ADR próprio).

Isto é UX reorg, não expansão do modelo de domínio: nenhuma migração de schema nesta fatia.

## Decisões

1. **Padrão de contêiner.** Editar e criar deixam de viver inline. O detalhe vira só-leitura; "Editar" (sua receita) / "Criar minha versão" (de outros, que continua sendo derivação) abrem o modal; "Criar" no nav abre o drawer. Mesma linguagem visual (kicker em versalete, tokens, botões) pros dois lerem como irmãos. Base técnica: o `Sheet` Radix já existente (`src/components/ui/sheet.tsx`, com `SheetDescription` para a11y, #181).

2. **`/create` vira shell de deep-link, não é deletada.** A rota continua existindo como Server Component fino cujo trabalho passa a ser **abrir o drawer de criação**, semeado por `?q` (ponte "gerar com IA" da Busca, #166), `?resume` e `?mode=conversa` (alvo de recuperação hard-coded de retomada de conversa). Morre o *interior* de página inteira; a URL e seus três deep-links sobrevivem. **O seam de heading/foco (máquina de um-`h1`-só, `headingRef`) continua sendo dos componentes internos** montados dentro do drawer — não sobe pro shell do `Sheet` (F1 CANCELADO do `PARITY-PLAN.md` se mantém).

3. **Escopo do modal de edição.** O modal é dono de: **conteúdo** (título, descrição, ingredientes, passos, facetas da tabela `recipe` — cozinha/categoria/restrições/porções/dificuldade), o **toggle de Visibilidade** e o **Apagar**. Ficam **inline** no detalhe só-leitura: o **gerenciador de foto** (invariante ADR-0016, com cap próprio de geração e o banner de revisão #131) e o **lineage/regenerar** (navega pra fora — é fork, não edição de conteúdo). Em `web_imported` e `playful` o toggle de público **nem aparece** (ADR-0019/#168, ADR-0013).

4. **Visibilidade comita no Salvar, por request separado.** Dentro do modal, o toggle de Visibilidade é **rascunho local** — clicar nele **não** dispara nada no servidor. No **Salvar**, a orquestração roda em ordem: **(1)** `PATCH` do conteúdo → **(2)** *só se a visibilidade mudou*, `POST /publish | /unpublish`. Mantém-se a **fronteira de domínio** (`owner-edit.ts` nunca toca `visibility`; ADR-0003). Falha parcial (PATCH ok, publish 422 por estado velho) deixa o **conteúdo salvo** e exibe só o erro da visibilidade — ordem conteúdo-primeiro = a falha menos surpreendente. O controle inline de visibilidade de hoje deixa de existir nessa superfície (no detalhe fica, no máximo, um chip de status não-clicável).

5. **Espera/erro/cap do drawer.** A geração `structured`/`free_text` é **bloqueante (~8–15s, sem streaming)**; só `conversation` streama (NDJSON, reusa `useConversationChat`). O drawer **fica aberto e bloqueante** com estado honesto ("Refogando sua receita…", sem barra de progresso falsa) — não dá pra navegar pro detalhe antes do POST devolver `recipeId`. **Cap estourado (429)**: mensagem amigável, **neutra de janela** ("por enquanto"), **dentro** do drawer, form **não trava** (o 429 é checado antes do Claude → nunca consome cap). **Retry grátis** só após falha que **não consumiu cap** (`invalid`/502 e validação 400); `degraded`/`impossible`/`playful` são **desfechos terminais** (a chamada ao Claude aconteceu → consumiu cap), não "erro pra repetir". As guardas anti-duplicação (`status==='loading'` re-entry; `loadFailed` sem re-submit) carregam pro drawer. As rotas de geração ganham **`maxDuration=60`** (hoje sem `maxDuration` → default 10s no Vercel Hobby pode matar uma chamada opus longa e devolvê-la como erro neutro ambíguo).

## Por quê

- **Dois contêineres, não um:** editar é fechado e focado (modal central); criar é exploratório e multi-etapa, e abrir por cima da Busca preserva o contexto atrás (drawer). Forçar os dois no mesmo contêiner perde uma das duas posturas.
- **Não deletar `/create`:** três deep-links vivos apontam pra ela (a ponte #166 da Busca, `?resume`, e o link de recuperação `/create?mode=conversa` hard-coded em `conversa-focused-view.tsx`). Deletar quebraria os três sem ganho de domínio; manter como shell que abre o drawer preserva a história de SSR/shareable e a fronteira de `<Suspense>` que já existe.
- **Visibilidade fora do PATCH:** `owner-edit.ts` já isola "nunca toca `origin`/`owner_id`/`visibility`", e os gates de público (`web_imported`/`playful` nunca públicos) moram no domínio de visibilidade (ADR-0019/0013). Dobrar visibilidade no contrato do PATCH apagaria essa fronteira; comitar por request separado no Salvar a preserva e ainda dá ao usuário o modelo de formulário esperado (nada efetiva até o Salvar).
- **Foto fica inline:** é invariante (ADR-0016), são três ops assíncronas com **cap próprio** (429+countdown) e acoplam o banner de revisão #131 — não cabe como passo síncrono de "Salvar"; reconstruí-la dentro do `Sheet` seria custo alto por ganho marginal.
- **Espera bloqueante honesta:** a geração é bloqueante por natureza; não há URL de receita antes do POST voltar, então fechar-otimista/navegar-durante exigiria inventar uma superfície pendente que não existe. Spinner honesto + cap/erro no próprio drawer reaproveita o fluxo já provado da `/create`.

## Alternativas rejeitadas

- **Deletar `/create` e centralizar a entrada na Home (`?open=create&q=…`)** — quebra os três deep-links, força contrato novo na Home e perde SSR/shareable de criar. Rejeitada: vira shell de deep-link.
- **Dobrar a Visibilidade dentro do `PATCH` de conteúdo** — apaga a fronteira de `owner-edit.ts` e mistura os gates de público no contrato de edição. Rejeitada: comita por `publish`/`unpublish` separado no Salvar.
- **Toggle de visibilidade otimista/imediato dentro do modal** — efetivar mudança de servidor com o modal aberto contradiz o modelo "o Salvar efetiva tudo". Rejeitada: toggle é rascunho até o Salvar.
- **Puxar o gerenciador de foto pra dentro do modal** — reconstrói três ops assíncronas + cap próprio + multipart dentro do `Sheet`, brigando com ADR-0016 por ganho marginal. Rejeitada: foto fica inline.
- **Fechar-otimista / navegar pro detalhe durante a geração** — não há `recipeId`/URL antes do POST voltar; exigiria superfície pendente + polling inexistentes. Rejeitada.
- **Barra de progresso falsa** — não há sinal de progresso real numa chamada bloqueante única; insinuaria streaming que não existe. Rejeitada: spinner honesto.
- **Adicionar "tempo de preparo" / autoria manual / proveniência nova nesta fatia** — todas exigem schema/ADR próprios. "Tempo de preparo" foi diferido como fatia própria (#188); autoria-do-zero-sem-IA fica descartada por ora.

## Consequências

- O detalhe perde os blocos inline de **edição** e de **controle de visibilidade**; ganha (no máximo) um **chip de status** de visibilidade não-clicável. Foto e lineage seguem inline.
- O fluxo **#131** (`imageReviewSuggested`) se mantém: salvar campo visual → modal fecha → o detalhe mostra o banner de revisão de foto inline (a foto não está no modal).
- **Testes de heading:** os ~8 testes da máquina de um-`h1` continuam válidos (renderizam componentes, não a rota); ganham **uma** asserção nova — após gerar dentro do drawer, o foco vai pro `h1` do nome da receita, sem ser roubado pelo foco inicial do Radix no `SheetContent`.
- **i18n (ADR-0001):** chaves novas do drawer/modal (navegação do wizard, "Refogando sua receita…", rótulos de visibilidade-no-modal, cópia de cap/erro) entram em **pt-BR e en-US** com paridade.
- **jsdom (testes UI):** qualquer primitiva Radix nova (Dialog central do modal, `ToggleGroup` da visibilidade) precisa dos polyfills (`ResizeObserver`/`PointerCapture`/`scrollIntoView`) em `test/ui/setup.ts` antes do render.
- **Config:** `maxDuration=60` nas rotas `/api/generations` e `/api/conversations/stream` — reversível.
- **Glossário:** `CONTEXT.md` corrigido (defasagem pré-existente do #88) — Proveniência ganha `ai_free_text`; Sessão de criação passa a `conversation | structured | free_text`; novo termo **Modo prompt aberto**; contraste **edição própria é in-place** na Receita derivada.
- **Diferido:** "tempo de preparo" como atributo invariante da Receita → issue #188 (`needs-triage`), fatia própria com grill→ADR→migração.
