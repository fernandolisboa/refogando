# Canal de atendimento ao titular e fluxo de remoção — Descoberta na web (Refogando, issue #276)

> **Atualização de 2026-09-24.** Os gaps GAP-1 a GAP-7 da §8 foram implementados entre 2026-07-01 e 2026-07-05. A §8 mostra a situação atual; a §4.2 descreve o fluxo com as ferramentas que existem hoje. As perguntas da §9 continuam valendo.

> **Rascunho para revisão jurídica — não constitui parecer.** Este documento foi redigido pela equipe do Refogando como material de trabalho para um(a) advogado(a) de LGPD/PI **revisar, corrigir e assinar** antes do go-live. Onde a lei é incerta ou depende de interpretação, o texto **sinaliza expressamente** o ponto para validação profissional (marcado como **[VALIDAR]**). As referências legais são a nossa pesquisa interna (registrada no ADR-0019) e podem estar erradas. Nada aqui deve ser publicado ou tratado como posição oficial sem o sign-off.

---

## 1. Contexto e por que há DOIS titulares distintos

A "Descoberta na web" (ADR-0019, `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`) permite ao usuário do app importar receitas de sites externos de uma **allowlist curada** (`src/server/web-search/web-search-provider.ts`). A importação copia **só fatos** (ingredientes, passos, tempo, porções, cozinha) e **nunca** a foto nem o `description`/headnote autoral (`src/server/import/persist-import.ts` grava `description: null`). A importada é **sempre privada e não-publicável**.

Do ponto de vista da LGPD, é essencial separar dois titulares, porque **têm canais diferentes**:

| Titular | Que dado pessoal existe | Como pede remoção hoje |
|---|---|---|
| **A) Usuário do app** (dono da conta) | conta, e-mail, perfil, receitas, coleções, avaliações | **self-service autenticado**: exportação (`GET /api/me/export`) e eliminação por anonimização (`POST /api/me/erasure`) |
| **B) Autor/publisher da receita de terceiro** | **apenas `source_name` (nome) + `source_url` (URL)** de receitas `origin='web_imported'` (`src/db/schema.ts` ~L216-222) | **formulário público** em `/seus-direitos` (sem login) ou e-mail `privacidade@refogando.com`; o operador executa a remoção |

O ponto crítico de #276 é o **titular B**: o dado dele (o nome do autor) é gravado sem que ele seja usuário, então **ele não tem login para se auto-atender**. O canal de takedown existe justamente para ele. A minimização já está implementada de verdade (só nome + URL; foto e headnote nunca copiados), o que reduz muito a superfície — mas não elimina a obrigação de ter um canal público e um fluxo.

---

## 2. Canal a publicar + os 3 canais de intake (Res. CD/ANPD 18/2024; Art. 41 LGPD)

A LGPD (Art. 41) prevê **Encarregado (DPO)** indicado, e a **Res. CD/ANPD 18/2024** exige que a **identidade e o contato do Encarregado sejam divulgados publicamente, de forma clara e acessível** (o site é o local indicado).

> **[VALIDAR]** Se o Refogando se qualificar como **agente de tratamento de pequeno porte (ATPP)**, a **Res. CD/ANPD 2/2022 dispensa a indicação formal do Encarregado**, exigindo apenas a manutenção de um **canal de comunicação** com o titular. De todo modo, a recomendação abaixo — **publicar um canal de contato claro** — **permanece válida** nos dois cenários. Confirmar com o(a) advogado(a) se o Refogando é ATPP e, portanto, se a divulgação nominal do Encarregado é obrigatória ou apenas o canal.

Portanto:

**(a) Endereço/canal a publicar:**
- **E-mail dedicado de privacidade/Encarregado:** `privacidade@refogando.com` (é o endereço publicado na Política e em `/seus-direitos`). Este endereço é o **canal universal** de intake, válido tanto para o titular A quanto para o titular B, e é o **canal mínimo a manter em qualquer cenário** (mesmo como ATPP, a Res. 2/2022 exige um canal de comunicação com o titular).
- Publicar junto: um link "Seus direitos / Privacidade" descrevendo o fluxo e — **se aplicável** (ver **[VALIDAR]** acima) — o **nome do Encarregado**. Publicado: `/privacidade` e `/seus-direitos`, linkadas no rodapé, com o encarregado nomeado (Fernando Lisboa).

