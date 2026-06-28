# Refogando — Análise de Monetização

**Data:** 2026-06-28
**Status:** Diagnóstico estratégico — nenhuma decisão tomada ainda
**Método:** Análise por 11 agentes em paralelo (3 lendo o código/docs do repositório + 6 de pesquisa de mercado com dados citados + 1 síntese + 1 contraditório cético). ~828k tokens de pesquisa.
**Versão visual/interativa:** [`monetizacao-2026-06-28.html`](./monetizacao-2026-06-28.html) (gráficos + calculadora de projeções; abra no navegador, e use *Imprimir → Salvar como PDF* para gerar o PDF).

> **Câmbio usado nas conversões:** ~R$5,50 / US$1 (aproximado, jun/2026).

---

## Sumário executivo

**Dá para ganhar dinheiro com o refogando? Sim — mas quase nada do dinheiro está em "um site de receitas", e o modelo de anúncios é o pior caminho possível para este produto.**

O instinto do dono ("ninguém paga por um site de receitas, então teria que ser por ads?") está **certo na primeira metade e errado na segunda**:

- **Certo:** ninguém paga para *ler* receita. É a categoria de conteúdo mais commoditizada da internet.
- **Errado:** anúncios não são a alternativa — são o **pior** modelo aqui, por três motivos somados (nicho commoditizado + idioma de menor CPM + canal de SEO em colapso), e ainda por cima dão **margem unitária negativa** porque as features de IA têm custo variável por uso.

**A virada que destrava receita é de posicionamento, não de mais código:** parar de pensar como um *site de mídia* e pensar como uma *ferramenta*. Quem paga não é o **leitor** — é o **produtor** (criador de comida, dark kitchen, restaurante pequeno, nutricionista, vendedor do iFood), para quem a IA do refogando substitui um custo real.

**Teto realista, em execução solo:** um micro-SaaS de nicho "ramen-profitable" (baixos milhares de R$/mês) vendendo a ferramenta — não um media play de escala. A parte difícil (engenharia de um produto bem-feito) já está pronta; o que falta é barato de testar (um botão de pagar + dez conversas de venda).

---

## 1. A pergunta do dono, respondida direto

> "Ninguém vai pagar por um site de receitas, então teria que ser por publicidade? Ads? Ou alguém pagaria por este serviço?"

- **Pagar para ler receita:** não. Validado pelo mercado (ver §2).
- **Anúncios:** o pior modelo possível para este produto, neste idioma, neste momento (ver §2 e §3). **Evitar como modelo primário.**
- **Alguém pagaria pelo serviço:** **sim — mas o produtor, não o leitor.** A IA (geração + estúdio de imagem) é a única coisa com disposição-a-pagar genuína, porque substitui um custo concreto de quem produz conteúdo de comida (ver §4).

---

## 2. Por que "ninguém paga por receita" é verdade

**Receita-conteúdo é commodity grátis — provado pelos dois extremos do mercado:**

- **TudoGostoso** (o incumbente): ~200 mil receitas, 20+ anos de backlinks, dono é a **Webedia** (não a Globo), ~19–44M visitas/mês, 86% de tráfego orgânico, #1 absoluto na categoria. Vive de **anúncio + conteúdo de marca** ("Ingrediente Patrocinado": Coca-Cola, Sadia, Nestlé).
- **Panelinha / Rita Lobo** (a marca premium): **não cobra pelas receitas**. Monetiza adjacências — editora, escola de cozinha, cursos, louças, produtora. Diversificou de propósito "para não depender de receita publicitária".

Quando a marca mais forte e a mais refinada do país concordam que a receita é grátis, o veredito do mercado está dado.

**Lá fora, escala não vira dinheiro nesse nicho:**

- **Cookpad:** 60M+ usuários e receita de assinatura **em declínio** (¥17B em 2016 → ~US$111M em 2019, −6,57% a/a). A própria gestão chama monetização de "seu maior problema".
- **Yummly:** tinha **20 milhões de usuários** e foi simplesmente **desligado** (dez/2024, pela Whirlpool). Escala sem modelo = passivo.

