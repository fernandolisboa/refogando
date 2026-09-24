> **Rascunho para revisão jurídica — não constitui parecer.**
> Este documento e os demais deste pacote são **rascunhos internos do Refogando**, produzidos pela equipe de produto/engenharia com apoio de *skills* de conformidade (LGPD) ancoradas na **Lei nº 13.709/2018 (LGPD)**. Eles descrevem a postura que **já adotamos** e a fundamentam com a **nossa** pesquisa interna. **Não** são parecer, opinião legal, nem posição de advogado. Onde a lei é incerta, o texto **convida explicitamente à validação**. Nada aqui deve ser tratado como aconselhamento jurídico até a **revisão e assinatura** de advogado(a) de PI/LGPD habilitado(a).

# Nota de capa — Consulta jurídica: Descoberta na web (Refogando, issue #276)

## 1. O que este pacote é — e o que NÃO é

**É:** um pacote de **revisão** para que o(a) advogado(a) **revise, corrija e assine** uma postura **concreta e já implementada** — não para construir do zero. Cada documento anexo é um **rascunho nosso**. Três deles foram elaborados com apoio das *skills* de conformidade que carregamos (todas ancoradas na LGPD, Lei nº 13.709/2018):

- **`lgpd-legal-basis`** → apoiou o rascunho da **base legal** (LGPD Art. 7);
- **`lgpd-privacy-policy`** → apoiou o rascunho da **seção de Política de Privacidade** (LGPD Art. 9);
- **`lgpd-dsar`** → apoiou o mapeamento de **direitos do titular** e do fluxo de remoção (LGPD Art. 18/19).

**NÃO é:**
- **Não é parecer** nem opinião jurídica. As citações de lei e de jurisprudência são a **nossa pesquisa interna** (registrada no ADR-0019), sujeitas a correção.
- **Não é uma decisão fechada.** Vários pontos dependem do seu juízo — estão listados na **seção 5**.
- **Não é o produto no ar.** A funcionalidade está **desligada em produção** e só será ligada após o fechamento dos 4 itens da issue #276 **e** da credencial de operação (ver **seção 6**).

## 2. Contexto em um parágrafo (para a nota se sustentar sozinha)

O **Refogando** é um app de receitas com IA (interface em pt-BR e en-US). A **Descoberta na web** mostra, quando o acervo local é raso e **só por ação explícita do usuário**, alguns **links externos** de sites de receita (marcados "da web"). Se o usuário **clica e confirma**, importamos a receita para a **coleção privada** dele. A postura inegociável: **a Busca nunca cria nem republica** — *exibir link ≠ importar; importar ≠ republicar*. A importação copia **só fatos** (ingredientes, passos, tempo, porções, cozinha), **nunca a foto nem o texto autoral (headnote/descrição)**, e é **sempre privada e não-publicável**. O único dado pessoal potencial que guardamos é o **nome do autor/publisher da fonte + a URL pública** — cujo **titular é o autor da receita de terceiro**, não o usuário do app.

## 3. Documentos do pacote

