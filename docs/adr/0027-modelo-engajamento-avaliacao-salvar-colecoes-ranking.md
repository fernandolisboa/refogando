# ADR-0027 — Modelo de engajamento: aposentar o Voto, Salvar+Coleções, Avaliação 1–5★ e ranking misturado (com `aggregateRating`)

Status: aceito

O app tinha três sinais de engajamento sobre uma Receita: **Voto** (binário, público, ordenava a descoberta — ADR-0003), **Favorito** (binário, privado, alimentava o ranking de Cozinheiros — ADR-0024) e nenhum sinal de **qualidade**. O dono pediu **comentários/reviews com foto do prato + nota 1–5★** e sinalizou que **o Voto deixou de fazer sentido** ("voto por voto não faz sentido; menos ainda o voto alimentar o rating"), preferindo um modelo onde **favoritar evolui pra salvar/coleções** (estilo Instagram). Esta ADR reorganiza o engajamento inteiro: **mata o Voto**, transforma o Favorito em **Salvar + Coleções**, introduz a **Avaliação** (nota genuína de 1–5★ + comentário + foto), redefine a **Popularidade** como uma **mistura ponderada** e — porque agora existe nota **genuína** — **liga o `aggregateRating`** do SEO, revertendo a decisão 7 do ADR-0020 pelo mesmo princípio que a motivou.

## Decisões

1. **O Voto binário é aposentado.** A tabela `recipe_vote`, o botão de like, o `voteCount` público e as rotas `/vote`/`/unvote` saem. Um like binário **não** vira nota 1–5 (não dá pra inferir estrela de um like) nem vira save (curtir ≠ querer salvar pra depois), então **não há conversão** — os votos são **descartados** (volume real ~zero, pré-lançamento).

2. **Favorito → Salvar + Coleções.** O **Salvar** é a relação privada (Usuário, Receita) — o bookmark — e **evolui direto** do `recipe_favorite` de hoje (mesma forma `(user_id, recipe_id)`): a linha de favorito **vira** a linha de save. Por cima entra a **Coleção**: agrupamento **nomeado, privado e opcional**, **M:N** (uma receita salva pode estar em 0+ coleções; salvar não obriga escolher coleção), estilo Instagram. Salva-se **qualquer receita que se vê** (pública, catálogo ou a própria, inclusive privada). Tudo **100% privado**: só a **contagem agregada** de saves entra na Popularidade (sem expor quem salvou nem a coleção), e **self-save não conta** no ranking (espelha o `user_id <> owner_id` que o `recommended-cooks` já aplica). **Coleção compartilhável/pública é deferida** (direção social futura).

3. **Avaliação (review) 1–5★.** Uma **Avaliação** = **nota 1–5★ obrigatória** + **comentário** (texto) opcional + **foto do prato cozinhado** opcional. **Uma por (usuário, receita)**, **editável**, ancorada na **identidade da Receita** (a mesma em todos os locales — como Voto/Report eram, FK pra `recipe.id`, nunca pra `recipe_translation`). Avaliável só em receita **pública da comunidade OU catálogo**; **exige conta**; **não se avalia a própria receita** (self-review barrado, como o self-voto era — catálogo `owner_id NULL` não tem dono, então nem incide). A **nota obrigatória** define a natureza da coisa: é uma *avaliação*, não um fórum de comentário (sem thread/resposta/@menção — isso multiplicaria a moderação e não foi pedido). O texto é **conteúdo do usuário**, **não** Tradução de receita: exibido como escrito, **não traduzido**.

4. **A foto da avaliação é entidade distinta da Imagem da receita, e é upload-only (sem IA).** A foto é **prova de autenticidade** ("eu cozinhei isto") — por isso **nunca** é gerada por IA: só **upload** (ou câmera no celular via `<input capture>`). Não tem eixo de proveniência (é sempre foto do usuário) e **não leva selo de IA**. É do **avaliador**, não do dono: **nunca** vira a cara pública da Receita (`recipe.image_id`) nem entra na Galeria/linhagem do dono. Reusa só o **cano de blob** (`ImageStore`, como o avatar — que já guarda blob fora de `recipe_image`). Uma foto por avaliação no v1.