**Disposição-a-pagar do consumidor para ler é ~zero:** a assinatura de consumidor da Tastemade é US$2,99/mês — uma linha marginal. A categoria inteira é financiada por anúncio + comércio, não por acesso pago.

---

## 3. Por que anúncios são a pior matemática possível (aqui)

Três fatores ruins, somados, mais um golpe estrutural:

### 3.1 CPM de comida em pt-BR é uma fração do dos EUA
- CPM display Brasil ~**US$2,78** vs EUA ~**US$23** (≈ 1/8). YouTube: Brasil ~US$1,64 vs EUA ~US$32,75.
- RPM real de receita em pt-BR: da ordem de **R$1–8 por mil pageviews**.
- **100 mil pageviews/mês ≈ R$400–800/mês** — não cobre nem Gemini + Brave + Vercel + Neon.
- Para US$1.000/mês (~R$5.500) via rede premium: **40–67 mil PV/mês**; via AdSense puro: **125–333 mil PV/mês**.
- Pisos de entrada das redes (Raptive 25k PV/mês, Mediavine US$5k/ano de receita) ficam **anos** fora de alcance para um produto solo, pré-conteúdo.

### 3.2 O canal (SEO de receita) está em colapso — Google AI Overviews
- Zero-click subiu de **56% → 69%** (mai/24 → mai/25).
- Cliques caem ~**58%** onde aparece AI Overview; só **1%** clica nos links citados.
- Sites de receita/how-to perderam **40–70%** de tráfego orgânico. Vários fecharam (The Planet D, Charleston Crafted −70%).
- CPMs de display caíram **−36% a/a** (abr/2025): menos tráfego **e** menos valor por pageview ao mesmo tempo.
- A tese "feed-first / SEO indexável" aposta justamente no canal que está sendo demolido.

### 3.3 Margem unitária INVERTIDA (o golpe que diferencia este produto de um blog)
Num blog de receita normal, o conteúdo é **custo afundado** (escreveu uma vez, serve para sempre). No refogando, **cada visitante engajado custa dinheiro**, porque as features têm custo variável por uso:

> **Correção factual descoberta lendo o código:** a geração de **texto** roda em **Claude Opus 4.8** (`src/server/claude/client.ts`), **não** em Gemini. Gemini é só **imagem** (Nano Banana 2) + **embeddings**. Opus é modelo premium — o custo é maior do que se supunha.

| Ação | Custo por uso | Equivalente | Onde |
|---|---|---|---|
| Gerar uma receita (Opus 4.8) | US$0,05–0,10 (até US$0,15–0,50 no modo conversa) | ~R$0,30–2,75 | `src/server/claude/client.ts` |
| Gerar/editar uma imagem (Gemini) | ~US$0,077 | ~R$0,42 | `src/domain/image-cost.ts` |
| Uma "buscar na web" (Brave, até 8 queries) | US$0,02–0,04 | ~R$0,11–0,22 | `src/server/web-search/web-search-provider.ts` |

Num modelo grátis-com-ads em pt-BR, o RPM de anúncio pode ser **menor que o custo de IA de uma única sessão engajada** → **margem negativa por usuário ativo**. Quanto mais "sucesso" de leitura grátis, mais o produto sangra. Um hit viral, do jeito que está hoje, é **uma conta, não um lucro**.

### O teto da categoria "gerar receita com IA"
O **DishGen** — o melhor pure-play do mundo, com imprensa no Guardian e na NPR, 250 mil receitas geradas, 15–18k usuários — fatura **~US$800/mês** (sobre ~US$80/mês de custo) e **está à venda no Flippa**. **ChefGPT** cobra US$3/mês. A parte "mágica" do app (gerar receita) é exatamente a parte que vale ~zero, porque ChatGPT/Gemini fazem de graça.

---

## 4. O reframe: o cliente é o produtor, não o leitor

Pessoas pagam por três coisas em culinária — e **nenhuma é "acesso a receitas"**:

1. **Marca/curadoria de confiança** (NYT Cooking US$50/ano, ckbk US$4,99/mês) — exige redação/licenciamento. Fora do alcance solo.
2. **Utilidade de organização** da própria cozinha (Paprika US$30 one-time, AnyList US$9,99/ano, Plan to Eat US$49/ano) — "banco de dados pessoal", não publisher.
3. **Ferramenta que economiza tempo/dinheiro** — é aqui que o refogando se encaixa.

**O bolso com disposição-a-pagar real é o produtor.** Um restaurante pequeno, dark kitchen, nutricionista ou vendedor do iFood paga **R$150–500 por prato** num ensaio fotográfico (R$6–20 mil por um cardápio de 40 itens). O estúdio do refogando faz isso por ~US$0,08 (~R$0,45) de custo. Esse cliente paga porque a IA substitui um custo concreto — e a receita cobre exatamente o custo de Gemini que o anúncio nunca cobriria.

---

## 5. As opções, ranqueadas

| # | Opção | Potencial | Esforço / tempo | Veredito |
|---|---|---|---|---|
| 1 | **Estúdio de imagem como serviço B2B** (foto de prato p/ restaurantes, iFood, cardápios) | Médio — o maior em prazo curto | Médio (falta billing + vendas); 1–3 meses p/ 1ª receita | **Perseguir cedo** |
| 2 | **Freemium / créditos pela ferramenta de IA** (leitura grátis, criação paga via Pix) | Baixo-médio | Médio (meter já existe, falta billing); 2–4 meses | **Perseguir cedo** |
| 3 | **Utilidade paga** (meal-plan + lista de compras + cookbook pessoal) | Baixo-médio | Médio-alto (falta construir a camada) | Talvez |
| 4 | **White-label / vender o ativo** (stack forte + ponte do dono com o mercado US) | Especulativo, cheque alto | Variável (é evento, não renda) | Talvez |
| 5 | **Afiliados / shoppable** (ingrediente→carrinho via Mercado Livre, até 16%) | Baixo agora, médio em escala | Baixo p/ ligar; receita 12–24 meses adiante | Perseguir depois |
| 6 | **Licenciamento de API** (receita estruturada + imagem; estilo Edamam US$49–999/mês) | Médio-alto por cliente | Alto (vendas B2B); 6–12+ meses | Perseguir depois |
| 7 | **Receita patrocinada / CPG** (marca paga p/ estrelar a receita) | Alto por campanha | Alto, tardio; 18–24+ meses | Perseguir depois |
| 8 | **Creator / comunidade** (assinatura de cozinheiro, tips via Pix) | Baixo no agregado | Médio; duplo chicken-and-egg | Perseguir depois |
| 9 | **Anúncios display** (AdSense / rede premium) ← *o que o dono perguntou* | Muito baixo / negativo | Baixo p/ ligar, retorno ~zero | **Evitar** |

### 🟢 #1 — Estúdio de imagem B2B (aposta primária)
Produtizar o estúdio (Gemini Nano Banana 2, ~R$0,45/imagem, **já com ledger `cost_usd`**) como serviço standalone: o cliente sobe uma foto ruim (ou descrição) e recebe uma foto apetitosa pronta para cardápio/Instagram/delivery. Cobrança por pacote de créditos ou assinatura via Pix.

- **Prós:** ativo já construído, com telemetria de custo que quase ninguém tem; ignora a armadilha do CPM pt-BR (não depende de tráfego massivo); disposição-a-pagar real (substitui custo concreto); valor "single-player" (sem chicken-and-egg de comunidade); margem positiva clara; mercado B2B food-tech aquecido (CNBC, fev/2026).
- **Contras:** exige um motion de **vendas/distribuição** para negócios — banda que um dev solo técnico costuma não ter; concorre com gerar foto no próprio ChatGPT; risco de "parecer IA" para restaurante exigente; é quase um produto *diferente* do app de receitas (risco de dispersão de foco).
- **Comparáveis:** FoodShot US$15–45/mês, MenuCapture US$0,24/foto.
- **Realista:** dezenas de clientes a R$30–100/mês = **R$1–5k/mês** em 6–12 meses, com outreach.