| # | Documento | Uma linha |
|---|-----------|-----------|
| 0 | **Esta nota de capa** (`docs/legal/pacote-consulta-juridica.md`) | Índice que amarra o pacote e prepara a revisão + assinatura. |
| 1 | **Briefing** (`docs/legal/briefing-juridico-descoberta-web.md`) | Resumo executivo: o que a feature faz, a postura já adotada e a pauta da consulta. |
| 2 | **LIA — Avaliação de Legítimo Interesse** (`docs/legal/lia-descoberta-web.md`) | Rascunho do teste de legítimo interesse (LGPD Art. 7, IX c/c Art. 10): finalidade, necessidade/minimização e balanceamento vs. o titular. |
| 3 | **Política de Privacidade** (publicada em `/privacidade`; texto-fonte em `src/i18n/messages/pt-BR.ts`, chave `privacidade`) | A política **já está no ar** (desde 2026-07, PR #418), incluindo a Parte (b) sobre a Descoberta na web. O antigo rascunho `docs/legal/politica-de-privacidade-secao-descoberta-web.md` virou só um ponteiro. Pedimos a revisão **do texto publicado**. |
| 4 | **Takedown e remoção do titular** (`docs/legal/takedown-e-remocao-titular.md`) | Rascunho do canal público e do fluxo de remoção/eliminação para o autor da fonte (LGPD Art. 18/19), incluindo a mecânica já existente de remoção do nome. |
| 5 | **Revisão de ToS da allowlist** (`docs/legal/revisao-tos-allowlist.md`) | Rascunho da conferência, site a site, de robots.txt e Termos de Uso dos domínios aprovados, para vetar quem proíbe **antes** de habilitar. |
| 6 | **ADR-0019** (`docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`) | A decisão de arquitetura/postura já aceita internamente, com a pesquisa jurídica que a fundamenta — o texto que pedimos que o(a) advogado(a) assine. |

## 4. Mapa dos 4 critérios de aceite da #276

> **Atualizado em 2026-09-24.** Entre 2026-07-01 e 2026-07-05 a engenharia fechou todos os gaps que a versão original deste pacote apontava (PRs #402–#418). O que resta é **revisão e assinatura** — não construção.

| Critério de aceite (#276) | Documento(s) que endereça | Status |
|---|---|---|
| **1. Sign-off da postura legal** (ADR-0019) | Briefing (doc 1) + ADR-0019 (doc 6) | **Pendente do advogado** — assinatura. |
| **2. Base legal LGPD documentada** | LIA (doc 2); Política publicada, item 3.4 e Parte (b) (doc 3) | **Publicada como legítimo interesse (Art. 7º, IX), com Art. 7º, §4º como alternativa** — pendente de **confirmação** e de assinatura da LIA. |
| **3. Contato de takedown + fluxo** | Takedown (doc 4); página `/seus-direitos` | **No ar**: formulário público + e-mail `privacidade@refogando.com` + encarregado nomeado (Fernando Lisboa) + prazo de 15 dias. Pendente de **validação** do fluxo e dos prazos. |
| **4. Ajustes de allowlist / Política** | Revisão de ToS (doc 5) + Política (doc 3) | Os **3 domínios a excluir já estão bloqueados no código** (`TOS_DENYLIST`). Pendente: **leitura verbatim dos 7 domínios em revisão manual** e revisão do texto publicado da Política. |

## 5. Perguntas objetivas para o(a) advogado(a)

São as decisões que **só o(a) advogado(a)** pode fechar. Respostas objetivas (sim/não + fundamento) bastam.

1. **Base legal.** A Política publicada adota **legítimo interesse (Art. 7º, IX + Art. 10)** como base primária e **Art. 7º, §4º** como alternativa para guardar **nome do autor + URL pública**. Está correto? Precisamos de **uma** base cravada.
2. **Manutenção da URL após remover o nome.** A remoção padrão zera só o `source_name` e mantém o `source_url` (o crédito cai para o *host*). Já existe a escalada técnica (desvincular a URL ou apagar a receita importada — seção 7). **Em que hipóteses** devemos escalar além do nome? O código não decide; o operador decide caso a caso.
3. **LIA e/ou RIPD.** A LIA (doc 2) basta, ou é preciso um **RIPD (Art. 38)**?
4. **Política publicada.** O texto no ar em `/privacidade` atende ao Art. 9º? Ele identifica o controlador como **pessoa física (Fernando Lisboa)**, sem razão social/CNPJ, e declara que o inventário de dados de conta "ainda será fechado". Isso é aceitável até a formalização da empresa?
5. **Encarregado e ATPP.** O controlador pessoa física se enquadra como **agente de tratamento de pequeno porte** (Res. CD/ANPD 2/2022)? Se sim, manter o encarregado nomeado é opcional, e o prazo de resposta pode ser diferente dos 15 dias que hoje prometemos.
6. **Contagem do prazo.** O sistema conta os 15 dias do Art. 19, II como **períodos de 24 h corridos** desde o recebimento (alertas aos 10/13/15). Corridos está certo, ou devem ser dias úteis?
7. **Retenção.** Qual prazo aplicar (issue #473) a: (a) conteúdo de contas eliminadas (transcrições de criação, avaliações e comentários em texto livre, receitas), hoje mantido e vinculado ao usuário anonimizado; (b) os tickets de takedown, que guardam a mensagem, o e-mail de contato e o nome informados pelo solicitante; (c) o log de auditoria DSAR, hoje sem prazo de expurgo (a nossa proposta era ≥ 5 anos).
8. **Domínios em revisão manual.** Dos 7 domínios sem leitura verbatim do ToS (doc 5, §4.5), quais podem entrar na allowlist?

## 6. Gate de produção (o que falta para ligar)

A Descoberta na web **só funciona** quando os três controles abaixo estão ligados; todos são "fail-closed" e hoje o padrão é desligado:

- **(A)** configuração admin `web_search_enabled` (padrão `false`) **e** allowlist não vazia (padrão `[]`, que também bloqueia qualquer importação);
- **(B)** credencial `WEB_SEARCH_API_KEY` (Brave) no ambiente — sem ela o provedor devolve vazio (`src/server/web-search/web-search-provider.ts`);
- **(C)** decisão do dono de ligar, **só após** os 4 critérios da #276.

**Gaps da versão de 2026-07-01 — situação atual:**

| # | Gap original | Situação em 2026-09-24 |
|---|---|---|
| GAP-1 | Sem Política de Privacidade | **Fechado.** Publicada em `/privacidade` (PR #405, publicada no #418), indexável e no rodapé. **Sem sign-off jurídico** ainda. |
| GAP-2 | Sem canal público nem encarregado | **Fechado.** `/seus-direitos` + `POST /api/legal/takedown` (sem login) + `privacidade@refogando.com` (PR #407). |
| GAP-3 | Remoção só do nome | **Fechado (mecanismo).** Escalada admin: `url_unlink` (zera URL e nome) ou `record_deletion` (apaga a receita importada) (PR #409). **Quando** usar é a pergunta 2. |
| GAP-4 | Operador não alcança receitas de terceiros | **Fechado.** Remoção de atribuição em lote por nome ou URL, alcança receitas privadas de qualquer usuário (PR #406). |
| GAP-5 | Sem auditoria DSAR | **Fechado.** Tabela `dsar_audit_event`, só inserção; `DSAR_FULFILLED` guarda **apenas hash** SHA-256 do que foi removido (PR #402). |
| GAP-6 | Sem DSAR self-service do usuário | **Fechado.** `GET /api/me/export` e `POST /api/me/erasure` (anonimização) (PR #410). |
| GAP-7 | Sem alertas de SLA | **Fechado.** Cron diário com alertas aos 10/13/15 dias, e-mail ao encarregado nos tickets vermelhos/vencidos, painel admin (PRs #408, #415, #416). |

**Pontos ainda abertos, declarados por honestidade:**
- **Retenção pós-eliminação** sem política definida (issue #473; pergunta 7).
- **Operação por e-mail depende de configuração do dono:** o alias `privacidade@refogando.com` (MX) e as credenciais do Brevo (`BREVO_API_KEY`, `DSAR_MAIL_FROM`, `DSAR_DPO_EMAIL`). Sem elas o site publica um e-mail que talvez não receba, e os alertas não saem.

## 7. Fatos técnicos verificáveis (âncoras no código)

- **Campos de atribuição:** `recipe.source_url` e `recipe.source_name` em `src/db/schema.ts` (nullable). Só receitas `origin='web_imported'` os preenchem.
- **Gravação na importação:** `src/server/import/persist-import.ts` grava `origin='web_imported'`, `visibility='private'`, `sourceUrl`, `sourceName` e `descricao: null` (headnote e foto não são copiados).
- **Remoção do nome pelo dono da receita:** `clearSourceAttribution` (`src/server/recipe/clear-attribution.ts`), `POST /api/recipes/[id]/clear-attribution`. Zera só `source_name`; ownership ⇒ 404 para terceiros.
- **Remoção pelo operador (autor externo):** `src/server/recipe/operator-clear-attribution.ts` — `POST /api/admin/attribution/clear` (nome, em lote, por `source_name` normalizado ou `source_url` exato) e `POST /api/admin/attribution/escalate` (`url_unlink` / `record_deletion`). Só admin; prévia sem efeito por padrão, `apply:true` executa; grava `DSAR_FULFILLED` com hash na mesma transação.
- **Canal público:** `src/app/[locale]/seus-direitos/page.tsx`, `src/app/api/legal/takedown/route.ts`, `src/domain/takedown.ts` (tipo do pedido, URL e/ou nome exibido, mensagem, e-mail opcional; **nenhum documento** exigido). Tabela `takedown_ticket`; `received_at` inicia o prazo.
- **Auditoria:** `dsar_audit_event` (`src/server/legal/dsar-audit.ts`). Só inserção, garantida pelo código (não há trigger no banco).
- **Prazo:** `src/domain/dsar-sla.ts` (10/13/15 × 24 h); cron `/api/cron/dsar-sla` em `vercel.json`.
- **Allowlist e denylist:** `src/domain/web-search-config.ts` — `TOS_DENYLIST` (panelinha, guiadacozinha, foodnetwork e subdomínios; o admin não consegue adicioná-los) e teto de 50 domínios.

## 8. O que pedimos de volta

Para dar o go-live, precisamos de: **(a)** a **postura do ADR-0019 revisada e assinada**; **(b)** as **8 respostas** da seção 5, com a **base legal cravada e citada**; **(c)** as **correções** ao texto publicado da Política e ao fluxo de takedown; **(d)** a lista de domínios em revisão manual que podem entrar; e **(e)** os prazos de retenção da pergunta 7. Com isso fechamos os 4 critérios da #276.

---

*Rascunho — versão para revisão jurídica. Sujeito a alteração conforme o retorno do(a) advogado(a).*