5. **A Popularidade vira uma mistura ponderada — forma fixa, números calibráveis.** Com o Voto fora, a descoberta passa a ordenar por uma **combinação** de **volume de saves** (interesse), **nota média** e **volume de avaliações** (qualidade/confiança), com **recência** como salva-vidas das novas. A **forma** (quais sinais entram + como se combinam) e os **guarda-corpos** ficam fixos aqui; os **pesos e constantes são calibragem reversível** (ajustam-se no dado real), **não congelados no ADR** — alinhado com o ADR-0024 ("ranking é reversível"). Forma de referência:

   ```
   score(receita) = w_save·log(1+saves)
                  + w_nota·[ (v/(v+m))·R + (m/(v+m))·C ]   ← média Bayesiana
                  + w_novo·frescor(idade)
   ```

   Três **guarda-corpos inegociáveis**: (a) **confiança-por-volume** — a média Bayesiana puxa a nota pra média global `C` enquanto o volume `v` é baixo (5★ de 1 pessoa **não** passa 4,5★ de 200); (b) **novidade-neutra** — ausência de sinal **≠** sinal negativo: a receita nova senta na média global (≈`C`), sobe por **recência**, **nunca afunda** por ter 0 saves/0 nota; (c) **popularidade-sem-autoridade** — herda ADR-0003/0004: ordena descoberta, mas não vira garantia de segurança, não promove ao catálogo, não é controlada pelo dono. O ranking continua **dentro da seção** (catálogo e comunidade nunca se misturam num ranking cego — ADR-0003/0008).

6. **`aggregateRating` ligado — reverte a decisão 7 do ADR-0020, pelo mesmo princípio.** O ADR-0020 cravou JSON-LD **sem** `aggregateRating` porque *"Voto não é nota genuína de 1–5; forjar rating viola a política do Google"*. Isso estava **certo para aquele mundo** (voto binário). Agora existe **nota real de 1–5**, então o princípio ("não forjar") permanece e a decisão se inverte sem contradição. Regras: emite `aggregateRating` nas receitas **indexáveis** (mesmo gate noindex), **comunidade e catálogo**, sempre que houver **≥ 1 avaliação**; o número no markup é a **média CRUA + a contagem REAL** (`ratingValue`/`ratingCount`), **nunca** o Bayesiano (são **dois números, dois empregos**: Bayesiano só ordena, média crua é o que o usuário vê e o que vai pro markup — mostrar ao Google um número que o usuário não vê é o que leva ação manual); a estrela **tem que estar visível na página** (o detalhe mostra "★ 4,6 · 23 avaliações"). Itens **`review` individuais** no markup ficam **deferidos** (v1 = só agregado, o ganho grande e mais seguro).

7. **Moderação da Avaliação — reativa, unidade inteira, dono não censura.** Qualquer Usuário **reporta** uma avaliação abusiva pelo **mesmo caminho** `report → Curador` que já tira receita do pool. A **unidade de moderação é a avaliação inteira** (texto + foto juntos; flag `moderated_at/_reason/_by` na linha, idioma do `recipe_image`); moderar **só a foto** é refino deferível. Avaliação moderada **some do público** e **sai da conta** do `aggregateRating` e do ranking (a linha persiste — remoção lógica). O **dono da receita NÃO remove** avaliação da própria receita (só o Curador) — senão a nota vira vitrine e perde integridade; o dono **reporta como qualquer um**. O avaliador **edita/apaga a própria** avaliação. **Sem fila proativa** (`review_required` existe pra imagem de IA; foto de avaliação é upload, sem IA → só reativa; varredura automática de imagem fica como endurecimento futuro).

## Por quê

- **Matar o Voto > mantê-lo junto.** O dono rejeitou o voto-por-voto; e dois sinais públicos sobrepostos (um like **e** estrelas) confundem. Com a Avaliação trazendo nota genuína e o Salvar trazendo o sinal de interesse, o Voto fica **redundante** — não há o que ele faça que o par (save + nota) não faça melhor.
- **Salvar como interesse, Avaliação como qualidade — divisão limpa.** Save é de **baixa fricção** (um toque, sem cozinhar) → é o sinal de popularidade abundante que evita o **cold-start** de um ranking só-por-nota (avaliar dá trabalho, ainda mais com foto). A nota é **qualidade/confiança**. Cada um no seu papel.
- **Bayesiana resolve o medo do dono** ("não esconder receita nova como impopular") **e** o medo oposto ("5★ de 1 pessoa furar a fila"): novidade-neutra e confiança-por-volume são **o mesmo cálculo**. O dono descreveu exatamente a média ponderada por confiança sem saber o nome.
- **`aggregateRating` é o maior trunfo de SEO do recurso** — conteúdo (sobretudo **catálogo** editorial) com **nota real de usuário** é o que o rich result do Google premia. Reverter o ADR-0020 aqui **honra** o princípio dele (não forjar), porque agora a nota é genuína.
- **Dono não censura avaliação** preserva a integridade que o CONTEXT.md já exige da Popularidade ("não é controlada pelo dono") e da Moderação (ação do Curador, não do dono).
- **Foto sem IA** porque a foto da avaliação **é** a prova de autenticidade — deixar a IA gerá-la mataria o propósito. É o oposto da Imagem da receita (que pode ser `ai_generated`, ADR-0022).

## Alternativas rejeitadas

