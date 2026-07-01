# Refogando — Política de Privacidade (RASCUNHO) + Seção "Descoberta na web"

> **⚠️ RASCUNHO PARA REVISÃO JURÍDICA — NÃO CONSTITUI PARECER.**
> Este documento é um **rascunho interno** preparado por nós (equipe do Refogando) para que um **advogado de LGPD/PI brasileiro** **revise, corrija e assine** antes de qualquer publicação. É um **CHECKPOINT**: **não publicar sem revisão jurídica.** As referências legais são a *nossa leitura* e devem ser **validadas ou corrigidas** pelo advogado — sobretudo onde a lei é incerta (base legal, transferência internacional, retenção). Os campos entre `{ }` são **placeholders** a preencher (razão social, CNPJ, e-mail do encarregado etc.). Onde escrevemos "**[validar]**", pedimos confirmação profissional expressa.

---

## 🚩 SINAL DE ALERTA (prioridade máxima, maior que a issue #276)

**Hoje o Refogando NÃO possui Política de Privacidade publicada.** Verificamos o repositório: não há página de privacidade nem de termos em `src/app` (nenhuma rota `privacidade`/`privacy`/`termos`), nada em `public/`, e nenhum documento de política publicado. Existe apenas material preparatório interno (o briefing em `docs/legal/briefing-juridico-descoberta-web.md`) — que **não é** uma política publicada.

Isso é um **gap de conformidade mais amplo do que a issue #276**. A LGPD (Art. 9º) dá ao titular o **direito de acesso facilitado às informações sobre o tratamento** dos seus dados, e o Art. 6º, VI, impõe o princípio da **transparência**. O app **já trata dados pessoais** hoje — no mínimo dados de **conta de usuário** (autenticação) e o **nome de autores de receitas de terceiros** (feature de Descoberta na web). Na nossa leitura, operar sem uma política publicada tende a expor o controlador a risco regulatório independentemente da feature de Descoberta.

**Recomendação:** publicar uma **Política de Privacidade completa** (cobrindo os 7 elementos do Art. 9º) **antes** — ou no mesmo release — de ligar a "Descoberta na web" em produção. Este rascunho entrega **(a)** um esqueleto mínimo dessa política e **(b)** a seção específica da Descoberta na web. Ambos precisam do sign-off jurídico que o ADR-0019 já condiciona como pré-requisito de go-live.

---

# Parte (a) — Esqueleto mínimo de Política de Privacidade

> **TL;DR (resumo em 30 segundos)**
> - O **Refogando** é um app de receitas com IA, bilíngue (pt-BR / en-US).
> - **Coletamos o mínimo:** o necessário para você ter uma **conta** e usar o app, e — quando você **importa** uma receita de um site externo — o **nome do autor/site + o link de origem**, só para **dar o crédito** ("fonte: … (link)").
> - **Não vendemos seus dados.** Compartilhamos apenas com **prestadores de serviço** que fazem o app funcionar (hospedagem, banco, IA).
> - **Você tem direitos** (acesso, correção, exclusão etc. — Art. 18 da LGPD). Fale com nosso **encarregado**: `{e-mail do encarregado}`. Respondemos em **até 15 dias**.
> - Este texto pode mudar; avisamos quando mudar.

Estrutura abaixo segue os **7 elementos obrigatórios do Art. 9º da LGPD**.

## 1. Quem somos (identificação do controlador) — *Art. 9º, III*

O **controlador** dos dados é **{razão social}**, CNPJ **{CNPJ}**, com sede em **{endereço}**, responsável pelo aplicativo **Refogando** (**{URL do app}**).

*(Se hoje o projeto é operado por pessoa física, [validar] com o advogado a forma correta de identificar o controlador — pessoa física é admissível como controlador na LGPD, mas convém decidir a estrutura antes de publicar.)*

## 2. Contato do controlador e do encarregado (DPO) — *Art. 9º, IV; Art. 41*

- **Encarregado pelo tratamento de dados (DPO):** **{nome do encarregado}**
- **E-mail de contato para assuntos de privacidade e exercício de direitos:** **{e-mail do encarregado}**
- **Prazo de resposta:** respondemos a pedidos dos titulares em **até 15 dias** (LGPD, **Art. 19, II**).