**(b) Os 3 canais de intake (conforme a skill DSAR):**
1. **API self-service (titular autenticado):** para o **titular A**. Endpoints de acesso/correção/eliminação/portabilidade (Art. 18, II–VI) — implementado para exportação (`GET /api/me/export`) e eliminação por anonimização (`POST /api/me/erasure`); correção pelo próprio perfil. Para o **titular B** este canal **não serve** (ele não tem conta).
2. **Formulário web público (não-logados / casos especiais):** o caminho natural do **titular B** (autor de terceiro) e de qualquer pessoa sem conta. Deve coletar o **mínimo**: identificação do conteúdo (URL de origem e/ou nome exibido) e o pedido. **Não exigir** documentos ou dados adicionais como condição (Art. 6º, III — necessidade). **No ar** em `/seus-direitos` (`POST /api/legal/takedown`).
3. **Canal de privacidade/Encarregado por e-mail:** o endereço do item (a). **Sempre necessário** (é o canal mínimo — obrigatório seja como Encarregado formal, seja como canal de comunicação de ATPP; ver **[VALIDAR]** acima). O endereço já está publicado; falta o dono confirmar que o alias recebe e-mail (registros MX).

> **[VALIDAR]** Como o titular B é frequentemente uma pessoa **fora do Brasil** (sites en-US da allowlist), confirmar se o texto do canal deve ser bilíngue e se há requisito extra de resposta para titulares estrangeiros.

---

## 3. SLA e alertas (Art. 19, II)

- **Prazo de resposta completa: 15 (quinze) dias** — interpretados como **corridos** (**[VALIDAR]** leve: o **Art. 19, II** fala apenas em "15 dias", sem qualificar corridos × úteis; "corridos" é a leitura mais aceita/ANPD) —, contados da data do requerimento do titular (**Art. 19, II, LGPD**). Confirmação/acesso em formato simplificado pode ser **imediato** (Art. 19, I), mas para remoção/eliminação vale o teto de 15 dias.
- **Alertas de SLA** (job agendado/cron sobre os tickets DSAR abertos):
  - **Dia 10 — alerta amarelo:** aviso no ticket de que o prazo se aproxima.
  - **Dia 13 — alerta vermelho + escalonamento** ao Encarregado.
  - **Dia 15 — limite:** se ainda não atendido, **responder ao titular obrigatoriamente** (mesmo que para informar andamento/impossibilidade justificada) e registrar o motivo. Atraso é sempre desfavorável — evitar.
- Cada pedido vira um **ticket com data de recebimento** (o relógio começa aqui) e status rastreável até o fechamento.

> **[VALIDAR]** Se o pedido tocar **decisão automatizada** (Art. 20) ou for um caso de **agente de tratamento de pequeno porte**, há regimes de prazo diferentes (ex.: Res. CD/ANPD 2/2022 prevê 30 dias para ATPP em certas hipóteses). Confirmar qual prazo se aplica ao Refogando.

---

## 4. Fluxo passo-a-passo da remoção do nome — amarrado ao código real

O **efeito técnico** já existe: `clearSourceAttribution` (`src/server/recipe/clear-attribution.ts`), exposto por `POST /api/recipes/[id]/clear-attribution` (`src/app/api/recipes/[id]/clear-attribution/route.ts`). Comportamento **exato** (verificado no código):

- **Zera SÓ `source_name`** (`set { sourceName: null, updatedAt }`). **Nunca toca `origin` nem `source_url`.**
- **Só executa o UPDATE** quando: `origin === 'web_imported'` **E** `sourceUrl != null` **E** o `source_name` é um **nome humano diferente do host** (predicado `sourceNameIsHost` de `src/domain/source-host.ts`). Caso contrário é **no-op idempotente**: responde 200 sem UPDATE e sem bump de `updatedAt`.
- **Autorização por ownership:** receita de catálogo (`ownerId` NULL) ou de outro usuário ⇒ **404** (nunca 403, ADR-0011 — não vaza existência). A rota exige **sessão** antes de tocar o banco.
- Após a remoção, a atribuição **sobrevive rebaixada ao host** derivado de `source_url` (o link "ver no site" continua). É **irreversível para o nome** (a URL só re-deriva o host, nunca o nome original).

