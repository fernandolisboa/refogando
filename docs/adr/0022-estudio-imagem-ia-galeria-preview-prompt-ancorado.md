# ADR-0022 — Estúdio de imagem por IA: galeria re-selecionável + preview-como-seleção + prompt ancorado + sinal de revisão + cost-tracking

Status: aceito

A geração de imagem por IA evolui de **"uma imagem corrente, gera-e-aplica, descarta a anterior"** para um **estúdio de imagem**: uma **galeria re-selecionável** por receita, **preview** antes de aplicar (= selecionar), **prompt sempre ancorado na receita**, um **sinal proativo de revisão** para gerações refinadas, e **cost-tracking** do custo real. Evolui o ADR-0016 (Imagem da receita) e o ADR-0017 (contrato de geração de imagem).

## Decisões

1. **Galeria re-selecionável (modelo unificado preview+histórico).** Cada Receita (linhagem) tem uma **Galeria de imagens** (uploads + geradas). Gerar/enviar **acrescenta** à galeria e **nunca descarta** a anterior; uma imagem é a **selecionada** = a única face pública. **"Aplicar" = selecionar** (repontar `image_id`, custo zero); **preview** = ver a recém-gerada **antes** de selecioná-la (a face exibida só muda no "Usar esta"). Re-selecionar uma antiga é livre e instantâneo. O Owner pode **apagar** itens da galeria (o auto-descarte de hoje, `reapOrphanImage` ao trocar, **sai de cena**; deleção vira ação manual). **Escopo: por linhagem** (versões regeneradas/editadas compartilham a galeria, espelhando o carry-forward); uma **Receita derivada** de outro nasce com galeria **vazia** (não herda a galeria privada do dono original). A galeria **em si nunca é pública** — só a selecionada.