### 🟢 #2 — Freemium pela ferramenta, via Pix (aposta paralela)
O ativo mais subestimado do código: o **motor de quota por papel** (janela de 24h, 10 receitas / 3 imagens por dia, ajustável no `/admin/ia`) + o **ledger de custo** já são, na prática, **um medidor de freemium pronto** — falta um papel "pro" e billing. Pix Automático (lançado jun/2025) é rail de recorrência barato para micro-ticket.

- **Prós:** mudança mínima de schema; alinha receita ao custo (cobra quem queima IA); Pix remove a fricção "só cartão"; modelo comprovado (ChefGPT US$3, Pestle US$0,99, DishGen US$7,99).
- **Contras:** compete de frente com ChatGPT grátis; conversão freemium ~2% e ARPU pt-BR baixo → receita pequena; churn estrutural alto ("assinatura de receita = academia para fazer 3 flexões"); precisa conter o custo dos ~98% que não pagam (gating duro da IA cara).
- **Realista:** centenas de pagantes × R$10–20 = **R$1–3k/mês**, e só depois de ter audiência.

### Demais opções (resumo)
- **#3 Utilidade paga:** reframe poderoso ("organizador da MINHA cozinha", categoria Paprika/AnyList que comprovadamente se cobra) — mas exige construir meal-plan/lista, que não existe. Boa 2ª fase.
- **#4 White-label / vender o ativo:** dado o perfil (dev forte + ponte com o mercado US, onde asset/white-label paga melhor), é rota legítima de saída/licenciamento em paralelo. DishGen está no Flippa exatamente assim.
- **#5 Afiliados:** Mercado Livre Afiliados (até 16%, cadastro aberto a qualquer CPF/CNPJ) é o único trilho turnkey no Brasil hoje. Encaixa com ingredientes já estruturados, mas só rende com tráfego. Não há trilho shoppable de mercado plugável no BR (iFood/Rappi são onboarding de lojista, exigem CNPJ + homologação).
- **#6 Licenciamento de API:** ativo existe (JSON-LD + image gen); gargalo é o GTM de vendas B2B. Evolução natural do #1.
- **#7 CPG patrocinado:** maior valor por campanha, mas o mais travado por escala; exige media kit + vendas. Fase-3.
- **#8 Creator/comunidade:** reenquadrar a camada social como motor de **retenção + efeito-rede de SEO** (mais cozinheiros → mais conteúdo original indexável), **não** como linha de receita. Monetização de criador é duplamente chicken-and-egg e paga ~10% de quase-zero. Aviso: Food52 (US$160M → Chapter 11 → vendida por US$9,9M) mostra que comunidade-para-comércio destrói foco.
- **#9 Anúncios:** **não.** Pior matemática possível (nicho + idioma + canal em colapso + margem negativa). No máximo receita secundária simbólica no tráfego en-US (CPM ~8x maior) muito depois — e mesmo assim provavelmente não vale o esforço de SEO.

---

## 6. O que falta no produto antes de qualquer R$1

Confirmado lendo o schema:

