# Handoff 85 — Termos de Uso v1 com idade mínima de 16 anos (#276)

**Sessão:** 2026-10-23. **Branch:** `claude/project-thread-yl7417`, sobre a main em `e1a3c37`, que já tem os três PRs do sign-off: PR A, #607 (#473/#596, ADR-0050 e handoff 83); PR B, #608 (#595); PR C1, #612 (#276, política v3 e handoff 84). **Migração:** nenhuma. **Ordem de merge:** A → B → C1 → **C2 (este)**. A decisão e os riscos estão no **ADR-0051**; o fundamento, no parecer interno §7, §8, §10 item 2 e §11.

## 1. Escopo

- **Termos de Uso v1** em `/termos` e `/en-US/termos`: seção `termos` de `src/i18n/messages/pt-BR.ts` (texto aprovado, com os ajustes da §4) e `en-US.ts` (tradução fiel, mesmas chaves e tamanhos); componente `src/components/legal/terms-of-use.tsx` (11 seções em `<h2>`, negrito do CDC art. 54 pelo conjunto `DESTAQUES`, rodapé com versão e data); página `src/app/[locale]/(com-carregamento)/termos/page.tsx`. Indexáveis, no sitemap (`src/domain/sitemap.ts`), no rodapé (primeiro link legal, `src/components/site-footer.tsx`) e em `CLIENT_ROUTE_TREE` (`src/domain/error-report.ts`).
- **Linha do cadastro** (`auth.privacidadeCadastro`, `src/components/auth/auth-form.tsx`): "Ao criar a conta, você declara ter 16 anos ou mais e concorda com os {termos}. A {privacidade} explica como tratamos os seus dados." Links prefixados com o locale, `text-sm`, sem caixa de marcar; logo acima do "Criar conta" no cadastro e depois do Google no "Entrar"; os dois botões que criam conta têm `aria-describedby="auth-privacidade"`.
- **Política v3.1:** nova seção 9 "Crianças e adolescentes"; "Alterações" vira a 10 (`s10Titulo`, `s10Corpo`, `s10Historico`, com a linha v3.1); item 3.1, base legal "execução de contrato com o titular (os Termos de Uso)"; `s1Corpo[0]` com `https://www.refogando.com`; item 8 (localStorage) diz que o navegador lembra os avisos de mudança. Rodapé `v3.1` também em `seusDireitos`.
- **Aviso de mudança no app** (`src/components/legal/legal-change-notice.tsx`, no layout `[locale]`, dentro do `#conteudo` antes da página): só com sessão e conta criada até o fim do dia `DATA_PUBLICACAO_TERMOS_V1` (2026-10-23) em Brasília, isto é, antes da meia-noite que abre o dia seguinte (`AVISO_LEGAL_CONTAS_ANTES_DE_MS`). "Entendi" grava `refogando:aviso-legal:termos-v1+politica-v3.1:<userId>` e leva o foco ao `<h1>`; excluir a conta apaga essa chave junto com a do tour.
- **Notificação na fila da curadoria:** remover uma imagem da fila proativa (`applyReviewImageModeration`, `src/server/curate/review.ts`) emite `image_moderated` ao dono da receita representativa da linhagem (a mesma do LATERAL de `listReviewQueue`). Era o único caminho de retirada sem aviso, e os Termos (8[2]) prometem a notificação. A busca desse dono roda depois do commit, num try/catch: se falhar, a moderação vale e só a notificação se perde (com log).
- **Data única no código:** `DATA_PUBLICACAO_TERMOS_V1 = '2026-10-23'` em `src/domain/legal-notice.ts`, importada pelos catálogos (rodapé e histórico dos Termos, linha v3.1 e rodapé da política, rodapé de Seus direitos) e pelo corte do aviso. Este handoff, o ADR-0051, o parecer interno (§7 e §9) e o registro de operações repetem a data (2026-10-23) em prosa: mudam junto com ela.
- **Docs:** ADR-0051; parecer (§4 linha 18, §7, §8, §9(c), §10 item 2); `CONTEXT.md` ("Moderação reativa", "Convenção de URL", "Usuário e papéis"); `CLAUDE.md` ("Privacidade"); `docs/legal/registro-de-operacoes.md` (operações 1 e 14); `docs/legal/politica-de-privacidade-secao-descoberta-web.md` (seção 10); `docs/e2e.md`.