### 4.1 Por que a URL FICA — e até onde isso é defensável

O `source_url` **permanece por decisão de produto** (ADR-0019: atribuição é **obrigatória**, não opcional; ancorada no **direito moral de atribuição do autor** — ter o nome indicado/anunciado como autor —, **Lei 9.610/98, Art. 24, II**) e porque a URL é um **localizador de conteúdo publicamente publicado pelo próprio autor** (base candidata: **dado comum tornado manifestamente público pelo titular**, **Art. 7º, §4º**; e **legítimo interesse**, **Art. 7º, IX**).

> **[VALIDAR] — ponto central para o advogado:** manter a `source_url` após um pedido de remoção é defensável **quando o pedido é "tire meu nome"**. Mas há tensão real com o **direito de eliminação/oposição** (Art. 18, VI e §2º) **se a própria URL contiver dados pessoais** (ex.: domínio/caminho com o nome da pessoa, `blog-da-maria-silva.com/...`) ou se o titular pedir a remoção **integral**, não só do nome. Nesse cenário, "só zerar o nome" **não basta**. Precisamos de sua orientação sobre: (i) até quando a atribuição obrigatória prevalece sobre o pedido do titular; (ii) em que hipóteses devemos escalar para **remoção total** (ver GAP-3). Nossa posição de partida: honrar remoção total quando solicitada, mesmo perdendo a atribuição.

### 4.2 Fluxo operacional do pedido (titular B — autor de terceiro)

O titular B **não tem login**, então o atendimento é **mediado pelo operador**, com as ferramentas abaixo:

1. **Recebimento.** O formulário `/seus-direitos` (`POST /api/legal/takedown`) cria um registro em `takedown_ticket` com `received_at` (**início do prazo de 15 dias**) e grava `DSAR_RECEIVED` na mesma transação. Pedidos por e-mail chegam em `privacidade@refogando.com`. Se as credenciais do Brevo estiverem configuradas, o encarregado recebe um aviso.
2. **Verificação de identidade mínima** (Art. 6º, III). O formulário **não exige documento**: pede tipo do pedido, URL de origem e/ou nome exibido, mensagem e, opcionalmente, um e-mail de contato. A verificação é feita pelo operador, fora do app. **Gap:** o evento `DSAR_IDENTITY_VERIFIED` existe no esquema, mas nada o grava hoje.
3. **Localização e prévia.** `POST /api/admin/attribution/clear` sem `apply` devolve, sem alterar nada, as receitas importadas que casam pelo `source_name` (normalizado) ou pelo `source_url` (exato), de **qualquer** usuário, inclusive privadas.
4. **Remoção do nome.** A mesma rota com `apply:true` zera `source_name` em todas elas (mantém `source_url`; pula as que já exibem só o host) e grava `DSAR_FULFILLED` com **hash** do que foi removido. Aceita um `caseId` para ligar a remoção ao pedido.
5. **Escalada além do nome.** `POST /api/admin/attribution/escalate` com `url_unlink` (zera URL e nome) ou `record_deletion` (apaga a receita importada e as imagens próprias), também com prévia por padrão e auditoria com hash. **Quando** escalar continua sendo decisão do operador à luz da orientação jurídica (§4.1).
6. **Resposta ao titular** dentro do prazo, e **encerramento** do ticket no painel de SLA (`/admin/descoberta`): "Marcar como atendido" grava `DSAR_FULFILLED`; "Recusar" exige motivo e grava `DSAR_REJECTED`. O ticket encerrado sai do painel e do cron de alertas.

> Para o **titular A** (usuário logado), a remoção do nome de **suas próprias** receitas importadas já é **self-service**: o botão na tela de detalhe chama `POST /api/recipes/[id]/clear-attribution`. Esse fluxo está pronto; o que falta é o resto do DSAR de conta (§8).

---

## 5. Audit logging dos eventos DSAR + retenção ≥ 5 anos

Cada pedido deve gerar entradas de auditoria (a skill DSAR e o Art. 10 da Res. CD/ANPD 15/2024 embasam):

