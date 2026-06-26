# Briefing jurídico — Descoberta na web (issue #276)

> **Para quê serve este documento:** levar a um **advogado de PI/LGPD brasileiro** para obter o **sign-off da postura** antes de ligar a "Descoberta na web" em produção. Ele resume o que a feature faz, a postura que já adotamos (com guard-rails), e traz a **lista de perguntas** e os **materiais** para a consulta. **Não é parecer jurídico** — é o material de entrada da consulta. As referências legais abaixo são a *nossa pesquisa interna* (registrada no ADR-0019), que o advogado deve **validar ou corrigir**.

---

## 1. O que é o Refogando e o que a feature faz

O **Refogando** é um app de receitas com IA, bilíngue (pt-BR / en-US). A **Busca** ajuda o usuário a encontrar receitas no nosso acervo. Como o acervo nasce raso, criamos a **Descoberta na web**: quando o acervo local traz poucos resultados (ou por ação explícita do usuário), a Busca mostra **alguns links externos** de sites de receita, marcados "da web". Se o usuário **clica e confirma**, importamos a receita para a **coleção privada** dele.

Princípio central: **a Busca nunca cria nem republica.** Linkar ≈ comportamento de buscador; importar ≈ recortar uma receita para uso pessoal privado; **republicar conteúdo de terceiros é o que evitamos.**

## 2. A postura que já adotamos (a ser revisada, não construída do zero)

Queremos que o advogado **revise e assine** esta postura concreta — não partir de uma pergunta aberta. Os pilares:

1. **Allowlist curado, não web aberta.** Só buscamos/importamos de uma lista fechada de domínios que **nós aprovamos um a um**, conferindo robots.txt e Termos de Uso de cada site **antes** de adicioná-lo. (Web aberta fica como escalada futura, exigiria nova revisão.)
2. **Copiamos só fatos, não a camada expressiva.** A receita importada traz **apenas dados funcionais** — ingredientes, passos, tempo, porções, tipo de cozinha. **Não** copiamos:
   - a **foto** (a receita importada nasce **sem imagem**; o dono completa depois);
   - o **`description`/headnote** (o texto autoral em prosa fica em branco; o dono escreve o dele).
