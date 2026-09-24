> **Rascunho para revisão jurídica — não constitui parecer.** Este documento é material interno do Refogando, preparado por engenharia para servir de base à revisão e assinatura de um(a) advogado(a) de Propriedade Intelectual e LGPD. Não é opinião legal definitiva. Onde a lei é incerta ou depende de juízo jurídico (enquadramento de "fato vs. expressão", alcance de cláusulas de ToS, base legal), o texto sinaliza explicitamente **[VALIDAR COM O JURÍDICO]**. Nada aqui deve ir a produção sem a assinatura pedida no ADR-0019.

---

## 1. Objetivo e escopo

Consolidar, em um único lugar aterrado no código real, a **postura já adotada** pelo Refogando para a funcionalidade de "Descoberta na web" (busca federada em domínios de uma allowlist + importação privada de receitas), e submetê-la à revisão jurídica prevista no ADR-0019.

Duas entregas concretas para o(a) advogado(a):

1. Uma **análise LGPD** do único dado pessoal potencialmente tratado por esta funcionalidade (o **nome do autor/publisher** da receita de terceiro), com base legal proposta e os **gaps** de conformidade que engenharia identificou.
2. Uma **tabela de revisão de ToS/robots** dos domínios candidatos da allowlist (Seção 4), construída a partir de uma triagem automatizada — que **não substitui** a leitura jurídica do contrato de cada site.

Fora de escopo: dados dos usuários do app (conta, e-mail, receitas próprias). Aqui o titular relevante é o **autor da receita de terceiro**, não o usuário do Refogando.

---

## 2. Postura já adotada (resumo aterrado no código)