2. **Prompt sempre ancorado na receita + composição estruturada.** O servidor **sempre compõe** `base = buildDishImagePrompt(receita)` + um **refino opcional** do Owner como **sufixo de estilo** (limitado a 200 chars), num **template estruturado** que reforça *"o prato é o sujeito fotográfico principal; o seguinte é só nota de estilo"*. O refino **nunca substitui** o base (o stopgap #214 já matou o `||`; este ADR endurece pra template estruturado). O **refino em texto livre é mantido** (flexibilidade: "meu prato em anime"). Validação de saída (checagem de visão "isto é o prato?") fica **deferida** (custo+latência por geração).

3. **Sinal proativo `review_required` + primeiro gancho de restrição do autor.** Geração por IA **com refino do Owner** marca a imagem com **`review_required`** — sinal **proativo** (distinto do Report reativo) que a **surfa pra fila do Curador**, **sem bloquear** (default-open intacto; é o sinal que o ADR-0020 já previu "só pra anomalias"). Ante **abuso confirmado**, o Curador aplica a **primeira restrição de conta**: **bloquear a geração de imagem por IA** daquele Usuário. A **escada completa** (escalar pra bloqueio de geração-de-receita e, por fim, da conta) é **follow-up** — ativa o ADR-0007 como subsistema próprio de restrições de conta.

4. **Cost-tracking.** Capturar o `usageMetadata` do Gemini (contagens de token: prompt / output-incluindo-imagem / thinking / total) + o **modelo** na **linha do ledger `image_generation`** que já existe por geração, mais um **`cost_usd` snapshot** computado na hora a partir de uma **tabela de preço no código** (snapshot porque o preço muda). O **cap continua por contagem** (#167) por ora; o dado habilita, **depois**, um cap por **orçamento de tokens** e/ou um painel de custo no admin (follow-up). **Re-selecionar não gera linha no ledger nem custo.**

## Por quê

- **Galeria > preview-efêmero:** o pedido evoluiu de "preview que descarta" para "manter o histórico re-selecionável". A galeria **subsome** o preview (a recém-gerada fica na galeria, só não está selecionada) e **elimina** o problema de blob temporário/GC. O custo de armazenar tudo é desprezível: Vercel Blob ≈ $0,023/GB-mês → uma imagem (~1,5 MB) ≈ $0,000035/mês, enquanto **gerá-la** custa ≈ $0,077 (Gemini). O caro é gerar, e isso **já tem cap** (#167). Logo: guarda tudo, sem cap de storage; um cap de quantidade futuro seria por **arrumação** (UX), não custo.
- **Por linhagem:** casa com o carry-forward de imagem que já existe e com a intenção do Owner de "voltar nas antigas" mesmo após regenerar o conteúdo. Derivada fresca preserva propriedade/privacidade (as gerações são do dono original).
- **Ancorar sempre:** o abuso (gerar imagem nada-a-ver tipo anime do Goku numa receita de bife) vinha do override **substituir** o prompt. Compor sempre, com o prato como sujeito, fecha o vetor de maior impacto mantendo o refino de estilo que o Owner quer.
- **Sinal proativo não-bloqueante > gate:** o dono reverteu **2×** gates de curadoria-antes-de-publicar ("não sou burocrata", ADR-0020). A flag de revisão respeita isso: a imagem **funciona**; o Curador **monitora** as refinadas e remove/age **reativamente**. A teeth real fica na **restrição do abusador** (ADR-0007), não em gatear conteúdo.
- **Cost-tracking sem trocar o cap agora:** capturar o uso real é barato e reversível, e desbloqueia decisões futuras de pricing/cap sem comprometer-se com elas hoje.

## Alternativas rejeitadas

- **Preview efêmero que descarta a rejeitada** (o #3 original) — superado pela galeria (o dono quis manter o histórico). Exigia blob temporário + GC sem ganho.
- **Galeria por versão** (cada regeneração começa do zero) — perde o histórico ao regenerar; contradiz "voltar nas antigas".
- **Validação de saída por visão a cada geração** (a mais forte) — custo + latência por geração, desproporcional a um resíduo que privado+cap+moderação já contêm. Deferida; reativável se o abuso aparecer.
- **Vocabulário fixo de estilo** (dropdown em vez de texto livre) — elimina injeção mas perde o refino em palavras do Owner ("meu prato em anime"). Rejeitada.
- **Gate de publicação a partir do `review_required`** — contradiz a indexação default-open (ADR-0020). Rejeitada: é fila proativa, não bloqueio.
- **Escada completa de bloqueios (imagem→receita→conta) já nesta fatia** — toca papéis/conta amplamente; vira subsistema próprio. Só o gancho enxuto (bloquear geração de imagem) entra agora.
- **Cap de storage por usuário agora** — storage é desprezível; o cap de geração já segura o custo. Reversível no futuro, por UX.

## Consequências

- **Schema (migração — só gerar, migrate-on-deploy):** `recipe_image` ganha associação à **linhagem** (a galeria = imagens da linhagem) e deixa de ser auto-reapada ao trocar; a **selecionada** segue sendo `recipe.image_id` (carry-forward por versão); flag **`review_required`** na imagem (ou na geração); colunas de **uso/custo** no ledger `image_generation` (tokens + modelo + `cost_usd`); flag de **restrição de conta** "geração de imagem bloqueada". O mecanismo exato (coluna `lineage_root_id` em `recipe_image` vs tabela de associação) fica pro PRD/migração.
- **`reapOrphanImage` muda:** não descarta ao trocar; o blob só some na **deleção manual** do Owner quando nenhuma versão referencia.
- **Seam `ImageGenerator` (ADR-0017) evolui:** `generateDishImage` passa a **retornar o `usageMetadata`** (hoje só os bytes); a composição do prompt vira **obrigatória no servidor** (já iniciada em `composeImagePrompt`, #214).
- **ADR-0016 evolui:** "Imagem da receita" passa de "1 corrente" para "Galeria + selecionada"; a moderação por-imagem (#133) interage com a galeria (moderada fica na galeria do Owner, não vira face pública).
- **UI:** "Gerar com IA" abre o **modal de preview**; nele um botão menos-destacado mostra o **prompt-base read-only** + campo de refino; a galeria lista as imagens com **selecionar/apagar** e o selo "gerada por IA"; o cap #167 e a mensagem amigável valem; preview não troca a face até "Usar esta".
- **Curador:** nova fila/visão das gerações **refinadas** (`review_required`) + a ação **"bloquear geração de imagem por IA deste usuário"**.
- **Follow-ups:** validação de saída por visão; cap por orçamento de tokens + painel de custo; a escada completa de restrições de conta (ADR-0007); cap de quantidade da galeria (UX).

## Atualização (image-to-image: editar a partir de outra imagem)

Evolução pedida pelo Owner: além de **gerar do zero**, **editar a partir de uma imagem existente** — selecionar uma imagem da Galeria como **imagem-base**, escrever um **refino** (que aqui é **instrução de edição**) e gerar uma **variante editada**. O modelo Flash Image (`generateContent` multimodal) já suporta entrada imagem+texto; o seam é que era texto-puro. Decisões:

1. **Edição ANCORADA na receita (não edição livre).** A imagem-base vira **tela de partida**, mas o servidor **continua afirmando o prato como sujeito** — mantém o anti-abuso da dec.2: compõe um template do tipo *"esta é uma foto de `<prato>`; aplique apenas este ajuste, mantendo uma foto realista do prato: `<refino>`"*. O refino é instrução de edição, **nunca** substitui o prato — a contenção do resíduo é a **mesma** de hoje (`review_required` + moderação + privado + cap), **sem gate novo**. *Rejeitado: edição livre (imagem-base como único sujeito) — reabriria o vetor "anime do Goku" que a dec.2 fechou de propósito.*

2. **Parentesco por-imagem: `source_image_id`.** A imagem editada grava um **ponteiro nullable** pra imagem-base (`source_image_id`, auto-FK em `recipe_image`) — **primeira relação imagem→imagem** do modelo (a galeria segue agrupando por `lineage_id`; isto é parentesco **fino dentro** da linhagem). Só se paga porque é **surfado** (o affordance "editada de" + o selo da dec.3). *Proveniência impossível de reconstruir depois ⇒ capturar na criação; sem surface, não gravaria.*

3. **Selo distinto "Editada com IA" (derivado, sem coluna nova).** `source_image_id IS NULL` ⇒ **"✨ Gerada por IA"** (do zero); `source_image_id IS NOT NULL` ⇒ **"✨ Editada com IA"**. Ambos **obrigatórios in-app** e ambos **omitidos no OG/social card** (mesma exceção do ADR-0020). A divulgação da intervenção de IA é garantida pela **saída**: a variante é **sempre `ai_generated`** — mesmo editando uma **foto real** (`user_photo`) como base, a saída leva o selo (nada de "lavar" IA como foto real).

4. **Fonte = qualquer imagem da Galeria, inclusive moderada.** Editar a partir de uma imagem **moderada** (#133) é **permitido**, mas a variante **re-entra na revisão** (`review_required`, automático: toda edição tem refino) — o Curador a vê na fila e, via `source_image_id`, enxerga que **nasceu de uma moderada** (escrutínio extra). *Considerado e rejeitado: bloquear edição de fonte moderada — o Owner preferiu liberar com a rede do review reativo, não fechar o caminho.*

5. **O resto segue o estúdio (sem decisão nova):** a variante nasce **preview** (não auto-selecionada; só vira face no "Usar esta"), **consome o cap** e **escreve o ledger** `image_generation` (mesmo cost-tracking da dec.4), e é **escopada à Galeria do Owner** (linhagem) — não dá pra editar imagem de outro.

**Fronteira (não confundir): editar uma imagem ≠ Receita derivada.** Editar a **imagem** é eixo da **Galeria** (uma `ai_generated` a mais na mesma linhagem); **não** toca a identidade nem a proveniência da **Receita** (não forka, não vira `user_edited`). "Editar a partir de" (imagem) é deliberadamente distinto de "derivar/forkar" (receita).

### Consequências (delta)
- **Schema (migração — só `db:generate`, migrate-on-deploy):** `recipe_image` ganha `source_image_id uuid NULL` (auto-FK pra `recipe_image`, `ON DELETE SET NULL` — apagar a base não apaga a variante).
- **Seam `ImageGenerator`:** `generateDishImage` aceita uma **imagem-base opcional** (bytes + contentType) → vira uma `inlineData` part ao lado do texto na chamada Gemini; `composeImagePrompt` ganha a variante "edição" do template. Os fakes de teste acompanham.
- **Rota:** `POST .../image/generate` aceita um **`sourceImageId`** opcional; o servidor carrega o blob da imagem-base (own-gated, mesma linhagem) e o passa pro seam. `hasRefino`/`review_required` seguem como hoje (edição sempre tem refino).
- **UI:** na Galeria, cada imagem ganha **"Editar a partir desta"** → abre o campo de refino como **instrução de edição**; o preview do resultado mostra o selo **"Editada com IA"** e o "editada de".
- **Rollout do selo (dec.3):** a v1 entrega o selo distinto **"Editada com IA"** no **estúdio do Owner** (galeria + preview da edição) — onde o Owner gerencia as variantes. As superfícies **públicas** (detalhe/busca/feed/minhas-criações) mantêm **"Gerada por IA"** por ora (a divulgação **obrigatória de que é IA é preservada**; só a granularidade gerada-vs-editada fica para depois, pra não fiar o `source_image_id` da selecionada por ~5 read-paths, incl. as superfícies SSR-indexáveis). Surfar "Editada com IA" no público é **follow-up**.
- **Follow-up:** o selo "Editada com IA" nas superfícies públicas (acima); histórico de edição encadeado (a cadeia `source_image_id`); mostrar a imagem-base lado-a-lado no preview.