3. **Importação é sempre privada e não-publicável.** O usuário não consegue tornar pública nem republicar uma receita importada. O toggle "tornar pública" só existe para receitas **criadas pelo próprio usuário ou geradas por IA**.
4. **Atribuição obrigatória.** Toda receita importada guarda **nome do autor/fonte + URL de origem** e credita "fonte: …", com link. (Direito **moral** de atribuição — Lei 9.610 — e ainda manda tráfego de volta para a fonte.)
5. **Guard-rails técnicos** (já implementados — issues #271/#272):
   - **respeita robots.txt** (RFC 9309; só bloqueia quando o site proíbe explicitamente);
   - **User-Agent identificado** (`RefogandoBot/1.0`) — não fingimos navegador;
   - **rate-limit** de politeness (~1 requisição/segundo por domínio);
   - **fetch só por ação explícita do usuário** — nunca crawl automático de fundo;
   - **botão de remoção do nome do autor** (rota já existe) + previsto **canal de takedown**.
6. **LGPD — dado pessoal guardado é mínimo:** **só o nome do autor + a URL pública**. Base legal candidata: **legítimo interesse** e/ou **dado manifestamente tornado público pelo titular** (art. 7º, IX, e art. 11, §4º da LGPD) — **é exatamente isto que precisa do aval do advogado.**

## 3. A nossa leitura do risco (a confirmar com o advogado)

- **O eixo do risco não é "de onde se busca", é "o que se copia".** A **receita em si** (lista de ingredientes + modo de preparo funcional) tende a ser **fato não-protegível por direito autoral**:
  - **Brasil:** Lei 9.610/98, **art. 8º** (não são objeto de proteção como direitos autorais ideias, métodos, sistemas, esquemas etc.); há precedente do **TJ-SP** no sentido de que "receitas culinárias não podem ser registradas".
  - **EUA (referência comparada):** *Publications Int'l, Ltd. v. Meredith Corp.*, 88 F.3d 473, 480 (7th Cir. 1996) — a mera listagem de ingredientes não é protegível.
- **A camada expressiva É protegida** — a **foto** (vetor de infração mais provável) e a **prosa autoral** (headnote/`description`). Por isso **não copiamos nenhuma das duas**.
- **O risco vivo é contratual (Termos de Uso do site), não de "acesso não autorizado".** Por isso o **allowlist com verificação de ToS site a site** é o controle central. (No comparado norte-americano, pós-*hiQ v. LinkedIn*, *Van Buren v. US* e *Meta v. Bright Data*, o acesso a página pública não configura, por si, violação de lei de acesso — restando o eixo do contrato/ToS.)

> Nossa avaliação interna classifica a postura (allowlist + só-fatos + privado + atribuição + camada-protegida-excluída + guard-rails) como **risco baixo**, mas **queremos o aval profissional antes do go-live.**

## 4. O que levar à consulta

- [ ] Este briefing.
- [ ] O **ADR-0019** (`docs/adr/0019-...md`) — a decisão e a postura legal registrada.
- [ ] A **allowlist inicial** de domínios candidatos (pt-BR: tudogostoso, panelinha, cybercook, receiteria, guiadacozinha, receitasnestlé; en-US: allrecipes, simplyrecipes, seriouseats, foodnetwork, bbcgoodfood) — e, de 2 ou 3 deles, **print do robots.txt e dos Termos de Uso**.
- [ ] Um **exemplo real de receita importada** no app, mostrando: sem foto, sem headnote, com o crédito "fonte: … (link)" e a marca **privada**.
- [ ] A descrição dos **guard-rails técnicos** (UA, robots, rate-limit, fetch-por-ação) — seção 2.5 acima.
- [ ] O texto/rota de **remoção do nome do autor** que já existe, para validar o fluxo de atendimento ao titular (LGPD).

## 5. O que perguntar (deliverables do sign-off)

**A) Postura geral (PI / copyright / concorrência)**
1. A postura "copiar só fatos (ingredientes/passos), nunca foto nem headnote, sempre privado e com atribuição" é **suficiente** para evitar infração de direito autoral e *passing-off* no Brasil? Falta algum elemento?
2. Como tratar o **risco contratual de ToS**? Basta a verificação manual no allowlist, ou convém uma cláusula/critério documentado de aprovação de domínio? Há sites cujos ToS proíbem expressamente uso automatizado que deveríamos **excluir** do allowlist?
3. Importar para coleção **privada** muda a análise em relação a exibir só o link? Há limite de quantidade/uso que transformaria "uso pessoal" em algo problemático?

**B) LGPD (guardar o nome do autor)**
4. Qual a **base legal** mais defensável para armazenar **nome do autor + URL**: **legítimo interesse** (art. 7º, IX) ou **dado manifestamente tornado público** (art. 11, §4º)? Precisamos de **LIA** (avaliação de legítimo interesse) documentada?
5. O **botão de remoção do nome** + a atribuição "fonte: …" são suficientes para atender direito do titular? Qual prazo/fluxo de resposta a um pedido de remoção devemos adotar?
6. Precisamos atualizar a **Política de Privacidade** para mencionar essa coleta/uso? Há aviso específico exigido?

**C) Takedown / operação**
7. Que **canal de takedown/abuso** precisamos publicar (e-mail dedicado? formulário?) e o que ele deve prometer (prazo de resposta, remoção sob pedido)?
8. Há requisito de **registro/retenção** dos pedidos de remoção e das nossas respostas?

**D) Escopo futuro**
9. Se um dia abrirmos para **web aberta** (sem allowlist, com denylist de opt-out), o que muda na análise — e que controles adicionais seriam exigidos?

## 6. O que precisamos de volta para ligar em produção

A feature fica atrás de uma **flag de produção desligada** até termos, por escrito:

- [ ] **Sign-off da postura final** (seção 2 aprovada, com ajustes se houver).
- [ ] **Base legal LGPD** definida para o nome do autor + confirmação do fluxo de remoção.
- [ ] **Contato de takedown** definido (endereço a publicar) + fluxo de remoção sob pedido.
- [ ] Eventuais **ajustes no allowlist** (domínios a excluir por ToS) e na Política de Privacidade.

Só com esses quatro itens fechados a flag de produção da Descoberta na web é ligada (critério de aceite da issue #276). Há também um **gate técnico de deploy** independente: a credencial `WEB_SEARCH_API_KEY` do provedor de busca.

---

*Referências citadas são pesquisa interna (ADR-0019) a ser validada pelo advogado. Este documento não constitui aconselhamento jurídico.*