Referência de domínio: `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`. Eixo central da postura, confirmado pela pesquisa jurídica registrada no ADR (atualização 2026-06-24): **o risco não é "de onde se busca", é "o que se copia"**. A receita como fato funcional (ingredientes + passos) não é protegível por direito autoral (Lei 9.610, Art. 8º; e.g. TJ-SP; nos EUA *Publications Int'l v. Meredith*, 88 F.3d 473, 480); a **camada expressiva** — a **foto** e a **`description`/headnote** autoral — é protegida e **nunca é copiada**.

Pilares, com os caminhos de código que os impõem:

1. **Allowlist curada, não web aberta.** Só buscamos/importamos de domínios aprovados um a um. A allowlist é a **fonte única de domínios** e é **gerida por admin** (não fica hardcoded no provedor): o provedor a recebe pronta via `opts.allowlist` e a consome em `opts.allowlist.slice(0, MAX_SITE_QUERIES)` (`src/server/web-search/web-search-provider.ts`, ~L86). O que vive **nesse arquivo** são os **limites e o gate**, não a lista de sites: `MAX_SITE_QUERIES = 8` domínios consultados por busca, saída capada em `MAX_WEB_RESULTS = 5`, provedor Brave, e o **gate humano de deploy** — sem `WEB_SEARCH_API_KEY` o provedor real fica desligado e retorna `[]`. A curadoria site-a-site (na configuração de allowlist administrada) é o que permite **vetar robots.txt/ToS antes** — é exatamente o objeto da Seção 4.
2. **Copiamos só fatos.** O importador grava ingredientes, passos, tempo, porções e cozinha. **Não** copia a foto (a receita importada nasce sem imagem) nem a headnote: em `src/server/import/persist-import.ts` a tradução é inserida com `descricao: null` (comentário no código: "headnote NÃO é copiado da fonte — camada protegida — nasce em branco").
3. **Importação é sempre privada e não-publicável.** `origin = 'web_imported'`, `owner_id` = quem importou; o toggle de visibilidade pública não se aplica a importadas (ADR-0019, invariante: "exibir link ≠ importar; importar ≠ republicar").
4. **Atribuição obrigatória.** Dois campos em `src/db/schema.ts` (comentário "Atribuição da importação da web (#165, ADR-0019)"): `source_url` (URL de origem) e `source_name` (nome legível do site/publisher). Gravados na importação (`persist-import.ts`). O crédito exibido é "fonte: … (link)", **nunca** "por \<Usuário\>". Fundamento: direito moral de atribuição (Lei 9.610) e defesa contra *passing-off*.
5. **Guard-rails técnicos (#271/#272).** Respeito a robots.txt (RFC 9309), User-Agent identificado `RefogandoBot/1.0` (sem fingir navegador), rate-limit (~1 req/s/domínio), **fetch só por ação explícita do usuário** (nunca crawl de fundo), e botão de remoção do nome do autor.
6. **LGPD — dado mínimo.** Guardamos **só** o nome do autor + a URL pública. Ver Seção 3.

---

## 3. Análise LGPD (para o(a) advogado(a) validar)

### 3.1 Qual é o dado pessoal e quem é o titular

O único dado potencialmente pessoal tratado por esta funcionalidade é o conteúdo de **`recipe.source_name`** — o nome do autor/publisher da receita de terceiro. **O titular é o autor da receita**, não o usuário do Refogando. `source_url` é uma URL pública (endereço de página), tratada aqui como dado de atribuição, não de identificação pessoal.

**Nuance a validar [VALIDAR COM O JURÍDICO]:** na maioria dos casos `source_name` é o nome de um **site/publisher pessoa jurídica** (ex.: "TudoGostoso", "Nestlé", "Guia da Cozinha"). Pessoa jurídica **não é titular** sob a LGPD (Art. 5º, V: titular é a **pessoa natural** a quem se referem os dados tratados), então esses casos ficam **fora** do escopo da lei. A LGPD só incide quando `source_name` é o **nome de uma pessoa natural** (um autor individual). O tratamento é, portanto, marginal e intermitente — mas existe e precisa de base legal.

Não há dado sensível (Art. 5º, II): nome + URL pública não tocam saúde, biometria, convicção, etc.

### 3.2 Base legal proposta

- **Art. 7º, IX — legítimo interesse**, combinado com **Art. 10** (LIA). Finalidade legítima, específica e determinada (Art. 6º, I): **atribuir corretamente a autoria** e cumprir o direito moral de crédito (Lei 9.610), além de mandar tráfego de volta à fonte via link. O tratamento é estritamente necessário a essa finalidade e transparente. **[VALIDAR COM O JURÍDICO — LIA formal ainda não redigido.]**
- **Art. 7º, § 4º — dado tornado manifestamente público pelo titular.** O nome do autor foi publicado pelo próprio autor/publisher junto à receita. O § 4º dispensa novo consentimento, **mas** mantém os princípios da lei (finalidade, boa-fé, interesse legítimo) — o que nossa postura respeita (finalidade limitada a atribuir; sem enriquecimento; removível). **[VALIDAR: robustez do § 4º como base isolada.]**

Coerência com o skill `lgpd-legal-basis`: legítimo interesse é admissível aqui porque o dado **não é sensível**; marketing/analytics não se aplicam.

### 3.3 Minimização e finalidade (implementadas de verdade)

- **Necessidade / minimização (Art. 6º, III).** Guardamos apenas 2 campos, e só em receitas `origin = 'web_imported'`; toda outra receita deixa ambos `NULL` (`src/db/schema.ts`, nullable, sem default). A foto e a headnote (que carregariam mais expressão/dado de terceiros) **nunca** são copiadas (`persist-import.ts`, `descricao: null`). Superfície de dado de terceiro reduzida ao mínimo praticável.
- **Finalidade determinada (Art. 6º, I).** Os campos existem só para atribuição; o comentário do schema afirma "ambas só para ATRIBUIÇÃO".

### 3.4 Direito do titular à remoção e o que o código faz hoje

Existe uma rota técnica de remoção do nome: `clearSourceAttribution` em `src/server/recipe/clear-attribution.ts`, exposta por `POST /api/recipes/[id]/clear-attribution` (rota em `src/app/api/recipes/[id]/clear-attribution/route.ts`). Comportamento **exato**, verificado no código:

- Zera **só** `source_name` (`set { sourceName: null, updatedAt }`); **nunca** toca `origin` nem `source_url` — a URL **permanece** porque a atribuição é obrigatória (ADR-0019), e o crédito cai para o **host derivado** da URL (regra pura `sourceNameIsHost` em `src/domain/source-host.ts`; o link "ver no site" segue).
- Só executa `UPDATE` quando `origin === 'web_imported'` **e** `source_url != null` **e** o nome é humano (≠ host). Caso contrário é **no-op idempotente** (200 sem update, sem bump de `updatedAt`).
- Autorização por **ownership**: `ownerId` nulo (catálogo) ou diferente do usuário ⇒ **404** (nunca 403 — não vaza existência, ADR-0011). Exige sessão antes de tocar o DB.
- **Não é reversível** para o nome original (só re-deriva o host da URL) — aceitável para o direito de remoção.

**Limitação relevante [VALIDAR COM O JURÍDICO]:** esta rota só pode ser acionada pelo **dono logado da receita importada** (o usuário do app), removendo o nome de **uma** receita. Ela **não é** um canal público pelo qual o **titular real** (o autor da fonte) peça a remoção do próprio nome, e **não é** um DSAR completo (Art. 18) — não cobre acesso, portabilidade nem eliminação de conta. Ver gaps na Seção 3.5.

Direitos potencialmente exercíveis pelo autor-titular: **Art. 18, IV** (eliminação de dado desnecessário ou tratado em desconformidade com a lei) e, por a base legal proposta ser dispensa de consentimento (legítimo interesse, Art. 7º, IX), o **direito de oposição do Art. 18, § 2º** (opor-se a tratamento realizado com fundamento em dispensa de consentimento) — com prazo de resposta de **15 dias** (Art. 19, II). *(Nota: o Art. 18, VI trata da eliminação de dados tratados **com consentimento**; não é a hipótese aqui, já que não usamos consentimento como base — por isso ele foi retirado desta lista.)*

### 3.5 Gaps de conformidade (honestos, para priorização jurídica)

1. **Não há Política de Privacidade publicada.** Não existe página `/privacidade` ou `/termos` em `src/app`, nem documento de política publicado (os hits de "privacidade" no código são incidentais — configuração de cookie/auth). Isso deixa em aberto o **dever de informação** (Art. 6º, VI; Art. 9º — 7 elementos obrigatórios: finalidade, forma/duração, identificação do controlador, **contato do controlador** (Art. 9º, IV), compartilhamento, responsabilidades, direitos com menção ao Art. 18). O **contato do encarregado (DPO)** é exigência **separada** — do **Art. 41** (na prática, também divulgado na política, embora o Art. 9º só exija o contato do controlador). O skill `lgpd-privacy-policy` cobre o formato; falta redigir, revisar juridicamente (checkpoint) e publicar.
2. **Não há canal público de takedown nem encarregado (DPO) anunciado.** O ADR-0019 promete "canal de takedown + remoção sob pedido", mas a única capacidade existente é a rota técnica acima, acionável só pelo dono da receita. Falta um canal público pelo qual **terceiros** (autores das fontes) peçam remoção, e a **indicação do encarregado** (Art. 41).
3. **Não há endpoint self-service de DSAR completo** (Art. 18). A remoção cobre só `source_name` de uma receita; não há acesso/portabilidade/eliminação de conta. O skill `lgpd-dsar` descreve os 9 direitos e o SLA de 15 dias (Art. 19, II) a implementar.
4. **Checkpoint do ADR em aberto.** O próprio ADR-0019 condiciona o go-live a um(a) advogado(a) de PI/LGPD **assinar a postura antes de produção**. Este rascunho existe para viabilizar essa assinatura.

Já implementado corretamente (coerências, para o revisor não retrabalhar): **minimização real** (só nome + URL; foto e headnote nunca copiados) e **atribuição imposta no código** (`source_url` nunca é zerado).

---

## 4. Revisão de ToS/robots dos domínios candidatos da allowlist

> **Aviso de método.** A tabela abaixo resume uma **triagem automatizada** (leitura de robots.txt e, quando acessível, dos Termos de Uso). Ela **não substitui a leitura jurídica** de cada ToS: (a) fatos e cláusulas foram lidos verbatim só onde indicado; (b) o enquadramento da conduta do Refogando ("importar só fatos, para coleção privada, sem republicar") dentro ou fora de uma cláusula de reprodução/uso é **juízo jurídico**; (c) vários domínios não puderam ser lidos (bloqueio de ambiente, Cloudflare/Akamai, HTTP 402/403). Todos os "Revisar manual" **exigem** leitura humana antes de qualquer decisão de allowlist.

> **Nota de rastreabilidade desta revisão.** Os **fatos verbatim de cada site** desta tabela (p.ex. a cláusula 3.3 da panelinha, o CNPJ da guiadacozinha, o snapshot Wayback 2023 do foodnetwork) provêm da **triagem automatizada original** e **não foram reauditados** nesta passada de conferência — que cobriu o aterramento no **código**, não a triagem-fonte, que não veio junto. A tabela é **internamente consistente** (3 excluir + 1 manter + 7 revisar = 11; verdito "EXCLUIR" só onde há cláusula verbatim lida; regra anti-alucinação explícita) e adequadamente hedgeada, mas cada fato por site **permanece não-auditado** e sujeito à confirmação verbatim do jurídico (Seção 4.5).

### 4.1 Cobertura real desta triagem (honestidade)

Dos **11** domínios candidatos:

- **robots.txt efetivamente acessado:** 5 (tudogostoso, panelinha, cybercook, guiadacozinha, receitasnestle). Não acessado: 6.
- **ToS lido verbatim de fonte real ou arquivo:** 5 (tudogostoso, panelinha, guiadacozinha, receitasnestle na fonte; foodnetwork via Wayback 2023). ToS **não verificado**: 6.
- Os 6 não lidos são majoritariamente domínios internacionais (US/UK) atrás de Akamai/Cloudflare ou paywall HTTP 402, mais `receiteria.com.br`, que bloqueia todo cliente não-navegador via Cloudflare (403 até no próprio robots.txt).

Ou seja: temos leitura primária confiável para **menos da metade** dos domínios. As conclusões "excluir" só se apoiam em cláusula **verbatim** lida; onde não houve leitura, a recomendação é sempre "revisar manual", mesmo quando há sinal forte.

### 4.2 Tabela

| Domínio | robots.txt | Termos (status + url) | Recomendação | Justificativa (resumida) |
|---|---|---|---|---|
| **tudogostoso.com.br** | Acessado. `RefogandoBot` cai em `User-Agent: *` (bloqueia `/busca`, `/recipe/`, `*recipe_id=`) mas **não** bloqueia `/receita/` (path real das receitas pt-BR); não está na lista de IA banida. Sob robots, importar de `/receita/` (evitando `/busca` e `/recipe/`) é permitido. | Acessado — proíbe reprodução. https://www.tudogostoso.com.br/termos-de-uso | **Revisar manual** | Sem proibição explícita de automação/scraping (silêncio), mas há cláusula verbatim vedando "o uso comercial não autorizado... e a cópia de imagens, materiais, textos... com a intenção de propagação na internet... sem nosso prévio consentimento". Refogando importa só fatos p/ coleção **privada** e **não republica** — fora dos gatilhos "cópia de textos com intenção de propagação" e "uso comercial". Caso **limítrofe**: não é proibição de automação (não justifica excluir), mas não é silêncio total. O enquadramento é juízo jurídico. |
| **panelinha.com.br** | Acessado. `User-agent: * / Disallow:` — libera todos os crawlers; receitas não restritas. | Acessado — proíbe automatizado. https://panelinha.com.br/termos-de-uso | **EXCLUIR** | ToS cláusula **3.3** veda "qualquer sistema automatizado, inclusive... 'robôs', 'spiders', 'scripts' ou 'offline readers'"; **3.4** veda excesso de requisições; **6.2** veda "toda e qualquer forma de reprodução... total ou parcial". `RefogandoBot` é sistema automatizado **explicitamente** proibido — proibição contratual independe de os fatos não serem protegidos por direito autoral. |
| **cybercook.com.br** | Acessado (Cloudflare managed). Regra `*`: `Content-Signal: search=yes, ai-train=no` + `Allow: /` libera o rastreamento (inclusive receitas) e sinaliza `search=yes` (comportamento de buscador do Refogando); `ai-train=no` já respeitado (não treinamos modelo). `Disallow: /` só p/ 9 UAs nominais de IA em massa; `RefogandoBot/1.0` não está na lista. **Sem obstáculo de robots.** | Não verificado. https://cybercook.com.br/termos-de-uso/p (HTTP 403 via fetch; navegador headless redirecionou p/ carrefour.com.br) | **Revisar manual** | robots ok, mas o ToS **não pôde ser lido**. Snippets só trouxeram paráfrase sobre cadastro/dados/usuários da UE — **nenhuma** cláusula verbatim sobre automação/reprodução. Impossível afirmar que proíbe ou permite. Ler o texto ao vivo antes de incluir. (Nota: content-signal invoca reserva do Art. 4 da Diretiva UE 2019/790 — não afeta operação BR, mas reforça a leitura.) |
| **receiteria.com.br** | **Não acessado.** Cloudflare retorna 403 a toda requisição automatizada, **inclusive** ao próprio `/robots.txt`; testado com UA `RefogandoBot/1.0` e UA Chrome (ambos 403). | Não verificado (sem URL válida). | **Revisar manual** | Nem robots nem ToS puderam ser lidos. **Anti-alucinação:** um "Termos de Uso" que apareceu em busca pertencia a `receiteria.NET` (domínio diferente) e foi descartado — nenhum termo do próprio `receiteria.com.br` foi lido. Sinal p/ o revisor: o bloqueio Cloudflare **na prática já inviabiliza** o import do RefogandoBot, independentemente do que digam robots/ToS. |
| **guiadacozinha.com.br** | Acessado. `/receitas/` **não** bloqueado (só `/search/` e `/page/` são `Disallow` p/ `*`). Isoladamente, robots permitiria o crawling das receitas. | Acessado (via navegador real/Playwright; site dá 403 a fetch simples) — proíbe reprodução/armazenamento em banco de dados. https://guiadacozinha.com.br/termos-de-uso/ (operado por ASTRAL DIGITAL COMUNICAÇÃO LTDA, CNPJ 37.751.043/0001-19) | **EXCLUIR** | Seção **Propriedade Intelectual** (verbatim): "É proibido que o usuário faça o **download de nosso conteúdo para armazená-lo em banco de dados**"; veda usar o conteúdo p/ "criar uma base de dados ou um serviço que possa **concorrer**... com a plataforma"; "acessar o conteúdo **exclusivamente para fins individuais e não comerciais**". A importação grava dados em coleção (banco) e o Refogando é serviço de receitas (mesma categoria) → colide **literalmente**, ainda que só fatos e privado. Não menciona "scraping/robôs" — a proibição classificada é de **reprodução/armazenamento**, não de automação. |
| **receitasnestle.com.br** | Acessado. Sob `User-agent: *`, receitas **não** bloqueadas (Disallow só cobre áreas admin/funcionais: `/admin/`, `/search/`, `/busca/resultado`, `/cadastro`, `/entrar`, `/user/*`, etc.); há sitemaps de receitas. `RefogandoBot` cai no coringa. | Acessado — silencioso quanto a automação. https://www.receitasnestle.com.br/termos-e-condicoes | **MANTER** | ToS **silencioso** sobre acesso automatizado/scraping/crawling; a única restrição é contra **uso comercial** ("Você não pode usar comercialmente nenhum conteúdo... a menos que obtenha permissão..."), que não se aplica ao Refogando (busca de links + import só de fatos p/ coleção privada, sem republicar, sem foto nem texto autoral). Sem proibição verbatim aplicável + robots permite → manter. **Condicionar** a preservar não-uso-comercial e não-republicação. |
| **allrecipes.com** | **Não acessado.** WebFetch de `/robots.txt` (www e apex) retornou "unable to fetch" (bloqueio de ambiente). | Não verificado. https://www.dotdashmeredith.com/terms (dotdash.com/dash-terms → HTTP 402; meredith.com/legal → 301 p/ dotdashmeredith; people.inc → 402) | **Revisar manual** | Nenhuma fonte primária lida; sem trecho verbatim confiável. **Pista não confirmada:** Allrecipes é da Dotdash Meredith / People Inc.; resumos de busca atribuem aos ToS linguagem anti-"scraping"/"data compiling for any commercial... purpose" e proibição de "reproduce, retransmit, distribute... without prior written permission", além de bloqueio após ~10–15 downloads rápidos. **Confirmar verbatim** os ToS vigentes e o robots antes de manter/excluir. |
| **simplyrecipes.com** | **Não acessado.** WebFetch (www e apex) "unable to fetch". | Não verificado **na fonte**. https://www.people.inc/brands-termsofservice (HTTP 402). Status da triagem "proíbe-automatizado" baseado em **resumos**, não em leitura direta. | **Revisar manual** | Operado pela People Inc (Dotdash Meredith). Sinal **forte** (via resumos, não fonte): ToS proibiriam software automatizado (spiders/robots/scrapers/crawlers/data mining) p/ "scrape/harvest/download data", com carve-out **só** p/ indexação de buscador público — que **não** cobre a **importação** ("download data from the Services"). Também proibição de uso p/ treino de IA. Como a regra anti-alucinação exige verbatim confirmado e a fonte não abriu, a recomendação honesta é revisar manual — **mas a evidência aponta fortemente p/ provável exclusão**. |
| **seriouseats.com** | **Não acessado.** WebFetch (www e apex) bloqueado. | Não verificado. https://www.dotdash.com/dash-terms/ (402/bloqueio; dotdashmeredith/people.inc idem) | **Revisar manual** | Da Dotdash Meredith / People Inc. Resumos (não confirmados) sugerem proibição de spiders/robots/scrapers/data-mining e de reprodução/redistribuição. **Nada** lido na fonte → tosTrecho vazio por anti-alucinação. Abrir `dotdash.com/dash-terms` e o robots por cliente não bloqueado antes de decidir. |
| **foodnetwork.com** | **Não acessado.** Akamai "Access Denied" (403) a WebFetch e curl com UA de navegador. | Lido **verbatim via Wayback Machine** (snapshot 20230131162455), pois a página ao vivo dá 403. https://www.foodnetwork.com/site/terms | **EXCLUIR** | ToS (Scripps Networks) vedam usar "**robot or spider**... to copy or '**scrape**' the Websites or Website Content **for any purpose without the express written permission**", e separadamente reproduzir/redistribuir/derivar sem permissão escrita; uso "personal, non-commercial use only". Há carve-out de buscador, **estreito** ("for the sole purpose of creating... a searchable index... available to the public") que **não** cobre importar fatos p/ coleção privada. Proibição verbatim aplicável à parte de importação → excluir. **Ressalva:** confirmado em cópia **arquivada de 2023**; recomenda-se validar a versão vigente. |
| **bbcgoodfood.com** | **Não acessado.** WebFetch (www e apex) "unable to fetch". | Não verificado. https://www.immediate.co.uk/terms-and-conditions (immediate.co.uk / policies.immediate.co.uk também bloqueados) | **Revisar manual** | Da Immediate Media Company; nem robots nem ToS puderam ser lidos → ambos trechos vazios (anti-alucinação). Existência de vários scrapers públicos de receitas do BBC Good Food sugere fricção técnica/jurídica potencial, mas **não substitui** a leitura verbatim dos Termos. |

### 4.3 Domínios a EXCLUIR (e por quê)

> **Implementado (PR #403, issue #394):** os três domínios abaixo estão em `TOS_DENYLIST` (`src/domain/web-search-config.ts`), com subdomínios. O admin não consegue incluí-los na allowlist e eles saíram da lista de sugestões.

Só entram aqui domínios com **cláusula verbatim lida** que colide com a conduta do Refogando:

- **panelinha.com.br** — ToS 3.3 proíbe explicitamente "sistema automatizado / robôs / spiders / scripts" (e 6.2 veda toda reprodução). Proibição **de automação**, direta e independente da natureza factual do conteúdo.
- **guiadacozinha.com.br** — ToS proíbe "download de nosso conteúdo para armazená-lo em banco de dados" e criar "base de dados ou serviço que possa concorrer". Proibição **de reprodução/armazenamento** que a importação (gravar em coleção = banco) aciona literalmente.
- **foodnetwork.com** — ToS proíbem "robot or spider... to copy or 'scrape'... for any purpose without express written permission" + reprodução/derivação sem permissão escrita; carve-out de buscador estreito que não cobre o import. **Ressalva:** lido de arquivo 2023 → validar versão vigente.

Nota comum: o argumento de que "fatos de receita não são protegidos por direito autoral" é forte no eixo **autoral**, mas **não neutraliza uma proibição contratual explícita de automação ou de armazenamento** no ToS. Por isso a exclusão é a recomendação conservadora nesses três. **[VALIDAR: se o jurídico entender que a proibição de ToS é inoponível/renunciável, a decisão pode mudar.]**

### 4.4 Domínio a MANTER (candidato)

- **receitasnestle.com.br** — robots permite as páginas de receita e o ToS é silencioso quanto a automação/reprodução (só veda uso comercial, que não fazemos). Recomendado **manter na allowlist**, condicionado a preservar não-uso-comercial e não-republicação (já garantidos pela postura do app). Ainda assim, sujeito à confirmação jurídica geral deste rascunho.

### 4.5 Domínios em REVISÃO MANUAL (não decidir sem leitura humana)

> **2026-09-24:** estes sete domínios saíram das sugestões de um clique da tela de admin da allowlist (`src/domain/suggested-domains.ts`); só receitasnestle segue sugerido. O admin ainda pode digitá-los à mão: não fazer isso antes da leitura verbatim do ToS.

Sete domínios **não** têm base suficiente para excluir nem para manter, e exigem leitura jurídica do ToS (e, onde faltou, do robots) antes de qualquer decisão:

- **tudogostoso.com.br** — caso limítrofe: robots permite `/receita/`, mas há cláusula verbatim de "cópia de textos com intenção de propagação/uso comercial"; enquadrar "importar fatos p/ coleção privada" fora dela é juízo jurídico.
- **cybercook.com.br** — robots permite; **ToS não lido** (403 + redirect). Sem cláusula verbatim → ler ao vivo.
- **receiteria.com.br** — **nem robots nem ToS lidos** (Cloudflare 403 total); na prática o bloqueio já pode inviabilizar o import.
- **allrecipes.com** — nenhuma fonte primária lida; só pistas não confirmadas (Dotdash Meredith).
- **simplyrecipes.com** — fonte não aberta (402); **sinal forte de proibição de automação** via resumos, mas não confirmado — provável exclusão após leitura.
- **seriouseats.com** — fonte não aberta (402); resumos sugerem proibição, nada confirmado.
- **bbcgoodfood.com** — nem robots nem ToS lidos (Immediate Media bloqueado).

**Disclaimer reforçado:** a triagem automatizada é um filtro de primeira passada. Ela lê o que consegue e é honesta sobre o que não conseguiu. Cinco robots.txt e cinco ToS foram efetivamente lidos; o restante permanece **não verificado**. Além disso, mesmo os fatos verbatim listados aqui **não foram reauditados** nesta conferência (ver a nota de rastreabilidade no topo da Seção 4) — carregam da triagem original. Nenhum "revisar manual" deve virar "manter" sem a leitura verbatim do contrato vigente de cada site por um humano/jurídico. Para os domínios da Dotdash Meredith / People Inc (allrecipes, simplyrecipes, seriouseats, foodnetwork) vale considerar que também são **fontes fora do Brasil** — a leitura deve observar o ToS aplicável e eventual restrição de jurisdição/idioma **[VALIDAR: conveniência de manter fontes estrangeiras na allowlist do produto pt-BR dado o custo de verificação e o risco contratual]**.

---

## 5. Checkpoints em aberto para o(a) advogado(a) assinar

1. **Assinar a postura do ADR-0019** (allowlist + só-fatos + import privado + atribuição obrigatória) antes do go-live, conforme o próprio ADR condiciona.
2. **Confirmar a base legal** do tratamento de `source_name` (Art. 7º, IX + LIA / Art. 10; e/ou Art. 7º, § 4º) e se a nuance "publisher pessoa jurídica fora da LGPD" procede.
3. **Redigir/revisar a Política de Privacidade** (Art. 9º, 7 elementos) — gap aberto; usar o skill `lgpd-privacy-policy` (checkpoint: nunca publicar sem revisão jurídica).
4. **Definir canal público de takedown + indicar o encarregado (DPO)** (Art. 41), além de expor o **contato do controlador** (Art. 9º, IV), para que o **autor-titular** — não só o dono da receita — possa pedir remoção; e avaliar um **DSAR** (Art. 18, prazo de 15 dias do Art. 19, II) via skill `lgpd-dsar`.
5. **Decidir a allowlist** com base na Seção 4: excluir os 3 com cláusula verbatim colidente, manter o 1 silencioso, e **ler o ToS** dos 7 em revisão manual antes de incluí-los.

---

## 6. Referências

- Domínio/postura: `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`; briefing preparatório interno `docs/legal/briefing-juridico-descoberta-web.md`.
- Código: `src/db/schema.ts` (`source_url`/`source_name`, ~L216–222); `src/server/import/persist-import.ts` (grava atribuição; `descricao: null`); `src/server/recipe/clear-attribution.ts` + `src/app/api/recipes/[id]/clear-attribution/route.ts` (remoção do nome); `src/domain/source-host.ts` (`sourceNameIsHost`/`bareHost`); `src/server/web-search/web-search-provider.ts` (**limites/gate** do provedor: `MAX_SITE_QUERIES=8`, `MAX_WEB_RESULTS=5`, provedor Brave, gate `WEB_SEARCH_API_KEY`; **consome** a allowlist via `opts.allowlist`, ~L86 `opts.allowlist.slice(0, MAX_SITE_QUERIES)` — a lista de domínios em si é gerida por admin, fora deste arquivo).
- LGPD (Lei 13.709/2018): Art. 5º (V titular / II sensível / VIII encarregado); Art. 6º (I finalidade, III necessidade, VI transparência); Art. 7º (IX legítimo interesse; § 4º dado manifestamente público); Art. 9º (dever de informação; IV contato do controlador); Art. 10 (LIA); Art. 16 (retenção); Art. 18 (direitos do titular; IV eliminação de dado desnecessário/em desconformidade; § 2º oposição a tratamento por dispensa de consentimento); Art. 19, II (prazo 15 dias); Art. 41 (encarregado). Lei 9.610/1998, Art. 8º (receita como fato não protegível) e direito moral de atribuição. RFC 9309 (robots.txt).
- Skills: `lgpd-legal-basis`, `lgpd-privacy-policy`, `lgpd-dsar`.

> Reiteração: **rascunho para revisão jurídica — não constitui parecer.** Todos os pontos marcados **[VALIDAR COM O JURÍDICO]** e a Seção 4.5 dependem de leitura e assinatura de advogado(a) antes de qualquer ação em produção.