- **Zero billing.** Nenhum Stripe/Mercado Pago/Pix/paywall/plano. Hoje não há como cobrar.
- **Zero analytics.** Nenhum PostHog/Plausible/GA. GTM completamente às cegas — impossível saber se algo converte.
- **Seed do catálogo (#238) nunca feito.** É o gargalo de tudo no caminho SEO — mas, como visto, mesmo feito não salva pelo lado de ads.
- ⚠️ **Vazamento de caixa real e urgente:** a busca-web (Brave) é **disparável por usuário anônimo**, faz **até 8 queries por busca**, e desde fev/2026 **não tem free tier nem teto de gasto**. O rate-limit atual é só "politeness" em memória, por instância de serverless — **não é um teto de custo**. Pré-seed, quase toda busca parece "rasa" e dispara. Recomenda-se blindar (teto de gasto global) independente de qualquer decisão de monetização.
- **Sem prompt caching nas chamadas do Opus** → 50–90% do custo de input fica na mesa. Ganho fácil de margem.

---

## 7. Caminho recomendado (pragmático, para dev solo)

1. **Pare o ralo e instrumente.** Teto duro de gasto na Brave + gate de login/quota em toda chamada de IA cara; instale analytics (Plausible/PostHog). Sem funil medível e sem como cobrar, nenhuma das opções existe.
2. **Aposta primária:** empacote o **estúdio de imagem como produto B2B** — upload → foto apetitosa, créditos via Pix, mirando negócios de comida / iFood sellers / nutricionistas. Faça outreach manual para os 10–20 primeiros clientes. Valida disposição-a-pagar em **semanas**.
3. **Em paralelo:** adicione o tier "pro" em cima do meter de quota que já existe. Leitura grátis, criação/imagem com teto grátis + plano pago via Pix.
4. **Só então** faça o seed (#238) — tratando SEO como **topo de funil puro** (descoberta + retenção + efeito-rede social), **nunca** como modelo de ads. O seed alimenta aquisição grátis para converter na ferramenta paga no login-para-criar.
5. **Depois (12–24 meses, condicionado a tração):** afiliados Mercado Livre, licenciamento de API (#6), e — se surgir audiência + cozinheiros-âncora — creator/CPG como upside.
6. **Mantenha como opção de saída:** se a operação consumer não decolar, o asset + a ponte com o mercado US viabilizam white-label/venda. Nunca ligue ads como modelo primário.

---

## 8. Veredito honesto

Existe **possibilidade real de ganhar dinheiro** — mas não com a coisa que parecia óbvia. Não é "um site de receitas que escala com anúncios"; isso, em pt-BR, solo, pré-conteúdo, contra o TudoGostoso e contra o AI Overviews, **não fecha a conta**.

O que existe é um **micro-SaaS de nicho** vendendo a *ferramenta* (especialmente a foto de prato por IA) para quem tem um custo real a substituir. No melhor caso de execução solo, isso é "ramen-profitable" — baixos milhares de reais por mês, paga a infra e dá um troco. Não é um media play de escala.

A boa notícia: a parte mais difícil — a engenharia de um produto bem-feito, com proveniência, bilíngue, ledger de custo — **já está feita**. A virada que falta é de **posicionamento e cobrança**, não de mais código de produto. O dono otimizou o que é fácil de copiar (geração, busca, social); o que falta agora é mais barato de testar: um botão de pagar e dez conversas de venda.

---

## Apêndice — Dados de mercado e fontes

> Os dados abaixo foram coletados pelos agentes de pesquisa via busca web (jun/2026). Tratar como ordens de grandeza, não precisão contábil.

### Anúncios / SEO
- RPM food blog (redes premium EUA): US$12–35/mil PV (Mediavine média US$33–35; Raptive US$47–57 no Q4/2025) — recipecard.io, thisweekinblogging.
- AdSense food RPM: US$2–8/mil PV — recipecard.io.
- Exemplo real: *Rich and Delish* US$10.478 em jan/2024 com 467.745 pageviews (RPM US$24,12).
- Para US$1.000/mês: 40–67k PV/mês (rede premium) ou 125–333k PV/mês (AdSense).
- CPM display Brasil ~US$2,78 (faixa US$1,77–5,86) vs EUA ~US$23; YouTube BR ~US$1,64 vs EUA ~US$32,75 — adamigo.ai, MilX, WorldPopulationReview.
- AdSense Brasil: CPM R$1,50–15, RPM efetivo ~R$4–8/mil — remessaonline, webartedesign.
- Pisos de rede: Raptive baixou de 100k → 25.000 PV/mês (out/2025); Mediavine principal exige US$5.000/ano de receita de ad (jan/2026); Mediavine Journey aceita 1.000+ sessões.

### Google AI Overviews
- Zero-click 56% → 69% (mai/24–mai/25, Similarweb); 60% das buscas terminam sem clique.
- CTR cai 34–46% com AIO (Pew: 8% vs 15%); só 1% clica nos links citados (AdExchanger); Ahrefs: −58% de cliques.
- Receita/how-to: quedas de 40–80% de tráfego; The Planet D fechou (2025); Charleston Crafted −70%.
- CPMs de display −35,9% a/a (abr/2025).

### Apps de assinatura / disposição-a-pagar
- NYT Cooking: US$6/mês ou US$50/ano; 1M+ assinantes desde nov/2021; 24.000 receitas, 456M visitas/ano.
- Paprika: one-time ~US$29,99 desktop + US$4,99 mobile (sem assinatura).
- Plan to Eat US$5,95/mês ou US$49/ano; AnyList free + US$9,99/ano; Mealime free → US$5,99/mês; Pestle free + US$0,99/mês ou US$9,99/ano.
- ckbk ("Spotify dos livros de cozinha"): 120k+ receitas licenciadas, free = 3 receitas/mês, Premium ~US$4,99/mês.
- Samsung Food (ex-Whisk): grátis com 240k+ receitas; Food+ ~US$4,99–6,99/mês (só tira ads).
- Yummly: encerrado dez/2024 com 20M usuários (Whirlpool, comprou por US$100M em 2017).
- Cookpad: 60M+ usuários; receita ~¥17B (2016) → ~US$111M (2019), −6,57% a/a; sub paga em declínio.
- Conversão freemium consumer: mediana 2,18%; faixa 1–5%; hard-paywall mediana 12,11%.
- Âncoras pt-BR: Spotify R$23,90; Netflix com ads R$20,90.
- Churn mediano SaaS: ~14% da receita / ~13% dos clientes ao ano (Stripe).

### IA / concorrência / B2B
- DishGen: ~US$800 MRR sobre ~US$80/mês de custo, 15–18k usuários, 250k receitas; preços US$7,99 consumer / US$15,99 Pro / US$60 widget B2B; à venda no Flippa.
- ChefGPT: US$3/mês (ilimitado); ~106k visitas/mês.
- Recipe-API: Spoonacular free–US$500/mês; Edamam free–US$999/mês (+ licenciamento por receita).
- Foto de prato por IA: FoodShot US$15–45/mês; MenuCapture US$0,24/foto — vs tradicional US$150–500/prato (US$6–20k por cardápio de 40 itens).
- Shutdowns: Yummly (dez/2024), PlateJoy (jul/2025), IBM Chef Watson (abandonado).
- CNBC (fev/2026): startups de IA entrando nas test kitchens da Big Food.

### Brasil / comércio
- TudoGostoso: 200k+ receitas, ~19–44M visitas/mês, 86% orgânico, dono Webedia (comprou da NZN por R$49M em 2015).
- Receitas Nestlé: 4.000+ receitas, ~120M acessos/ano (bancado como marketing).
- Panelinha (Rita Lobo): negócio multiplataforma deliberado; receitas grátis no site.
- Mercado Livre Afiliados: até 16% em 2026; aberto a qualquer CPF/CNPJ; paga via Mercado Pago.
- Amazon Associados BR: Casa & Cozinha ~8%.
- Instacart Developer Platform (EUA): 3% por pedido atribuído. iFood/Rappi BR: APIs de lojista (exigem CNPJ + homologação), não afiliado de conteúdo.
- Allrecipes: comércio + shopper-marketing ~30% da receita digital (Bertolli paga para ser "o azeite no carrinho").
- Pix: 177M usuários; Pix Automático lançado jun/2025 (+182% Q4'25→Q1'26).
- Creator economy BR: US$5,47B (2025) → US$33,5B (2034); só 22% monetizam efetivamente.
- iFood: 55M usuários, 110M pedidos/mês.

### Creator / comunidade
- Substack/Patreon take-rate ~10% + ~3,6% Stripe = 13–16% efetivo (+30% se IAP iOS).
- Food Substacks US$5–8/mês; Alison Roman est. US$75–150k/mês (topo da power law, Pareto α≈2).
- "1.000 fãs verdadeiros": ~20.000 signups engajados para converter 1.000 pagantes a 5%.
- Food52: US$160M (2021) → Chapter 11 → vendida à America's Test Kitchen por US$9,9M.
