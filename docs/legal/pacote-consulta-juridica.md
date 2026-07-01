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

O **Refogando** é um app de receitas com IA, bilíngue. A **Descoberta na web** mostra, quando o acervo local é raso e **só por ação explícita do usuário**, alguns **links externos** de sites de receita (marcados "da web"). Se o usuário **clica e confirma**, importamos a receita para a **coleção privada** dele. A postura inegociável: **a Busca nunca cria nem republica** — *exibir link ≠ importar; importar ≠ republicar*. A importação copia **só fatos** (ingredientes, passos, tempo, porções, cozinha), **nunca a foto nem o texto autoral (headnote/descrição)**, e é **sempre privada e não-publicável**. O único dado pessoal potencial que guardamos é o **nome do autor/publisher da fonte + a URL pública** — cujo **titular é o autor da receita de terceiro**, não o usuário do app.

## 3. Documentos do pacote

| # | Documento | Uma linha |
|---|-----------|-----------|
| 0 | **Esta nota de capa** (`docs/legal/pacote-consulta-juridica.md`) | Índice que amarra o pacote e prepara a revisão + assinatura. |
| 1 | **Briefing** (`docs/legal/briefing-juridico-descoberta-web.md`) | Resumo executivo: o que a feature faz, a postura já adotada e a pauta da consulta. |
| 2 | **LIA — Avaliação de Legítimo Interesse** (`docs/legal/lia-descoberta-web.md`) | Rascunho do teste de legítimo interesse (LGPD Art. 7, IX c/c Art. 10): finalidade, necessidade/minimização e balanceamento vs. o titular. |
| 3 | **Política de Privacidade — seção Descoberta na web** (`docs/legal/politica-de-privacidade-secao-descoberta-web.md`) | Rascunho da seção a publicar (LGPD Art. 9): quais dados de terceiros tratamos, base legal, finalidade, compartilhamento e direitos. |
| 4 | **Takedown e remoção do titular** (`docs/legal/takedown-e-remocao-titular.md`) | Rascunho do canal público e do fluxo de remoção/eliminação para o autor da fonte (LGPD Art. 18/19), incluindo a mecânica já existente de remoção do nome. |
| 5 | **Revisão de ToS da allowlist** (`docs/legal/revisao-tos-allowlist.md`) | Rascunho da conferência, site a site, de robots.txt e Termos de Uso dos domínios aprovados, para vetar quem proíbe **antes** de habilitar. |
| 6 | **ADR-0019** (`docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`) | A decisão de arquitetura/postura já aceita internamente, com a pesquisa jurídica que a fundamenta — o texto que pedimos que o(a) advogado(a) assine. |

## 4. Mapa dos 4 critérios de aceite da #276