> **GAP a resolver:** hoje **não há canal de privacidade/takedown publicado** nem encarregado anunciado. Existe apenas uma rota técnica interna de remoção do nome do autor (ver Parte (b)), acionável só pelo dono logado da receita — **não** é um canal público. **É necessário definir e publicar o e-mail do encarregado** antes de publicar esta política.

## 3. Para que usamos seus dados (finalidade específica) — *Art. 9º, I; Art. 6º, I*

Tratamos dados pessoais apenas para finalidades específicas e informadas. Cada atividade abaixo segue o padrão **Dados / Finalidade / Base legal (artigo) / Retenção**.

> **Nota de escopo:** o inventário completo de dados de conta/uso do app precisa ser **fechado com a equipe e validado** — o quadro abaixo é o **esqueleto** dos tratamentos que conseguimos confirmar. Itens marcados `{a completar}` dependem de verificação. A feature de **Descoberta na web** está detalhada na **Parte (b)**.

### 3.1. Conta de usuário e autenticação
- **Dados:** e-mail, nome/identificador de exibição (*handle*), credenciais de login e `{a completar: demais campos de conta}`.
- **Finalidade:** criar e manter sua conta, autenticar o acesso e permitir o uso do app.
- **Base legal:** **execução de contrato** com o titular — **Art. 7º, V** da LGPD. **[validar]**
- **Retenção:** enquanto a conta existir; após a exclusão da conta, eliminamos ou anonimizamos em `{prazo}` — `[validar prazo]`.

### 3.2. Conteúdo criado no app (receitas, coleções, avaliações)
- **Dados:** receitas que você cria, salva, avalia e organiza; preferências de idioma; conteúdo textual que você escreve.
- **Finalidade:** entregar a funcionalidade do app (guardar e exibir seu conteúdo, montar coleções, feed e busca).
- **Base legal:** **execução de contrato** — **Art. 7º, V**. **[validar]**
- **Retenção:** enquanto a conta existir ou até você apagar o conteúdo.

### 3.3. Imagens geradas por IA e conteúdo assistido por IA
- **Dados:** *prompts* e imagens que você gera; metadados de uso (para controle de custo/cota).
- **Finalidade:** gerar imagens de pratos e apoiar a criação de receitas; controlar limites de uso.
- **Base legal:** **execução de contrato** — **Art. 7º, V**; e **legítimo interesse** para prevenção de abuso/controle de custo — **Art. 7º, IX**. **[validar]**
- **Retenção:** `{a completar}`.

### 3.4. Atribuição de receitas importadas da web (feature "Descoberta na web")
- Detalhada na **Parte (b)** desta política. Em resumo: guardamos **nome do autor/site + URL de origem**, só para **dar crédito**. Base legal: **legítimo interesse — Art. 7º, IX** (com **dado manifestamente público — Art. 7º, §4º** como fundamento alternativo). **[validar]**

## 4. Como e por quanto tempo tratamos (forma e duração) — *Art. 9º, II*

- **Como:** os dados são tratados por meios eletrônicos, em servidores de **prestadores de serviço** contratados (ver item 5). Aplicamos medidas de segurança compatíveis (**Art. 46**), incluindo controle de acesso por autenticação e autorização por titularidade (o app impede que um usuário acesse ou altere dados de conta/receita de outro).
- **Por quanto tempo (duração/retenção):** mantemos cada dado **apenas pelo tempo necessário** à finalidade que o justifica (item 3) ou por obrigação legal. Ao encerrar a finalidade, **eliminamos ou anonimizamos** os dados (**Art. 15/16**). Prazos específicos: `[validar / completar a tabela de retenção]`.

## 5. Com quem compartilhamos (uso compartilhado) — *Art. 9º, V*

**Não vendemos dados pessoais.** Compartilhamos com **operadores** (prestadores de serviço que tratam dados em nosso nome, sob contrato) estritamente para operar o app:

| Prestador | Para quê | Categoria |
|---|---|---|
| **Vercel** | Hospedagem do aplicativo | Operador de infraestrutura |
| **Neon** | Banco de dados | Operador de infraestrutura |
| **Google (Gemini)** | Geração de imagens e *embeddings* de busca | Operador de IA |
| **Anthropic (Claude)** | Geração/assistência de texto | Operador de IA |
| **Brave Search** | Busca de links externos na "Descoberta na web" | Operador de busca |

- **Finalidade do compartilhamento:** exclusivamente a operação técnica das funções acima; nenhum desses parceiros recebe dados para finalidade própria de marketing.
- **⚠️ Transferência internacional:** alguns desses prestadores processam dados **fora do Brasil**. É preciso **[validar]** a base e as salvaguardas de **transferência internacional de dados** (LGPD, **Arts. 33 a 36**) e refletir isso aqui. **Ponto que exige validação jurídica.**

## 6. Responsabilidades dos agentes de tratamento — *Art. 9º, VI; Arts. 37–39*

- **{razão social}** atua como **controlador** e é responsável pelas decisões sobre o tratamento.
- Os prestadores do item 5 atuam como **operadores**, tratando dados **conforme nossas instruções** e sob contrato.
- Mantemos (ou passaremos a manter — `[validar/implementar]`) **registro das operações de tratamento** (**Art. 37**) e adotamos medidas de segurança (**Art. 46**). Em caso de incidente de segurança com risco relevante, comunicamos a ANPD e os titulares (**Art. 48**).

## 7. Seus direitos (direitos do titular) — *Art. 9º, VII; Art. 18*

Você, titular dos dados, tem os direitos garantidos pelo **Art. 18 da LGPD**, mediante requisição, entre eles:

1. **Confirmação** da existência de tratamento;
2. **Acesso** aos dados;
3. **Correção** de dados incompletos, inexatos ou desatualizados;
4. **Anonimização, bloqueio ou eliminação** de dados desnecessários, excessivos ou tratados em desconformidade;
5. **Portabilidade** a outro fornecedor, mediante requisição;
6. **Eliminação** dos dados tratados com consentimento (ressalvadas as hipóteses do Art. 16);
7. **Informação** sobre entidades com as quais compartilhamos dados;
8. **Informação** sobre a possibilidade de **não** fornecer consentimento e as consequências;
9. **Revogação do consentimento**;
10. Quando o tratamento se basear em **legítimo interesse**, o direito de **opor-se** e de solicitar informações (**Art. 18, §2º**, e **Art. 37**). **[validar]** *(o texto literal do Art. 18, §2º condiciona a oposição ao "descumprimento ao disposto nesta Lei"; a leitura ampla — oposição genérica ao legítimo interesse — é defensável, mas é interpretação a confirmar.)*

**Como exercer:** escreva para **{e-mail do encarregado}**. Respondemos em **até 15 dias** (**Art. 19, II**). Você também pode peticionar à **Autoridade Nacional de Proteção de Dados (ANPD)**.

> **GAP a resolver:** hoje **não existe endpoint self-service de DSAR completo** (acesso/portabilidade/eliminação de conta) — a única capacidade automatizada é a **remoção do nome do autor** de *uma* receita importada (ver Parte (b)). Recomenda-se implementar o fluxo de atendimento aos direitos do Art. 18 (a skill `lgpd-dsar` cobre isso) e, até lá, atender os pedidos **manualmente** dentro do prazo de 15 dias.

## 8. Alterações desta política

Podemos atualizar esta política. Quando houver mudança relevante, avisaremos por `{canal}` e registraremos a **versão e a data** de cada alteração.

**Versão:** `{vN}` — **Data:** `{AAAA-MM-DD}` — **Status:** RASCUNHO / não publicado / aguardando revisão jurídica.

---

# Parte (b) — Seção específica: "Descoberta na web"