## 2. O que ler primeiro

1. `docs/adr/0051-termos-de-uso-idade-minima-16.md`: decisões, procedimentos manuais P1 a P5, posições (a) a (i).
2. `docs/legal/parecer-interno-2026-10-22.md` §7 e §8.
3. A seção `termos` de `src/i18n/messages/pt-BR.ts` e o componente `terms-of-use.tsx`.
4. `src/domain/legal-notice.ts` (data, versão do aviso, público).

## 3. Princípios inegociáveis

- Toda frase dos Termos é verdadeira do código no dia do merge; feature que muda o que eles afirmam muda o texto no mesmo PR.
- pt-BR é o texto aprovado; en-US, tradução fiel com as mesmas chaves e tamanhos.
- Mudança relevante só vale 15 dias depois do aviso (nova `AVISO_LEGAL_VERSAO`).
- Autodeclaração sem caixa de marcar nem data de nascimento.
- Nunca alegar advogado; P1–P5 sem `export` da URL do banco.

## 4. Texto ajustado ao código (diferenças do texto aprovado em 2026-10-22)

O controlador aprovou um texto; cada linha abaixo foi trocada para ficar fiel ao código. Leve esta tabela ao corpo do PR.

| Onde | Texto aprovado | Publicado | Por quê |
|---|---|---|---|
| intro, 6[1] | "na Política de Privacidade", "a página Seus Direitos" | com "(/privacidade)" e "Seus direitos (/seus-direitos)" | Caminho em texto, como a política; caixa do título da página. |
| 1[0] | `https://refogando.com` | `https://www.refogando.com` | O canônico é o www (o apex dá 308). Também em `privacidade.s1Corpo[0]`. |
| 2[1] | só o pedido de conhecimento do responsável | + "Se você é responsável… escreva para privacidade@refogando.com." | Canal para o responsável (P2). |
| 2[2] e política §9 | "nós a eliminamos" | "avisamos pelo e-mail da conta e, se a idade não for confirmada, eliminamos a conta e o que ela publicou" | Não há ferramenta; procedimento P1 (7 dias, sem documento). |
| 3[0] | "Use dados verdadeiros" | "Use um e-mail que seja seu e não se passe por outra pessoa." | O app só pede e-mail e nome; o nome é livre. |
| 5[1] | "nós a usamos só para fazer o app funcionar" | + as exceções (fila de imagens da curadoria; ingredientes à mão e cozinhas novas em "Outra", sem nome) | Política §4 e 3.3; a fila de imagens mostra privadas (#599). **As cozinhas em "Outra" entraram além do texto corrigido**, porque a política as lista como exceção. |
| 5[2] | licença com "as versões… mostram de qual receita vieram" | licença para guardar, exibir, reproduzir (app, buscadores, cards), traduzir, adaptar, e cópias **do texto, sem as fotos**, que outros editam e publicam; vale enquanto publicado | Nenhuma derivada mostra a origem; cópias são publicáveis. "Sem as suas fotos" conferido: derivada e clone nascem com galeria vazia (`src/server/recipe/derive.ts`). |
| 5[3] | "cópias e versões" | "cópias" | "Versão" é outro termo no `CONTEXT.md`. |
| 6[0] | "com o crédito ao site de origem" | "e mostra o crédito…" + o que o autor ou o dono pode pedir | Takedown de Seus direitos. |
| 8[0] | "denunciar uma receita ou avaliação pública pelo botão de denúncia" | avaliação pelo botão Reportar; receita pública, perfil ou sem conta, por e-mail | Não há botão na receita (#605); o botão se chama "Reportar". |
| 8[1] | "retiramos do ar ou o despublicamos" | "retiramos do ar e registramos a decisão, com o motivo" | A moderação nunca despublica. |
| 8[2] | "avisamos pelo app ou por e-mail com o motivo, salvo…" | receita, imagem ou avaliação retirada pela moderação: notificação no app; perfil: e-mail; motivo e nova análise por e-mail | A notificação não traz o motivo; não há e-mail automático de moderação (o do perfil é manual, P5). A fila de imagens passou a notificar neste PR. Conferido caminho por caminho (ADR-0051, decisão 4); a exclusão de importada pelo operador (`record_deletion`, só privada) não é moderação e fica fora da frase. |
| 8[3] | "suspender ou encerrar a conta" | bloquear funções (geração de imagens) ou encerrar; 15 dias para baixar os dados, salvo ilícito; nova análise | Não há ban (ADR-0007); encerrar é P3. |
| 9[1] | "respondemos por ele nos termos da lei, depois de avisados" | "Quando somos avisados de conteúdo ilegal, agimos como diz o item 8, e respondemos por ele nos casos que a lei prevê." | Marco Civil após o STF (art. 21 para ilícitos). |
| 10[0] | "avisamos no app" | "avisamos no app ou por e-mail" | O aviso no app existe (§1); o e-mail fica como alternativa. |
| 10, rodapés | `2026-10-22` | `2026-10-23` (`DATA_PUBLICACAO_TERMOS_V1`) | Data do merge, numa constante. |
| política §9 | "o conteúdo novo nasce privado" | "as receitas novas nascem privadas" + "O perfil público e as avaliações aparecem para todos… (item 3.1)" | Só a receita nasce privada. |

## 5. Frase dos Termos → onde o código a cumpre

| Frase (item) | Onde | Vale com |
|---|---|---|
| 1[1] "não tem publicidade" | não há código de anúncio nem analytics; cookies só estritamente necessários (política item 8) | main |
| 1[1] e 10[0] "avisamos com antecedência… pelo menos 15 dias" | `LegalChangeNotice` + `AVISO_LEGAL_VERSAO` (`src/domain/legal-notice.ts`); processo: a versão nova sai 15 dias antes | este PR; processo |
| 2[0] "declara que tem" 16 anos | `auth.privacidadeCadastro` em `auth-form.tsx` (cadastro e Google) | este PR |
| 2[1] responsável pede exclusão | P2 (ADR-0051) | processo |
| 2[2] e política §9, conta de menor de 16 | P1: e-mail, 7 dias, `deleteOwnRecipe` + avaliações + `eraseOwnAccount` | processo (#606) |
| 2[3] "Sem conta, você pode ler… e usar a busca" | `GET /api/search` com sessão opcional; detalhe e perfil públicos | main |
| 3[2] "Editar perfil → Seus dados" | seção "Seus dados" de `/me/profile` (exportação e exclusão) | PR B |
| 5[1] exceções do privado | `listReviewQueue` (`src/server/curate/review.ts`), `promotionList` (`src/server/curate/promotion.ts`), sugestões de cozinha (`src/server/vocabulary/`) | main (#599 restringe a fila) |
| 5[2] buscadores, cards, traduzir | sitemap (`src/domain/sitemap.ts`), `buildRecipeMetadata` com Open Graph (`src/domain/recipe-seo.ts`), tradução automática | main |
| 5[2] cópias do texto, sem fotos, publicáveis | `deriveRecipe` em `src/server/recipe/derive.ts` (galeria vazia, `origin=user_edited`, nasce privada e pode ser publicada) | main |
| 5[3] despublicar, apagar, cópias ficam | `/api/recipes/[id]/unpublish`, `deleteOwnRecipe`, `DELETE /api/recipes/[id]/reviews`; FK `parent_recipe_id` `ON DELETE set null` | main |
| 5[4] o publicado fica sem o nome | `eraseOwnAccount` + `purgePrivateContentInTx` | PR A |
| 6[0] importada sempre privada, com crédito | `decideVisibilityTransition` recusa `web_imported` (`src/domain/recipe-visibility.ts`); check `recipe_web_imported_private_chk`; crédito e takedown (`clear-attribution`, `record_deletion`) | main |
| 7 "contornar os limites de uso" | cotas (`src/server/quota/atomic.ts`), rate limit (`src/lib/auth.ts`) | main |
| 8[0] botão Reportar na avaliação | `recipe-review-section.tsx` → `/api/reviews/[reviewId]/report`; receita só por `POST /api/recipes/[id]/report` | main (#605) |
| 8[1] retirada com o motivo | `applyModerationRemove`, `applyImageModeration`, `applyReviewModeration` (`src/server/recipe/moderation.ts`), `applyReviewImageModeration`; motivo obrigatório (`decideModerationReason`) | main |
| 8[2] notificação no app (receita, imagem, avaliação) | `recipe_moderated` (`applyModerationRemove`), `image_moderated` (`applyImageModeration` e a fila proativa, `applyReviewImageModeration`), `review_moderated` (`applyReviewModeration`), via `emitNotification`; não há despublicação pela moderação, e a curadoria de receitas só alcança o catálogo | main; este PR |
| 8[2] perfil: aviso por e-mail | P5 | processo |
| 8[2] e 8[3] motivo e nova análise por e-mail | P4 | processo |
| 8[3] bloquear funções | `setImageGenRestriction` (`src/server/curate/restriction.ts`), com `account_restricted` | main |
| 8[3] encerrar com 15 dias | P3 | processo (#606) |

## 6. Landmines

- **Mudança relevante dos Termos = aviso 15 dias antes.** O PR que muda os Termos troca `AVISO_LEGAL_VERSAO` (e o público, se for o caso, em `shouldShowLegalNotice`), troca o `texto` de `avisoLegal`, ganha linha em `termos.s10Historico` + rodapé e só vale 15 dias depois do deploy (ou de um e-mail). Regra no `CLAUDE.md`, "Privacidade".
- **Uma data só.** `DATA_PUBLICACAO_TERMOS_V1` decide as datas publicadas **e o corte do aviso**. Se o merge sair em outro dia, troque só ela, e só neste PR (no código; as datas em prosa do ADR-0051, deste handoff, do parecer §7/§9 e do registro mudam junto); `test/ui/terms-of-use.test.tsx`, `privacy-policy.test.tsx` e `seus-direitos.test.tsx` seguem verdes. Depois do merge ela fica congelada: a próxima versão ganha constante própria (`CLAUDE.md`, "Privacidade").
- **Imports de valor nos catálogos são relativos** (`'../../domain/legal-notice'`): o E2E (`e2e/fixtures/test.ts`) importa `pt-BR.ts` fora do bundler do Next, onde `@/` não resolve (mesmo motivo do import relativo de `src/domain/error-report.ts`).
- **Dois históricos.** Termos em `termos.s10Historico`; política em `privacidade.s10Historico` (era `s9Historico`; o handoff 84 cita o nome antigo e ficou como estava). O rodapé de `seusDireitos` repete o da política (teste `seus-direitos.test.tsx`).
- **`DESTAQUES` é por índice** (`terms-of-use.tsx`): reordenar um `sNCorpo` sem rever o conjunto põe o negrito na cláusula errada. O teste trava as oito.
- **Nunca alegar advogado.** O teste dos Termos reprova "advogad" e "lawyer".
- **Procedimentos manuais (P1 a P5)** rodam contra produção: URL do banco inline ou por `--env-file`, **nunca** `export` (incidente de 2026-09-09); sem reset, drop ou truncate.
- **`auth.privacidadeCadastro` manteve o nome** (o PR B o criou), mas agora tem dois tokens; `test/ui/auth-form.test.tsx` reprova `{link}`.
- **Linha v3 da política.** O C1 escreveu `v3 — 2026-10-22`. Se o C1 entrar na main em outro dia, a data dessa linha é decisão do coordenador; este PR não a mexe.

## 7. Follow-ups

Já abertos (citados nos Termos e no ADR): **#605** (botão Reportar na página da receita; depois, o item 8 volta a "receita ou avaliação") e **#606** (ação "Eliminar conta" no Console → Usuários, automatiza P1 a P3; suspender a conta durante os 7 dias do P1).

Abertos depois da revisão (`needs-triage`):
1. **#609, motivo dentro da notificação de retirada.** Hoje `renderNotification` não mostra o motivo livre; o Termos 8[2] manda pedir por e-mail. Mostrar o motivo ao dono (ADR-0051 (d)).
2. **#610, crédito público na derivada.** "Baseada na receita de @x" na cópia publicada ("Clonar", "Criar minha versão"), por causa do direito de atribuição (Lei 9.610, ADR-0051 (i)).
3. **#611, páginas legais: rodapé com idioma, canonical e hreflang.** Os quatro links legais do rodapé são sem prefixo; quem está em `/en-US/...` sem cookie de idioma e com Accept-Language pt cai na versão pt-BR (`localePrefixedPath`). `/privacidade`, `/seus-direitos` e `/termos` só têm `<title>`; o hreflang vem só do sitemap.

Não aberto (opcional): **notificação para retirada manual** (perfil denunciado por e-mail, P5): o enum não tem tipo; hoje o aviso é por e-mail.

## 8. Critério de saída

- "checks" e "e2e" verdes no PR, com A, B e C1 na main.
- Local, nesta branch (2026-10-23): `npm run typecheck` limpo; `npm run lint` com 0 erros (os 4 avisos antigos de `<img>`); `npx vitest run --project ui`: 147 arquivos, 1602 testes; node (com o `flock`): `test/domain/legal-notice.test.ts`, `test/domain/sitemap.test.ts`, `test/i18n/messages.test.ts`, `test/integration/sitemap.test.ts`, `test/integration/curate-review-queue.test.ts`, `test/integration/notifications.test.ts`: 6 arquivos, 83 testes (com as correções do painel de revisão). `next build` e o E2E não rodaram aqui (memória da máquina); o CI roda os dois.
- Depois do deploy:
  - `/pt-BR/termos` e `/en-US/termos` dão 200; o rodapé mostra "Termos de Uso" primeiro.
  - `/sitemap.xml` lista `https://www.refogando.com/{pt-BR,en-US}/termos`.
  - `/privacidade` mostra a seção 9 "Crianças e adolescentes", a 10 com `v3.1 — 2026-10-23` (`DATA_PUBLICACAO_TERMOS_V1`) e o rodapé `v3.1`; `/seus-direitos`, rodapé `v3.1`.
  - O cadastro mostra a linha com os dois links prefixados acima do "Criar conta".
  - Uma conta criada até o fim do dia `DATA_PUBLICACAO_TERMOS_V1` (2026-10-23, Brasília) vê o aviso; "Entendi" o tira e ele não volta.

## 9. Gotchas de ambiente

- Vitest: `flock /var/tmp/vitest.lock npx vitest run …` para tudo (a máquina tem 15 GB e já reiniciou por memória); o projeto node sobe Postgres pelo Testcontainers (Docker). Nunca `export` de `DATABASE_URL`/`TEST_DATABASE_URL`.
- O `planalto.gov.br` respondeu 503 em 2026-10-22 e em 2026-10-23: o ADR-0051 cita fonte secundária para todos os artigos do ECA Digital que usa (2º, III; 7º; 9º; 24). Conferir o texto oficial quando o site voltar e corrigir o ADR se divergir.

## Prompt de kickoff

Leia `docs/handoffs/85-termos-de-uso-idade-minima.md` e o `docs/adr/0051-termos-de-uso-idade-minima-16.md`. Os Termos de Uso v1 (idade mínima de 16 anos), a política v3.1, a linha do cadastro, o aviso de mudança no app e a notificação da fila de imagens da curadoria já estão na main, depois dos PRs #607, #608 e #612 do mesmo sign-off. Faça as conferências pós-deploy da §8 em produção (`/termos` e `/en-US/termos`, rodapé, linha do cadastro, aviso para uma conta antiga e o "Entendi"). Depois, pegue as issues da §7 (#609, #610, #611) pelo fluxo de 8 passos do `CLAUDE.md`. `DATA_PUBLICACAO_TERMOS_V1` fica congelada: uma mudança relevante nos Termos ganha uma linha nova no histórico, uma constante nova e uma nova `AVISO_LEGAL_VERSAO` com 15 dias de antecedência.