- **Coexistir (manter o Voto + adicionar a nota).** Menor blast-radius, mas deixa dois sinais públicos redundantes e o dono explicitamente quis o Voto fora. Rejeitada.
- **Voto alimentar/virar o rating.** O dono rejeitou de cara ("menos sentido ainda o voto alimentar o rating"); e um binário não é uma nota 1–5. Rejeitada.
- **Ranking só pela Avaliação.** Cold-start sério (poucos avaliam cedo → popularidade vira só recência) e média crua engana sem ponderar volume. Rejeitada a favor da mistura com saves + Bayesiana.
- **Coleção como pasta exclusiva (uma receita numa só).** Não bate com o modelo Instagram (um item em várias coleções) e é mais rígido. Rejeitada a favor de M:N + balde "Todos".
- **Foto da avaliação reusando `recipe_image`.** Confundiria a foto do avaliador com a cara pública da receita (do dono, na Galeria/linhagem). Rejeitada — entidade própria, só o cano de blob é compartilhado.
- **Dono podendo remover avaliações da própria receita.** Viraria espaço de marketing (apagaria todo 1★ honesto). Rejeitada — só o Curador remove.
- **`aggregateRating` com o score Bayesiano no markup.** Mostraria ao Google um número que o usuário não vê → risco de ação manual. Rejeitada — markup = média crua + contagem.
- **Itens `review` individuais no JSON-LD no v1.** Mais superfície e risco de política; o agregado já é o ganho grande. Deferido.

## Consequências

- **Schema (migração só GERADA; `.env.local` é PROD; migrate-on-deploy):**
  - **DROP `recipe_vote`** (sem conversão).
  - **`recipe_favorite` → `recipe_save`** (rename; mesma forma `(user_id, recipe_id)` + `created_at`).
  - **NOVO `collection`** `(id, user_id → users, name, created_at)`; **UNIQUE(user_id, name)**.
  - **NOVO `collection_item`** `(collection_id → collection, recipe_id → recipe, created_at)`; PK composta; **deletar o save remove de todas as coleções** (modelar como o save sendo a fonte de verdade do "salvo").
  - **NOVO `recipe_review`** `(id, user_id → users, recipe_id → recipe, rating smallint 1–5 NOT NULL, comment text NULL, photo_url text NULL, created_at, updated_at, moderated_at/_reason/_by)`; **UNIQUE(user_id, recipe_id)** (uma por par); **CHECK rating BETWEEN 1 AND 5**; consistência de moderação `(moderated_at IS NULL) = (moderated_by IS NULL)` + índice parcial (idioma do `recipe_image`). FK a `recipe.id` (cross-locale).
  - **`report`** passa a poder mirar uma **Avaliação** além da Receita (alvo polimórfico ou coluna nullable `review_id` — decisão de implementação; manter o leak-safe).
  - **Vigiar o `.sql` gerado** (histórico de DDL fantasma do Drizzle).
- **Ranking re-fiado:** `search.ts` (sort "popularidade", hoje `vote_count`) e `recommended-cooks.ts` (`apreço = votos + favoritos`) passam a ler a **mistura** (saves + Bayesiana + frescor), com self-save/self-nota excluídos. **Emenda ADR-0024** (o `apreço` muda de fonte). A **média Bayesiana** precisa do `C` global (média de todas as notas) e do `m` (config) — números calibráveis.
- **SEO:** `recipe-seo.ts` emite `aggregateRating` (média crua + contagem) sob o mesmo gate de indexação; remover o comentário "Voto ≠ nota, nunca vira aggregateRating (#234)". A **nota tem que aparecer na página** (detalhe mostra ★ + contagem). **Reverte a decisão 7 do ADR-0020** (nota de status lá).
- **UI:** sai o botão de like / `voteCount`; entram (a) o controle de **Avaliação** (estrelas + comentário + upload/câmera de foto) no detalhe, (b) a lista de avaliações + média/contagem visíveis, (c) o **Salvar** com escolha de **Coleção** (balde "Todos" + coleções nomeadas), (d) a gestão de coleções. O detalhe público é renderizado anônimo/cacheável (ADR-0020) → o estado do viewer (salvou? avaliou?) hidrata no cliente, como o voto/favorito já faziam.
- **Migração de dado:** favoritos → saves (1:1, em "Todos"); votos descartados. Pré-lançamento, baixo risco.
- **Amendas:** **ADR-0003** (Voto aposentado; popularidade vira mistura), **ADR-0020** (decisão 7 revertida — `aggregateRating` ligado), **ADR-0024** (fonte do `apreço`), **ADR-0011** (capacidades de papel: vota/favorita → avalia/coleciona) e **ADR-0014** (RBAC fica 3-tier; superadmin deferido). Notas de status adicionadas em cada um.
- **Glossário:** Popularidade (reescrito), Avaliação, Foto da avaliação, Salvar/Receita salva, Coleção (novos); Voto/Favorito aposentados.
- **Não implementado** — é a direção da iniciativa; a fatia de execução vem depois (PRD → issues).