> **TL;DR desta seção**
> - Quando você **importa** uma receita de um site externo, guardamos **duas coisas** sobre a origem: o **nome do autor/site** e o **link (URL)** — só para **creditar a fonte**.
> - **Não copiamos a foto nem o texto autoral** (a receita importada nasce **sem imagem** e **sem descrição**).
> - A receita importada é **sempre privada** — você não pode publicá-la nem republicá-la.
> - O dado pessoal aqui é o **nome do autor da receita de terceiro** — e **você, autor**, pode pedir a **remoção do seu nome** (o crédito passa a exibir só o site).

## b.1. O que é a Descoberta na web

O Refogando pode mostrar, na busca, **alguns links** de receitas de sites externos (marcados "da web"), a partir de uma **lista fechada de domínios que aprovamos um a um** (*allowlist*; provedor de busca: **Brave**). Se você **clica e confirma**, o app **importa** aquela receita para a sua **coleção privada**. Detalhes técnicos e a fundamentação estão no **ADR-0019** (`docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`).

- A busca **nunca cria nem republica** conteúdo de terceiros. Linkar ≠ importar; importar ≠ republicar.
- A *allowlist* é a **fonte única** de domínios (gerida por admin; até `MAX_ALLOWLIST=50` domínios; até `MAX_SITE_QUERIES=8` consultados por busca; saída limitada a `MAX_WEB_RESULTS=5`).
- Guard-rails técnicos já implementados (issues #271/#272): respeito ao **robots.txt** (RFC 9309), *User-Agent* identificado (**RefogandoBot/1.0**), *rate-limit* de cortesia (~1 req/s por domínio), e **busca/import só por ação explícita do usuário** — nunca *crawl* automático de fundo.

## b.2. Quem é o titular do dado aqui

O dado pessoal tratado nesta feature é o **nome do autor/publisher da receita de terceiro** — ou seja, o **titular é o autor da receita externa**, e **não** o usuário do app. Essa distinção é importante para o exercício de direitos (item b.5).

## b.3. Que dados coletamos, para quê, com que base e por quanto tempo

**Padrão Dados / Finalidade / Base legal (artigo) / Retenção:**

| | |
|---|---|
| **Dados** | Apenas **dois campos de atribuição**, gravados **só** em receitas importadas (`origin = 'web_imported'`): **`source_name`** (nome legível do autor/site) e **`source_url`** (URL pública de origem). Definidos em `src/db/schema.ts` (~L216–222). Toda receita que **não** é importada deixa esses dois campos nulos. |
| **O que NÃO coletamos** | **Não** copiamos a **foto** (a receita importada nasce **sem imagem**) nem o **texto autoral / headnote** (`descricao: null` na importação — `src/server/import/persist-import.ts`, L64–65). Isso reduz ao mínimo a superfície de dado de terceiros e evita copiar a camada expressiva protegida por direito autoral. |
| **Finalidade** | **Dar o crédito à fonte** ("fonte: … (link)") — cumprindo o **direito moral de atribuição** (Lei 9.610/98) — e mandar tráfego de volta ao site de origem. A atribuição é **obrigatória**, não opcional (ADR-0019). |
| **Base legal** | **Legítimo interesse** — **LGPD Art. 7º, IX** (interesse legítimo de creditar corretamente a fonte de conteúdo funcional publicamente disponível, com impacto mínimo ao titular). Fundamento **alternativo/complementar** a validar: **dado tornado manifestamente público pelo titular** (**Art. 7º, §4º**), já que o nome do autor é publicado pelo próprio site. **[validar qual base prevalece e se é necessária uma LIA — Avaliação de Legítimo Interesse — documentada, conforme Art. 10.]** |
| **Retenção** | Enquanto a receita importada existir na coleção privada do usuário, **ou** até o autor pedir a remoção do nome (item b.5), **ou** até o usuário apagar a receita. Ao remover o nome, `source_name` é zerado e o crédito passa a exibir apenas o **host** derivado da URL. |

## b.4. Compartilhamento nesta feature

Para **encontrar** os links externos, consultamos o provedor de busca **Brave** (operador), enviando o **termo de busca** restrito aos domínios da *allowlist*. A importação em si é uma cópia **feita a pedido do usuário**, guardada de forma **privada** na conta dele — **não** é republicada nem compartilhada com terceiros. (Gate de deploy: sem a credencial `WEB_SEARCH_API_KEY`, a busca web real fica **desligada**, retornando lista vazia.)

## b.5. Direitos do titular (autor da receita externa) e como exercer — *Art. 18*

Se você é **autor de uma receita** que foi importada para o Refogando e quer **remover o seu nome** da atribuição, você tem esse direito (**Art. 18, IV** — anonimização/eliminação de dado pessoal desnecessário; e o direito de **oposição** ao tratamento fundado em legítimo interesse, **Art. 18, §2º** — **[validar]**, pois o texto literal do dispositivo condiciona a oposição ao "descumprimento ao disposto nesta Lei", de modo que a oposição genérica ao legítimo interesse é interpretação a confirmar).

**Como funciona a remoção do nome (o que o código faz hoje, exatamente):**
- Existe a operação `clearSourceAttribution` (`src/server/recipe/clear-attribution.ts`), exposta por `POST /api/recipes/[id]/clear-attribution`.
- Ela **zera apenas `source_name`**; **nunca** toca a `source_url`. A **URL permanece** porque a atribuição é obrigatória (ADR-0019): após a remoção, o crédito é **rebaixado ao nome do site (host)** derivado da URL, e o link "ver no site" continua.
- Só altera dados quando há de fato um **nome humano** distinto do host (regra `sourceNameIsHost` em `src/domain/source-host.ts`); caso contrário é uma operação **idempotente sem efeito**.
- **Não é reversível para o nome original** — o que é adequado ao direito de remoção.

> **GAP importante a corrigir (transparência com o advogado):** hoje essa remoção **só pode ser acionada pelo dono logado da receita importada** — **não** por um autor externo. Ou seja, **não existe canal público** pelo qual o titular (autor da fonte) possa, por conta própria, pedir a remoção do seu nome; nem há **encarregado/canal de takedown publicado**. **Recomendação:** publicar um **canal de contato** (`{e-mail do encarregado}` e/ou formulário) para que autores externos peçam remoção, com **resposta em até 15 dias** (**Art. 19, II**), e um procedimento interno para executar a remoção e registrar o pedido (**Art. 37**). Esta seção **não deve ir ao ar** anunciando um direito que ainda não tem canal — o canal precisa existir junto com a publicação.

**Contato do encarregado para esta finalidade:** **{nome do encarregado}** — **{e-mail do encarregado}** — resposta em **até 15 dias**.

---

## Checklist de pendências para o advogado (o que precisamos que valide/assine)

1. **[validar]** Base legal do nome do autor: **legítimo interesse (Art. 7º, IX)** vs. **dado manifestamente público (Art. 7º, §4º)** — e se exige **LIA documentada** (Art. 10).
2. **[validar]** Bases legais dos tratamentos de **conta/conteúdo/IA** (item 3) — confirmamos "execução de contrato (Art. 7º, V)" como candidata.
3. **[validar]** **Transferência internacional** (Arts. 33–36) para Vercel/Neon/Google/Anthropic/Brave e a redação do item 5.
4. **[definir e publicar]** **Encarregado + e-mail de contato** e **canal público de takedown/remoção** para autores externos (fecha os GAPs dos itens 2, 7 e b.5).
5. **[validar]** **Tabela de retenção** com prazos concretos (itens 3, 4 e b.3).
6. **[decidir]** **Identificação do controlador** (pessoa física vs. jurídica; razão social/CNPJ).
7. **Sign-off final da postura do ADR-0019** antes do go-live da Descoberta na web (pré-requisito já registrado no ADR).

---

*Fontes internas de verdade citadas neste rascunho: `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`, `docs/legal/briefing-juridico-descoberta-web.md`, `src/db/schema.ts` (~L216–222), `src/server/import/persist-import.ts`, `src/server/recipe/clear-attribution.ts`, `src/domain/source-host.ts`, `src/server/web-search/web-search-provider.ts`, `src/app/api/recipes/[id]/clear-attribution/route.ts`. As referências legais são leitura interna a ser validada pelo advogado. **Este documento é um RASCUNHO e não deve ser publicado sem revisão jurídica.***
