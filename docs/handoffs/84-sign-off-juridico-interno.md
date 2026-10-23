# Handoff 84 — Sign-off jurídico interno: política v3, Seus direitos v3 e allowlist reduzida (#276)

**Sessão:** 2026-10-22 e 2026-10-23. **Branch:** `claude/project-thread-yl7417` (sobre a main em `9f0281d`). **Migração:** nenhuma neste PR. Três PRs saem do mesmo sign-off e entram nesta ordem: **PR A** (#473, #596), PR #607 (mergeado); **PR B** (#595), PR #608 (mergeado); **PR C1** (#276, este PR). Depois dele vem o PR C2 (Termos de Uso e idade mínima de 16 anos, handoff 85). As decisões estão em `docs/legal/parecer-interno-2026-10-22.md`; os prazos de retenção, no ADR-0050 (veio no PR A, com o handoff 83).

## 1. O que o sign-off decidiu

O controlador (Fernando Lisboa) pediu que as pendências jurídicas fossem analisadas e assinadas pelo Claude, sem advogado e sem nada bloqueado esperando sign-off externo. O parecer **não é de advogado** e nenhum texto do repo ou do app pode dizer que um advogado revisou: o status publicado é "revisão interna concluída em 2026-10-22". As decisões valem como decisões do controlador.

- **Enquadramento (§1):** controlador pessoa física, sem CNPJ; agente de pequeno porte (Res. CD/ANPD nº 2/2022); **sem encarregado (DPO)**, com o canal `privacidade@refogando.com` atendido pelo controlador; resposta ao titular em 15 dias corridos.
- **Descoberta na web (§2):** base é o **legítimo interesse** (art. 7º, IX), e a autopublicação pelo autor pesa no balanceamento (não é base alternativa). LIA aprovada (`docs/legal/lia-descoberta-web.md`, v3); RIPD dispensável. Takedown: por padrão tira só o nome e mantém a URL; desvincula a URL quando ela identifica a pessoa ou a pessoa se opõe ao tratamento todo; apaga as cópias (`record_deletion`) quando quem pede é o dono do site ou dos direitos, e aí o domínio entra na `TOS_DENYLIST` no código. A postura do ADR-0019 ficou aprovada; a feature já estava ligada em produção e o sign-off a regulariza.
- **Achado novo (§2):** o importador copia o **texto dos passos** como o site publica (`parseInstructions` em `src/domain/recipe-import-parse.ts`), não "só fatos". Aceito enquanto a cópia for privada, creditada e não publicável.
- **Allowlist (§3):** dos 11 domínios, ficam `tudogostoso.com.br` e `receitasnestle.com.br` (com condição, ver §4 abaixo); saem `cybercook.com.br` (o domínio inteiro redireciona para carrefour.com.br), `receiteria.com.br`, `allrecipes.com`, `simplyrecipes.com`, `seriouseats.com` e `bbcgoodfood.com`, que se juntam a panelinha, guiadacozinha e foodnetwork. Cláusula literal de cada um em `docs/legal/revisao-tos-allowlist.md` §4.0.
- **Política × prática (§4):** 26 achados, cada um com dono: PR A, PR B, a v3 deste PR ou uma issue de acompanhamento. Os achados 20 a 26 saíram da revisão deste PR (log do e-mail no login, perfil público, fila da curadoria, vetor de busca das receitas, cópias de segurança, aviso da mudança de consentimento, log cru do Next).
- **Retenção (§5):** resumo no parecer; a regra é o ADR-0050.
- **Transferência (§6):** mecanismo geral art. 33, IX (com art. 7º, V; para a caixa da Proton, com art. 7º, II); Google (Gemini) pelo plano pago, com as cláusulas-padrão (art. 33, II, "b"); restrições salvas (dado sensível) pelo art. 33, VIII, com o aviso dos EUA junto do botão. Risco aceito: os fluxos de legítimo interesse hospedados na Vercel (IP da sessão, rate limit, registros técnicos) se apoiam no art. 7º, V.
- **Pontos do §10, todos respondidos pelo controlador em 2026-10-22:** (1) incidente de 09/09 **só registrado**, sem comunicar à ANPD nem aos titulares (registro do art. 10 da Res. 15/2024 em `docs/incidents/2026-09-09-banco-apagado-por-agente-do-feudo.md`); (2) Termos de Uso com **idade mínima de 16 anos**; (3) chave do Gemini em projeto **com faturamento ativo** (plano pago).

### Onde está cada documento

| Documento | Papel |
|---|---|
| `docs/legal/parecer-interno-2026-10-22.md` | Fonte das decisões. Muda junto quando uma decisão muda. |
| `docs/legal/registro-de-operacoes.md` | Registro das operações (art. 37), modelo de pequeno porte. |
| `docs/legal/lia-descoberta-web.md` | LIA aprovada (v3). |
| `docs/legal/revisao-tos-allowlist.md` §4.0 | Leitura dos Termos de 2026-10-22, decisão por domínio, condição dos dois mantidos, achado dos passos. |
| `docs/legal/takedown-e-remocao-titular.md` | Procedimento de takedown; §8 com a situação em 2026-10-22. |
| `docs/legal/briefing-juridico-descoberta-web.md`, `pacote-consulta-juridica.md`, `politica-de-privacidade-secao-descoberta-web.md` | Históricos, marcados como encerrados com ponteiro para o parecer. |
| `docs/incidents/2026-09-09-banco-apagado-por-agente-do-feudo.md` | Registro do incidente. **Guardar até pelo menos 2031-10-22** (5 anos). |
| Seção `privacidade` de `src/i18n/messages/pt-BR.ts` e `en-US.ts` → `src/components/legal/privacy-policy.tsx` → `/privacidade` | Política publicada, v3. |
| Seção `seusDireitos` → `src/components/legal/seus-direitos.tsx` → `/seus-direitos` | Canal do titular, v3 (mesmo rodapé da política). |
| ADR-0019 (nota "Atualização 2026-10-22"), ADR-0050 (PR A) | Arquitetura da Descoberta; prazos de retenção. |
| `CLAUDE.md` § "Privacidade", `docs/observabilidade.md` | Regra de a política andar com o código; logs apontam para o item 3.7. |

## 2. O que mudou, por PR

- **PR A (#473, #596), PR #607:** eliminação da conta apaga na hora o conteúdo privado e anonimiza o público; cron de retenção com os prazos do parecer §5 (rate limit limpo de hora em hora, por isso a política diz "até 2 horas"); EXIF removido no servidor do avatar e da foto de receita; ADR-0050 e handoff 83. Também traz as suas cópias do parecer e do registro; na rebase vale o que está aqui (o coordenador reconcilia). PR A mexe em `s32Valores[3]` e `s33Valores[3]`: na rebase vale o texto da v3.
- **PR B (#595), PR #608:** "Editar perfil → Seus dados" com exportação completa e exclusão da conta (achado 1) e a linha com link para a política no cadastro (achado 16). A v3 já cita esse caminho; o rótulo en-US usado aqui é "Edit profile → Your data", o mesmo do PR B.
- **PR C1 (#276, este PR), fecha o #276:**
  - Docs: parecer e registro em `docs/legal/`; registro do incidente; status dos outros docs de `docs/legal/` trocados por linha datada apontando para o parecer; LIA aprovada; `revisao-tos-allowlist.md` §4.0; nota no ADR-0019; frase em `docs/observabilidade.md`; seção "Privacidade" no `CLAUDE.md`.
  - **Política v3:** itens 3.1 a 3.9 (novos 3.6 segurança e prevenção de abuso, 3.7 registros técnicos, 3.8 pedidos de titulares, 3.9 busca); §5 vira tabela por prestador (8 linhas, com Proton e o login do Google) e a transferência é descrita por fornecedor; §7 com 11 direitos; §8 nova de cookies e armazenamento no navegador (tabela, sem banner: só há cookies estritamente necessários); §9 "Alterações" com histórico v1/v2/v3; sem "encarregado (DPO)"; rodapé `v3`, `2026-10-22`, "Publicada — revisão interna concluída em 2026-10-22". Componente ganhou `Tabela` (linha *i* = `colunas[c][i]`).
  - **Seus direitos v3:** self-service em "Editar perfil → Seus dados"; o autor importado pede a remoção do nome, também do link ou, se é dono do site, das cópias; pedido apagado 12 meses depois de encerrado; mesmo rodapé da política.
  - `restricoesPerfil.consentimento` passa a dizer que o app e a IA funcionam nos Estados Unidos (art. 33, VIII). `admin.escalonarAviso` traz os critérios do parecer §2, item 2; o rótulo do SLA vermelho vira "Escalonar ao controlador".
  - **Aviso da mudança de consentimento (art. 8º, §6; achado 25):** quem já tinha restrições salvas vê no formulário das restrições (`src/components/profile/restricoes-perfil-form.tsx`) um aviso âmbar dispensável, até tocar em "Entendi" (localStorage `refogando:restricoes:aviso-2026-10-22`) ou salvar de novo. É o que torna verdadeira a frase da §9 "avisamos com destaque no lugar onde você o deu".
  - **Log do Better Auth (achado 20):** o login que falha não loga mais o e-mail digitado (`DROPPED_LOG_PREFIXES` em `src/lib/auth.ts`).
  - **Log dos valores da IA fora do vocabulário:** `logDescartes` (`src/server/claude/client.ts`) logava o valor cru quando curto (quantidade, unidade, cozinha, restrição); agora só o campo e o tamanho, porque o item 3.7 diz que as nossas linhas não trazem conteúdo de receita (adendo no ADR-0009).
  - **Tabelas da política:** cabeçalho com `scope="col"` e a 1ª coluna como `<th scope="row">`.
  - **Allowlist:** `TOS_DENYLIST` (`src/domain/web-search-config.ts`) com 9 domínios, os 6 novos com a cláusula literal em comentário; `SUGGESTED_DOMAINS` (`src/domain/suggested-domains.ts`) passa a sugerir só os dois mantidos (en-US vazio, e grupo vazio não aparece); resultados enlatados do provedor fake trocaram cybercook por receitasnestle.
  - **Leitura da allowlist gravada:** antes, `loadAppConfig` usava `parseAllowlist`, que já recusava domínio vetado, mas devolvia `null` para a lista inteira, e a allowlist virava `[]`. Com a linha de produção gravada antes do veto, isso desligaria a Descoberta em silêncio. Agora `parseStoredAllowlist` descarta só as entradas vetadas e mantém o resto (lixo, não-array ou acima do teto continuam ⇒ `null` ⇒ `[]`). Todas as leituras (GET do admin, endpoint de descoberta, guarda da importação, home) passam por `loadAppConfig` (`src/server/app-config.ts`). O PUT segue recusando o lote inteiro com 400 `dominio_vetado`. E `isUrlAllowed` recusa host vetado por conta própria, mesmo que a allowlist traga um sufixo pai dele (`com.br`).

## 3. Pendências

- **PR dos Termos de Uso (idade mínima de 16 anos):** página `/termos`; linha do cadastro (e do botão do Google, que também cria conta) com autodeclaração de 16+ e link para os Termos, sem checkbox; regra de denúncia e moderação (parecer §8); Termos pedem que quem tem 16 ou 17 anos use o app com o conhecimento do responsável (§7). **No mesmo PR, a política ganha a seção de adolescentes** ("9. Crianças e adolescentes", entre a 8 e "Alterações", que vira a 10), com nova linha no histórico e rodapé novo. O teste `test/ui/privacy-policy.test.tsx` trava `s9Titulo` começando com "9."; ajuste-o junto. Rota nova entra em `CLIENT_ROUTE_TREE` (`src/domain/error-report.ts`).
- **Do controlador (registro do incidente, item VI):** apagar a linha comentada do `~/.zshenv` e rotacionar a senha do role `neondb_owner` no Neon.
- **Antes de qualquer plano pago que inclua a importação:** (a) reescrever os passos na importação (paráfrase) ou obter permissão escrita dos sites mantidos; (b) reavaliar `tudogostoso.com.br` e `receitasnestle.com.br` (se "uso comercial do conteúdo" alcançar uma ferramenta paga que guarda cópias, os dois caem juntos e vão para a `TOS_DENYLIST`).
- **Issues de acompanhamento (já abertas):**
  - #597 — selo de IA na receita gerada por IA publicada (achado 17).
  - #599 — fila de revisão da curadoria só com receitas públicas (achado 22; parecer §11).
  - #600 — registrar data e versão do consentimento das restrições salvas, com migração (achado 25; parecer §11).
  - #601 — índices para retenção, eliminação e exportação (inclui o índice parcial em `recipe_image(created_by)`).
  - #602 — sessão recente para excluir a conta.
  - #603 — blobs órfãos, EXIF de envios antigos e fotos de avaliação de terceiros.
- **Do controlador, sem código:** apagar da caixa da Proton os e-mails do canal de privacidade com mais de 5 anos (política 3.8; registro, operação 8).
- **Do controlador, conferência manual das cópias de preview:** o `.github/workflows/cleanup-neon-preview-branch.yml` só roda quando um PR fecha, então um branch enviado sem PR pode deixar a sua cópia do banco no Neon. De tempos em tempos, liste os branches `preview/*` no console do Neon e apague os que não têm PR aberto (política §4; registro, operação 17).

## 4. Gatilhos para rever o parecer (§12)

Ligar cobrança; abrir CNPJ; ligar analytics; abrir a Descoberta para a web aberta; novo fornecedor de IA; guias finais da ANPD sobre ECA Digital, alto risco ou direitos dos titulares; aprovação do PL 2338/2023. O enquadramento de pequeno porte (§1) também se reavalia ao passar de ~10 mil contas ativas. Para analytics, o §9 já libera uma solução **sem cookie** (Vercel Web Analytics) com uma linha na política.

## 5. Landmines e gotchas de ambiente

- **A política anda junto com o código** (regra "Privacidade" do `CLAUDE.md`). PR que muda dado coletado, finalidade, fornecedor, prazo ou conteúdo de log atualiza no mesmo PR a seção `privacidade` dos dois locales (nova versão na seção Alterações, `s9Historico`, e no rodapé, que o de `seusDireitos` repete), o `registro-de-operacoes.md` e, se mudar decisão, o parecer. Campo novo em log precisa caber no item 3.7.
- **Os prazos da política são os do ADR-0050** (sessão de 7 dias apagada em até 1 dia depois de vencer; rate limit até 2 h após a última tentativa; extração 30 dias; IA 24 meses; foto de avaliação de conta eliminada 180 dias; ticket encerrado 12 meses; auditoria DSAR 5 anos) e do `db-backup.yml` (3 cópias semanais). Mudar um cron, um `KEEP` ou uma constante de retenção sem mudar a política deixa o texto publicado falso: a tabela do §6 diz onde cada frase é cumprida.
- **Faturamento do Gemini:** a §5 da política e o parecer §6 dependem do plano pago. Se o faturamento do projeto no Google AI Studio cair, o app passa ao plano gratuito (o Google usa o conteúdo e pode haver revisão humana) e a política fica falsa. Trocar de projeto ou de chave exige conferir isso.
- **Domínio vetado só sai pelo código.** A allowlist gravada não é migrada: a linha antiga de produção ainda pode conter os 6 vetados, e quem os tira é `parseStoredAllowlist` na leitura (e `isUrlAllowed`, na URL). Não troque por `parseAllowlist` em `loadAppConfig` (uma entrada vetada desligaria tudo). O admin verá a lista já filtrada e, ao salvar, grava a versão limpa. **Tirar um host da `TOS_DENYLIST` revive em silêncio** a entrada que ainda estiver gravada: confira a linha de produção antes.
- **Consentimento e aviso.** Mudou o que a pessoa autorizou com consentimento (hoje, só as restrições salvas)? O mesmo PR mostra um aviso em destaque no lugar do consentimento (art. 8º, §6), com uma chave nova de localStorage (a data no nome), como o de 2026-10-22.
- **Domínio novo na allowlist** só com os Termos lidos pela regra de `revisao-tos-allowlist.md` (cláusula literal contra robôs, armazenamento ou cópia por terceiro ⇒ excluir; Termos ilegíveis ⇒ excluir), e a sugestão só entra em `SUGGESTED_DOMAINS` com decisão "manter".
- **pt-BR é o texto aprovado;** en-US é tradução fiel com a mesma estrutura. `test/i18n/messages.test.ts` trava a paridade de chaves e os testes de UI travam os tamanhos dos arrays (as três colunas de cada tabela têm o mesmo tamanho). O rótulo "Your data" precisa bater com o título da seção do PR B.
- **Não alegar advogado** em texto nenhum (política, Seus direitos, docs). O teste da política reprova "revisão jurídica em andamento" e "ainda será fechado".
- Rodar Vitest: `flock /var/tmp/vitest.lock npx vitest run` (sem `TEST_DATABASE_URL`, o global-setup sobe Postgres pelo Testcontainers; nunca `export` de URL de banco, ver `CLAUDE.md`). Os testes de UI rodam sem lock: `npx vitest run --project ui`.

## 6. Critério de saída

### Frase da política → onde o código a cumpre

Cada prazo ou comportamento que a v3 afirma, e o que o torna verdade. **PR A** e **PR B** marcam o que só vale depois que esses PRs entrarem na main; sem eles, a frase fica falsa. "main" = já estava em `5b4580d`, antes do PR A. PR A e PR B já estão na main (`9f0281d`), então todas as linhas valem no merge deste PR.

| Frase da política (item) | Onde o código a cumpre | Vale com |
|---|---|---|
| 3.1 "anonimizamos na hora… apagamos a senha, o login do Google e todas as sessões" | `src/server/legal/account-erasure.ts` (`POST /api/me/erasure`); PR A apaga também os tokens de `verification` | main; PR A |
| 3.1 "cadastro… não confirmado é apagado depois de 48 horas… 90 dias só um código derivado do e-mail" | `src/server/auth/pending-signup-purge.ts` (`PENDING_SIGNUP_MAX_AGE_MS`, `PURGED_SIGNUP_MEMORY_MS`, HMAC), cron `/api/cron/account-purge` (diário, 09:30 UTC) | main |
| 3.1 "página pública (/u/seu-@)… buscadores podem indexar… quem você segue e quem segue você" | `src/app/[locale]/u/[handle]/page.tsx` (sem `noindex`), `src/components/profile/public-profile-view.tsx` | main |
| 3.2 "apagamos na hora tudo o que é só seu" (privadas, salvos, coleções, listas, Cardápio, Despensa, seguidores, notificações) | `src/server/legal/private-content.ts` (`purgePrivateContentInTx`); contas já eliminadas: `purgeAnonymizedPrivateContent` em `src/server/legal/account-purge-scan.ts` | **PR A** |
| 3.2 "as fotos das avaliações são apagadas 180 dias depois" | `src/domain/account-purge.ts` (`RETENTION_DAYS = 180`), cron account-purge | main |
| 3.2 "título, descrição e ingredientes de cada receita, inclusive das privadas, vão ao Google (Gemini)" | `src/server/embedding/recompute.ts` (`embedTranslation`) | main |
| 3.3 "os pedidos de texto e as conversas… são apagados se você eliminar a conta" | scrub de sessão em `src/server/legal/private-content.ts` | **PR A** |
| 3.3 "os pedidos de imagem não são guardados, só a imagem gerada" | `src/db/schema.ts`: `recipe_image` e `image_generation` sem coluna de prompt | main |
| 3.3 "registros de uso… apagados depois de 24 meses (extração, 30 dias)" | `src/domain/data-retention.ts` (731 e 30 dias), passos `imageGenerations`, `mealPlanSuggestions`, `extractionEvents`, `liveGenerationCosts`, `erasedGenerations` em `src/server/legal/data-retention.ts`, cron `/api/cron/retention` (diário, 11:30 UTC) | **PR A** |
| 3.3 "ingredientes escritos à mão… os que se repetem entram, sem o seu nome, numa lista" | `src/server/curate/promotion.ts` (`PROMOTION_THRESHOLD = 2`, só `raw_text` e contagem) | main |
| 3.5 "o texto fica junto do botão e informa que o app e a IA funcionam nos Estados Unidos" | `restricoesPerfil.consentimento`, `aria-describedby` do botão em `src/components/profile/restricoes-perfil-form.tsx` | este PR |
| 3.5 / s3Nota "entram na exportação"; exportação sem credenciais e com só a contagem de seguidores | `src/server/legal/account-export.ts` (`accountExportSections`), botão em "Editar perfil → Seus dados" | **PR B** |
| 3.6 "a sessão vale 7 dias, renovados com o uso" | default do Better Auth (`session.expiresIn` 7 dias, `updateAge` 1 dia; `src/lib/auth.ts` não sobrescreve) | main |
| 3.6 "é apagada em até 1 dia depois de vencer" | passo `sessions` (`expires_at < agora`) do cron de retenção, diário | **PR A** |
| 3.6 "IP… apagado em até 2 horas após a última tentativa" | `src/server/rate-limit/cleanup.ts` (`RATE_LIMIT_MAX_AGE_MS` = 50 min) + `vercel.json` `rate-limit-cleanup` de hora em hora, aos :15 (`15 * * * *`) | **PR A** |
| 3.6 "só na memória, para limitar o ritmo do formulário de Seus direitos e da Descoberta" | `takedownThrottle` em `src/app/api/legal/takedown/route.ts`, `webSearchThrottle` em `src/app/api/discovery/web/route.ts` | main |
| 3.6 "decisões de moderação… com o motivo"; "se você eliminar a conta, ficam sem nada que identifique você" | `moderation_reason`, `moderated_reason`, `image_gen_blocked_reason` em `src/db/schema.ts`; saem na exportação. Na eliminação, a linha de `users` fica anonimizada (`src/server/legal/account-erasure.ts`) e o conteúdo público que fica é anonimizado | main; anonimização do conteúdo: **PR A**; export: **PR B** |
| 3.7 "as linhas que nós escrevemos não trazem IP, cookies, identificador da sua conta nem o conteúdo das suas receitas" | `src/domain/error-report.ts`, `docs/observabilidade.md`; `[cache-tags]`, `[home]`, `[notification]` passam a logar só nome e código (`errorLogFields`); o login que falha não loga o e-mail (`authLog`); os valores da IA fora do vocabulário saem só com campo e tamanho (`logDescartes` em `src/server/claude/client.ts`) | **PR A**; este PR |
| 3.7 "o IP de quem envia é usado só na memória" | `createIpBurstLimiter` em `src/server/http/client-error-intake.ts` | main |
| 3.8 "o pedido é apagado 12 meses depois de encerrado; o registro de auditoria, depois de 5 anos" | passos `takedownTickets` (366 dias após o último atendimento ou recusa) e `dsarEvents` (`purgeDsarEventsBefore`, 1827 dias) | **PR A** |
| 3.8 "os e-mails… ficam guardados por até 5 anos" | sem código: limpeza manual da caixa da Proton (§3) | processo |
| 3.9 "se você está conectado e a Descoberta na web está ativa, enviado à Brave" | `requireSession` e `isWebSearchOpen` em `src/app/api/discovery/web/route.ts` | main |
| §4 "remoção dos metadados das fotos enviadas" | `reencodeUserPhoto` (`src/server/images/user-photo.ts`) no avatar, na foto da receita e no curador; a foto de avaliação já era limpa | **PR A** (#596) |
| §4 "imagens geradas com um pedido de estilo seu ou editadas por IA entram numa fila de revisão" | `reviewRequired` em `src/server/recipe/image.ts`; `listReviewQueue` em `src/server/curate/review.ts` | main (restringir: #599) |
| §4 "os ingredientes fora do vocabulário que se repetem e as cozinhas novas que você escreve em 'Outra' chegam à curadoria sem o seu nome" | `promotionList` em `src/server/curate/promotion.ts` (só o texto e a contagem); `suggestCozinha` e `listSuggestedCozinhas` em `src/server/vocabulary/` (só o termo e quantas receitas o usam) | main |
| §4 "endereços públicos que não são listados nem fáceis de adivinhar" | `crypto.randomUUID()` no nome do blob (`src/server/images/image-store.ts`) | main |
| §4 "uma cópia de segurança… por semana… as três mais recentes… em até 4 semanas" | `.github/workflows/db-backup.yml` (domingo 06:00 UTC, `KEEP: "3"`) | main |
| §4 "cópias temporárias… apagadas quando o teste termina" | `.github/workflows/cleanup-neon-preview-branch.yml` (PR fechado); branch sem PR: conferência manual (§3) | main |
| §5 "a sua foto do Google é carregada dos servidores do Google" | `<img>` direto em `src/components/profile/avatar.tsx`; `img-src` com `lh3.googleusercontent.com` em `next.config.ts` | main |
| §7 "limites automáticos iguais para todos" | cotas em `src/server/quota/atomic.ts`, `rateLimit` em `src/lib/auth.ts`, purga do cadastro pendente | main |
| §8 localStorage: última aba, tour, porções, aviso; "a última aba, até você sair da conta" | `src/components/nav/last-tab-store.ts` (`forgetTabs` no "Sair", `src/components/auth-slot.tsx`), `src/components/onboarding/guided-tour.tsx`, `src/components/meal-plan/meal-plan-suggest-panel.tsx`, `restricoes-perfil-form.tsx` | main; este PR |
| §8 sessionStorage: relatos de erro, recarga, "Mostrar tudo", pedido do tour, aviso da exclusão | `src/lib/client-error-report.ts`, `src/lib/app-update-reload.ts`, `src/components/recipe/search-experience.tsx`, `src/components/onboarding/tour-signal.ts`, `account-notice-signal.ts` (`refogando:conta:aviso`) | main; **PR B** |
| §9 "avisamos com destaque no lugar onde você o deu" | aviso em `restricoes-perfil-form.tsx` | este PR |
| Parte (b) "trazemos só o título, os ingredientes e o modo de preparo… nasce sem imagem e sem descrição" | `parseImportedRecipe` em `src/domain/recipe-import-parse.ts`; `src/server/import/persist-import.ts` (`descricao: null`, sem `recipe_image`) | main |
| b.1 "lista fechada de domínios que aprovamos um a um" | `TOS_DENYLIST`, `parseStoredAllowlist` e `isUrlAllowed` em `src/domain/web-search-config.ts` | este PR |

### Verificação

"checks" e "e2e" verdes no PR, com o PR A e o PR B já na main e a rebase feita (v3 vence em `s32Valores[3]` e `s33Valores[3]`; parecer e registro reconciliados). Local: `npm run typecheck`, `npm run lint` (0 erros; os 4 avisos antigos de `<img>` ficam), `npx vitest run --project ui` e a suíte inteira com o `flock`. Depois do deploy: `/privacidade` e `/seus-direitos` mostram `v3 — 2026-10-22` nos dois idiomas, e o admin de Descoberta mostra só `tudogostoso.com.br` e `receitasnestle.com.br` (se era o que estava gravado). Fechar o #276.