| Critério de aceite (#276) | Documento(s) que endereça | Status |
|---|---|---|
| **1. Sign-off da postura legal** (assinar a postura do ADR-0019 antes do go-live) | Briefing (doc 1) + ADR-0019 (doc 6) | **Rascunho pronto** — pendente da revisão + **assinatura** do advogado. |
| **2. Base legal LGPD documentada** (qual base do Art. 7 sustenta guardar nome+URL do autor) | LIA (doc 2); reflexo na Política (doc 3) | **Rascunho pronto** — pendente de **confirmação/correção da base** e do teste de balanceamento. |
| **3. Contato de takedown + fluxo** (canal público e processo de remoção para o titular) | Takedown (doc 4) | **Rascunho pronto** — pendente de **definição de canal, prazo e encarregado** (hoje há **gap**: canal público ainda **não publicado**, ver seção 6). |
| **4. Ajustes de allowlist / Política de Privacidade** | Revisão de ToS (doc 5) + Política (doc 3) | **Rascunho pronto** — pendente de **quais domínios excluir por ToS** e do **conteúdo mínimo** exigido da Política. |

*Legenda de status:* **Rascunho pronto** = redigido por nós e verificável contra o código; **pendente do advogado** = precisa da sua revisão/decisão para fechar.

## 5. Perguntas objetivas para o(a) advogado(a)

São as decisões que **só o(a) advogado(a)** pode fechar. Respostas objetivas (sim/não + fundamento) bastam para liberarmos o go-live.

1. **Base legal mais defensável.** Para guardar **nome do autor + URL pública** (dado comum, de **terceiro** — o autor da receita), qual base do LGPD Art. 7 é a mais defensável: **legítimo interesse (Art. 7, IX,** c/c **Art. 10)** ou o tratamento de **dado tornado manifestamente público pelo titular (Art. 7, §4º)**? *(Vimos também levantar-se o Art. 7, IV — pedimos que confirme se ele se aplica ou não a este caso.)* Precisamos de **uma** base cravada e citada.
2. **Manutenção da URL após remover o nome.** Nossa remoção do nome zera **só** o `source_name` e **mantém** o `source_url` (a atribuição obrigatória cai para o *host* derivado da URL — ver seção 7). Isso é **defensável** perante o direito de eliminação/oposição do titular (LGPD Art. 18), ou a URL também precisa poder ser removida em algum cenário?
3. **LIA e/ou RIPD.** Se a base for legítimo interesse, o **LIA** (doc 2, Art. 10) é suficiente, ou este tratamento exige também um **RIPD / Relatório de Impacto (LGPD Art. 38)**?
4. **Conteúdo mínimo da Política de Privacidade.** Além dos elementos do **LGPD Art. 9**, o que é **indispensável** na seção publicada para cobrir o tratamento de dados de **terceiros** (autores das fontes)? Precisamos publicar uma Política — hoje **não existe** nenhuma publicada (gap na seção 6).
5. **Canal e prazo de takedown.** Qual **canal público** (e-mail? formulário?) e qual **prazo de resposta** devemos comprometer para pedidos de remoção do autor da fonte? Precisamos **nomear um encarregado (DPO, LGPD Art. 41)** e publicar contato para este go-live?
6. **Domínios a excluir por ToS.** Da allowlist proposta (doc 5), **algum domínio** deve ser **removido** por robots.txt ou Termos de Uso que proíbam o uso que fazemos (fetch por ação do usuário + cópia de fatos + atribuição)?

## 6. Gate de produção (o que falta para ligar)

A **flag de produção da Descoberta na web só liga** quando **ambos** estiverem satisfeitos:

- **(A) Os 4 critérios da #276 fechados** — isto é, os documentos deste pacote **revisados e a postura assinada** por advogado(a); e
- **(B) A credencial de operação `WEB_SEARCH_API_KEY` configurada** — sem ela, o provedor real de busca (Brave) fica **desligado** e retorna vazio por design (`src/server/web-search/web-search-provider.ts`).

**Gaps conhecidos que a consulta precisa resolver** (declarados por honestidade, não escondidos):
- **Não há Política de Privacidade publicada** no produto (nenhuma página/rota). O doc 3 é o rascunho a publicar.
- **Não há canal público de takedown nem encarregado (DPO) anunciado.** A única capacidade hoje é a **rota técnica** de remoção do nome, acionável **apenas pelo dono logado da receita** — **não** é um canal para o autor da fonte (terceiro) pedir remoção. O doc 4 propõe fechar esse gap.
- **Não há endpoint self-service de DSAR completo** (LGPD Art. 18). A remoção existente cobre só o `source_name` de **uma** receita importada — não acesso, portabilidade ou eliminação de conta.

## 7. Fatos técnicos verificáveis (âncoras no código)

Para a revisão poder conferir a postura contra o comportamento real (não contra promessas):

- **Campos de atribuição:** `recipe.source_url` e `recipe.source_name` em `src/db/schema.ts` (ambos *nullable*, sem *default*, sem *CHECK*; comentário "Atribuição da importação da web (#165, ADR-0019)"). Só receitas `origin='web_imported'` os preenchem; toda outra receita os deixa **NULL**.
- **Gravação na importação:** `src/server/import/persist-import.ts` grava `origin='web_imported'`, `sourceUrl`, `sourceName` — e **`description: null`** (o headnote autoral **não** é copiado; a foto também **não** — a importada nasce sem imagem).
- **Remoção do nome (LGPD):** `clearSourceAttribution` em `src/server/recipe/clear-attribution.ts`, exposta por `POST /api/recipes/[id]/clear-attribution`. Comportamento exato: **zera só `source_name`** (`set { sourceName: null, updatedAt }`), **nunca** toca `origin` nem `source_url`; só age quando `origin==='web_imported'` **e** há `source_url` **e** o nome é **humano** (≠ *host*, predicado `sourceNameIsHost` de `src/domain/source-host.ts`); caso contrário é **no-op idempotente**. Autorização por **ownership**: `ownerId` NULL (catálogo) ou diferente do usuário ⇒ **404** (nunca 403, não vaza existência).
- **Allowlist:** `src/server/web-search/web-search-provider.ts` é a **fonte única** de domínios (gerida por admin, teto de 50), provedor **Brave**; sem `WEB_SEARCH_API_KEY` o provedor real fica desligado.

## 8. O que pedimos de volta

Para dar o go-live, precisamos de: **(a)** a **postura do ADR-0019 revisada e assinada**; **(b)** as **6 respostas** da seção 5, com a **base legal cravada e citada**; **(c)** o **texto final (ou correções)** da seção de Política de Privacidade e do fluxo de takedown; e **(d)** a **lista de domínios a excluir** da allowlist, se houver. Com isso fechamos os 4 critérios da #276 e habilitamos a credencial de operação.

---

*Rascunho — versão para revisão jurídica. Sujeito a alteração conforme o retorno do(a) advogado(a).*