- `DSAR_RECEIVED` — canal, tipo de pedido, data (marca o início do SLA).
- `DSAR_IDENTITY_VERIFIED` — método de verificação usado.
- `DSAR_FULFILLED` — **com hash** do que foi entregue/alterado (ex.: hash de `{ recipeIds afetados, source_name removido, timestamp }`).
- `DSAR_REJECTED` — **com motivo** (ex.: solicitante não comprovou ser o titular; conflito com retenção legal).

**Retenção mínima de 5 anos** dessas entradas (prova de conformidade). O log deve ser **append-only** e conter o mínimo necessário — **não** armazenar o nome removido em claro se puder ser substituído por hash (senão a auditoria vira uma cópia do dado que se pediu para remover).

> **Situação atual (GAP-5 fechado, PR #402):** a tabela `dsar_audit_event` (`src/server/legal/dsar-audit.ts`) recebe só inserções; `DSAR_FULFILLED` exige hash SHA-256 (CHECK no banco) e nunca guarda o nome em claro. Ressalvas: (a) "só inserção" é garantido pelo código, não por trigger ou permissão no banco; (b) não há prazo de expurgo (o registro é mantido indefinidamente) — ver #473; (c) a remoção feita pelo **dono** da receita (`clearSourceAttribution`) continua sem entrada de auditoria, porque é o próprio usuário editando a sua cópia, não um pedido de titular.

---

## 6. Verificação de identidade e eliminação vs. retenção (Arts. 6º III, 16)

- **Identidade (Art. 6º, III — necessidade):** autenticado ⇒ suficiente; não-autenticado ⇒ o mínimo (confirmação pelo contato público já ligado à URL). **Proibido** exigir mais dados pessoais como condição de atendimento.
- **Eliminação × retenção legal (Art. 16):** para o **titular A**, um pedido de exclusão de conta deve checar retenções obrigatórias (fiscal/registros) → **bloqueio lógico + anonimização** durante o prazo, eliminação depois. Para o **titular B**, não há retenção fiscal do "nome do autor" — a única razão de manter algo é a **atribuição** (§4.1), que **cede** diante de um pedido de eliminação integral legítimo **[VALIDAR]**.

---

## 7. Base legal do dado do titular B (recap — depende do sign-off)

Para `source_name` + `source_url` de receitas `web_imported`, as bases candidatas são **legítimo interesse** (**Art. 7º, IX**) e/ou **dado comum tornado manifestamente público pelo titular** (**Art. 7º, §4º**), com **LIA documentada**. **[VALIDAR]** qual prevalece e se é preciso registrar a LIA formalmente. (Detalhamento no `docs/legal/briefing-juridico-descoberta-web.md`.)

---

## 8. Gaps entre a postura e o repo — situação atual

| # | Gap (versão de 2026-07-01) | Situação em 2026-09-24 |
|---|---|---|
| **GAP-1** | Política de Privacidade | **Fechado.** Publicada em `/privacidade` (PR #405 e #418), com a Parte (b) sobre a Descoberta na web. Sem sign-off jurídico. |
| **GAP-2** | Canal público + encarregado | **Fechado.** `/seus-direitos` + formulário + `privacidade@refogando.com`; encarregado nomeado (Fernando Lisboa) (PR #407). **Depende do dono:** criar o alias de e-mail (MX) que já está publicado. |
| **GAP-3** | Remoção além do nome | **Fechado (mecanismo).** `url_unlink` / `record_deletion` (PR #409). Critério de uso pendente do advogado (§4.1). |
| **GAP-4** | Operador atender o titular B | **Fechado.** Remoção em lote por nome ou URL (PR #406). |
| **GAP-5** | Auditoria DSAR | **Fechado.** `dsar_audit_event` com hash (PR #402). Ver ressalvas na §5. |
| **GAP-6** | Formulário de intake + DSAR do titular A | **Fechado.** Formulário (PR #407); exportação e eliminação (PR #410); expurgo de fotos após 180 dias (cron `account-purge`). |
| **GAP-7** | Alertas de SLA | **Fechado.** Cron diário, alertas 10/13/15, e-mail ao encarregado, painel admin (PRs #408, #415, #416). **Depende do dono:** `BREVO_API_KEY`, `DSAR_MAIL_FROM`, `DSAR_DPO_EMAIL`, `CRON_SECRET`. |
| **Novo** | Fechamento do ticket | **Fechado.** O painel de SLA tem "Marcar como atendido" e "Recusar" (com motivo): `POST /api/admin/takedown-sla/resolve` muda o status e grava `DSAR_FULFILLED` (hash) ou `DSAR_REJECTED` (motivo). `DSAR_IDENTITY_VERIFIED` continua sem gravação (a verificação é feita fora do app). |
| **Novo** | Retenção | **Aberto (advogado + #473).** Tickets de takedown, log de auditoria e conteúdo de contas eliminadas sem prazo definido. |

**O que ainda bloqueia ligar a Descoberta na web (#276):** o **sign-off jurídico** dos pontos **[VALIDAR]** — sobretudo §4.1 (quando a atribuição cede) e §7 (base legal) — e a configuração operacional do dono (alias de e-mail e Brevo), sem a qual o canal publicado pode não receber pedidos.

---

## 9. Perguntas objetivas para o(a) advogado(a)

1. Manter `source_url` após remover o nome é defensável em todos os casos, ou há hipóteses (URL contém o nome; pedido de eliminação integral) em que a atribuição obrigatória **deve ceder**? (§4.1)
2. Base legal definitiva para nome+URL do autor de terceiro: legítimo interesse (Art. 7º, IX), dado manifestamente público (Art. 7º, §4º), ou ambos com LIA? (§7)
3. Prazo aplicável confirmado (15 dias, Art. 19 II — corridos?) e se algum regime especial (ATPP/Art. 20) altera isso. (§3)
4. O Refogando é **ATPP**? Em caso positivo, confirmar se a indicação formal do Encarregado é dispensada (Res. 2/2022) e o que basta publicar. (§2/GAP-2)
5. Conteúdo mínimo exigido no canal público e na Política de Privacidade quanto a essa coleta. (GAP-1/GAP-2)
6. Como tratar o titular B **estrangeiro** (sites en-US) e a **verificação de identidade** aceitável sem onerar. (§2, §6)

---

### Referências de código (fonte de verdade)
- `src/db/schema.ts` (~L216-222) — `source_url`, `source_name` (nullable, sem default/CHECK; invariante de rota).
- `src/server/import/persist-import.ts` — grava `origin='web_imported'`, `sourceUrl`, `sourceName`; `description: null` (não copia headnote).
- `src/server/recipe/clear-attribution.ts` — `clearSourceAttribution` (zera só o nome; mantém a URL; ownership→404).
- `src/app/api/recipes/[id]/clear-attribution/route.ts` — `POST`; sessão antes do DB; 404 leak-safe.
- `src/domain/source-host.ts` — `sourceNameIsHost` / `bareHost` (regra "é só o host?").
- `src/domain/web-search-config.ts` — **allowlist (fonte única)**: `isUrlAllowed` (host na allowlist E protocolo http(s)) e `MAX_ALLOWLIST=50` (const privada; cap do guard de SSRF/import).
- `src/server/web-search/web-search-provider.ts` — provedor de busca web (Brave): `MAX_WEB_RESULTS=5` (saída capada) e `MAX_SITE_QUERIES=8` (domínios consultados por busca); gate de deploy `WEB_SEARCH_API_KEY` (sem a chave, retorna `[]`).
- `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md` — postura e pilares.
- `docs/legal/briefing-juridico-descoberta-web.md` — briefing de entrada da consulta.

### Referências legais (nossa pesquisa — a validar)
LGPD Arts. 6º III, 7º IX (legítimo interesse), 7º §4º (dado comum tornado manifestamente público pelo titular), 9º, 10, 16, 18 (I–IX), 19 (I, II), 20, 41; Lei 9.610/98 Art. 24, II (direito moral de atribuição — ter o nome indicado/anunciado como autor); Res. CD/ANPD 18/2024 (Encarregado); Res. CD/ANPD 15/2024 Art. 10 (retenção de registros); Res. CD/ANPD 2/2022 (ATPP — dispensa a indicação formal do Encarregado, exige canal de comunicação).

*Rascunho interno do Refogando — não é aconselhamento jurídico. Depende de revisão e assinatura profissional antes de qualquer publicação ou go-live.*
