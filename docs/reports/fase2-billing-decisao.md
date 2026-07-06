# Fase 2 — Billing: documento de decisão (pronto-para-aprovar)

> **Status:** rascunho de decisão. Cada seção abaixo transforma um "decidir do zero" numa
> **RECOMENDAÇÃO** fundamentada que você só precisa **aprovar** ou **ajustar**. Nada aqui está
> ligado no produto — é decisão comercial, não código em produção.
>
> **Legenda:** **[FATO]** = verificado (no código ou em fonte citada). **[RECOMENDAÇÃO]** = minha
> proposta, com o porquê e as alternativas. **[INCERTO]** = depende de dado que ainda não temos
> (medição real) ou de terceiro (contador). Não é aconselhamento jurídico/contábil.
>
> Gerado por Claude (Opus 4.8, 1M) em 2026-07-06. Fonte de custo: `src/domain/text-cost.ts`,
> `src/domain/image-cost.ts` e configs de cota. Base de mercado: buscas de jul/2026 (fontes no fim).
> Câmbio usado: **R$ 5,50 / US$** (ajuste se quiser recomputar).

---

## TL;DR (as 5 recomendações-chave)

1. **Modelo:** **híbrido** — assinatura recorrente `pro` como carro-chefe **+** pacotes de crédito
   pré-pago (Pix) para excedente e para quem não quer assinar. A cota-por-período que já existe
   mapeia direto em assinatura; o crédito pré-pago é **auto-limitante** e cobre a cauda de custo do
   Opus (que estoura qualquer plano "ilimitado").
2. **PSP:** começar em **Mercado Pago** (aceita **CPF**, assinatura recorrente com cartão + Pix,
   maior alcance pt-BR, menor atrito). Migrar para **Asaas** quando houver CNPJ — ele traz **Pix
   Automático** e **emissão automática de NFS-e** embutida (R$ 0,49/nota), que o Mercado Pago não
   emite nativamente.
3. **proCaps:** apertar o free (hoje generoso demais) e usar **modelo mais barato no free** (Sonnet 5
   corta ~45% do custo) e **Opus no pro**. Tabela concreta na §3, com a matemática de margem.
4. **Preço:** **R$ 24,90/mês** (ou **R$ 249/ano** ≈ 2 meses grátis). Faixa defensável R$ 19,90–29,90.
   A margem é confortável no uso típico e **fina no teto** — por isso a cota é limitada e o excedente
   vira crédito.
5. **Fiscal:** **faseado.** Validar como **pessoa física** no Mercado Pago (baixo volume, carnê-leão,
   ajuda a nova isenção de até R$ 5.000/mês de 2026). Ao provar receita recorrente, abrir **MEI**
   (se o CNAE de software permitir — **confirmar com contador**) ou **ME/Simples**, e só então ligar
   Pix Automático + NFS-e automatizada.

---

## 0. O que já existe (para não reinventar)

**[FATO]** A infra de freemium está pronta como *motor*, faltando só o eixo comercial e o billing:

- Cota diária por papel em janela 24h deslizante, resolvida de config viva com *fail-closed*:
  `capFromRecipeGenConfig` (`src/domain/recipe-gen-config.ts`), espelhos em
  `image-gen-config.ts` e `extraction-cap-config.ts`.
- Eixo comercial `plan` (`free`/`pro`) já **scaffoldado flag-OFF** no #466 (`src/domain/plan.ts`,
  coluna `users.plan`). As três resoluções de cota **já aceitam** `plan` + `proCaps` como parâmetro,
  e o default é **byte-idêntico** ao de hoje.
- **[FATO] `proCaps` ainda NÃO é persistido** — não há linha de config `pro` no `app_config`, nem
  UI de admin para editá-la, nem billing. É exatamente o que a Fase 2 preenche.
- Custo de **imagem** já é medido e gravado (`cost_usd`); custo de **texto** foi instrumentado em
  `text-cost.ts` (tabela de preço snapshot). Isso destrava a matemática de margem abaixo.

---

## 1. Modelo de cobrança

### Recomendação: **HÍBRIDO — assinatura `pro` (carro-chefe) + créditos pré-pago (Pix) para excedente**

**Por quê (ancorado no que já existe):**

- **[FATO]** A cota é **por período** (janela deslizante por papel). Isso mapeia **1:1** numa
  **assinatura**: "seu plano dá X gerações no período". Zero reescrita do motor de cota — só troca a
  tabela de cap por plano (o eixo `plan` já está lá).
- **[FATO / matemática]** O custo do Opus 4.8 é **R$ 0,43/geração de receita** (cálculo na §3).
  Um plano **"ilimitado" NUNCA fecha**: 20 gerações/dia = ~US$ 48/mês de custo, acima de qualquer
  preço pt-BR plausível. Então a assinatura **precisa** de cota — e a cota já existe.
- **[RECOMENDAÇÃO]** O **crédito pré-pago** resolve dois problemas que a assinatura sozinha não
  resolve: (a) a **cauda de custo** — quem satura a cota compra crédito em vez de queimar sua margem;
  (b) o **segmento que não assina** — usuário esporádico paga R$ 10 avulsos via Pix e some, sem
  churn. Crédito pré-pago é **auto-limitante** (não há risco de power-user): a margem fecha sempre.

**Alternativas consideradas:**

| Modelo | Prós | Contras | Veredito |
|---|---|---|---|
| **Só assinatura recorrente** | receita previsível; casa com a cota | não cobre a cauda Opus; perde o esporádico | **incompleto** |
| **Só créditos avulsos** | margem fecha sempre; casa com Pix; sem risco de power-user | sem receita recorrente; atrito de recompra; churn alto | **incompleto** |
| **Híbrido (recomendado)** | recorrência + cauda coberta + esporádico atendido | duas mecânicas para construir/manter | **RECOMENDADO** |

> **Sequência sugerida:** lançar a **assinatura primeiro** (é a que dá recorrência e usa o motor de
> cota pronto). Adicionar créditos pré-pago numa segunda leva, quando o painel de custo (já
> recomendado na análise de monetização) mostrar quem satura a cota.

---

## 2. PSP (provedor de pagamento)

### Contexto que muda tudo

**[FATO]** O **Pix Automático** (débito recorrente autorizado, o diferencial pt-BR) tornou-se
**obrigatório para cobrança recorrente desde 01/01/2026** e já é suportado por ~85% dos bancos
(abr/2026), incluindo todos os grandes. Ele custa **1/10 a 1/20 do cartão recorrente** e reduz churn
involuntário (cartão vencido/recusado). **PORÉM:** na prática o Pix Automático **exige o recebedor
ser Pessoa Jurídica** — no Asaas, por exemplo, é **PJ-only, CNPJ ativo há ≥ 6 meses**. Ou seja: o
diferencial mais forte **está travado pelo gate fiscal** (§5), não pela escolha de PSP.

Enquanto o controlador for **pessoa física** (estado atual — decisão LGPD de 2026-07-03), as opções
reais são **cartão recorrente** e **Pix comum** (QR dinâmico), não o Pix Automático.

### Comparativo (dados de jul/2026 — fontes no fim)

| PSP | Aceita **CPF** (PF)? | Assinatura recorrente | Pix Automático | Cartão (crédito) | Pix comum (receber) | **NFS-e** embutida | Esforço integração | Maturidade pt-BR |
|---|---|---|---|---|---|---|---|---|
| **Mercado Pago** | **Sim** | Sim (cartão+Pix+boleto) | Sim (via MP, ex-PJ) | a partir de ~3,99% (D+30) | 0% p/ maioria; 0,49% p/ CNPJ alto volume | **Não nativo** (só NF-e/NFC-e de produto; NFS-e via terceiro tipo NFe.io) | baixo (SDK maduro, docs pt) | **altíssima** |
| **Asaas** | Sim (PF recebe por Pix/boleto) | Sim; taxa **1,99%** sobre assinatura | **Sim, mas PJ-only** (CNPJ ≥ 6 meses) | (via Asaas) | R$ 0,99 (3 meses) → **R$ 1,99**; 100 grátis/mês por chave | **Sim, nativa** — R$ 0,49/nota, emissão automática por assinatura via API | baixo/médio (API boa, docs pt) | alta |
| **Stripe** | **Sim** (tipo PF, CPF) — **não muda depois** | Sim (Billing maduro) | Não (foco cartão) | taxas mais altas, foco internacional | limitado no BR | Não | baixo (melhor DX), mas **peso internacional** | média no BR |
| **Pagar.me / Vindi** | Orientado a **PJ** | Sim, robusto | Sim (Vindi tem) | competitivo em volume | sim | via integração | médio | alta (mais enterprise) |

### Recomendação: **Mercado Pago agora → Asaas quando houver CNPJ**

- **[RECOMENDAÇÃO] Fase 2a (validar, ainda PF):** **Mercado Pago.** É o único que combina **aceitar
  CPF** + **assinatura recorrente** (cartão + Pix comum) + **maior alcance/confiança do consumidor
  pt-BR** + **SDK maduro**. O custo do Pix comum é 0% para a maioria dos recebedores. Limitação
  aceitável nessa fase: **sem Pix Automático** e **NFS-e não nativa** (baixo volume PF geralmente não
  exige nota — confirmar com contador, §5).
- **[RECOMENDAÇÃO] Fase 2b (com CNPJ, receita provada):** avaliar **migrar para Asaas** pelo combo
  **Pix Automático** (recorrência barata, menos churn) + **NFS-e automática embutida** (R$ 0,49/nota,
  emissão por assinatura via API) + taxa de assinatura previsível (1,99%). É o PSP que melhor casa
  com um micro-SaaS pt-BR **já formalizado**.
- **Por que não Stripe:** melhor DX, mas o **Pix Automático** (o diferencial de custo/churn pt-BR)
  não existe lá, e o produto é 100% consumidor brasileiro — o peso internacional não agrega. Guarde
  Stripe só se um dia houver cobrança em outras moedas.
- **Por que não Pagar.me/Vindi agora:** orientados a PJ/volume; atrito alto para um solo-founder PF
  pré-tração. Vindi vira candidata na Fase 2b se a régua de NFS-e/recorrência do Asaas não bastar.

**Trade-off honesto:** trocar de PSP entre 2a e 2b tem custo (reintegrar checkout, migrar assinantes).
Por isso a §6 recomenda um **adapter atrás de interface** — o PSP fica plugável e a troca não vaza
para o resto do app.

---

## 3. proCaps concretos (tabela + matemática)

**[FATO] Custo unitário** (tabelas em `text-cost.ts`/`image-cost.ts`, câmbio R$ 5,50):

| Ação | Modelo | Tokens típicos | Custo US$ | Custo R$ |
|---|---|---|---|---|
| Geração de receita | **Opus 4.8** ($5/$25 por MTok) | ~3K in + 2,5K out | **$0,078** | **R$ 0,43** |
| Geração de receita | **Sonnet 5** ($3/$15) | idem | $0,047 | **R$ 0,26** |
| Geração de receita | **Haiku 4.5** ($1/$5) | idem | $0,016 | **R$ 0,09** |
| "Gerar 2" (opt-in) | Opus | 2× output | $0,14 | R$ 0,77 |
| Imagem | Gemini Nano Banana 2 | ~1290 out ($60/MTok) | **$0,077** | **R$ 0,42** |
| Extração | Haiku 4.5 | pequeno | ~$0,005 | ~R$ 0,03 |
| Busca web | Brave (até 8 queries) | — | $0,02–0,04 | R$ 0,11–0,22 |

### Free tier: **hoje vs. apertado**

**[FATO] hoje** (defaults por **DIA**, papel `usuario`): 10 gerações + 3 imagens + 60 extrações;
**busca web sem teto**. Pior caso ≈ **R$ 170/mês** por usuário grátis maximizado — insustentável sob
qualquer aquisição.

**[RECOMENDAÇÃO] apertar** (por DIA — mantém o motor de janela 24h atual, zero mudança de engine) e
**rodar o free em modelo mais barato** (Sonnet 5):

| Eixo | Free hoje | **Free apertado** | Custo/dia no teto (modelo) |
|---|---|---|---|
| Gerações de receita | 10/dia | **3/dia** | 3 × R$ 0,26 = **R$ 0,78** (Sonnet 5) |
| Imagens | 3/dia | **1/dia** | 1 × R$ 0,42 = **R$ 0,42** |
| Extrações | 60/dia | **20/dia** | 20 × R$ 0,03 = **R$ 0,60** (Haiku) |
| Busca web | **∞ (vazamento)** | **5/dia** por usuário logado | R$ 0,55–1,10 |

> **[FATO]** Trocar o free para Sonnet 5 é uma decisão de **produto** (qualidade), validável no
> comparador admin (#425), e **não é automática** — o `PROMPT_VERSION` 2 foi afinado para Opus. Se
> preferir manter Opus no free, aperte mais os caps (ex.: 2 gerações/dia).

### Pro tier

Aqui está a tensão central, dita com honestidade:

**[FATO] cap diário × 30 dias explode.** No Opus (R$ 0,43/geração), um cap de 5/dia mantido todo dia
= 150 gerações/mês = **R$ 64,5** de custo — acima de qualquer preço plausível. **Nenhum plano flat
com Opus cobre um usuário que satura a cota todo dia.** A regra da análise de monetização
("dimensionar para o pior caso custar ≤ 80% do preço") só fecha com caps baixíssimos que matam a
sensação de "pro".

Duas formas de resolver — recomendo a **B** para ir ao mercado rápido:

- **Framing A (conservador, exige engine novo):** assinatura com **cota MENSAL incluída** (ex.: 50
  gerações/mês), dimensionada para o teto custar ≤ ~70% do preço. **Requer** adicionar resolução de
  janela **mensal** à cota (hoje é 24h deslizante) — trabalho real de Fase 2.
- **Framing B (pragmático, ZERO mudança de engine — RECOMENDADO):** manter **cap DIÁRIO** (usa o
  motor atual), setar caps `pro` **moderados** que funcionam como **limite de blast-radius por dia**,
  aceitar **margem no caso típico** (não no pior teórico), e vender **crédito pré-pago** para quem
  satura. O painel de custo admin (já recomendado) vigia a cauda.

**[RECOMENDAÇÃO] Tabela `proCaps` (Framing B, por DIA, Opus no pro):**

| Eixo | Free apertado | **Pro (proCaps)** | Custo/dia no teto pro |
|---|---|---|---|
| Gerações de receita | 3/dia (Sonnet) | **5/dia (Opus)** | 5 × R$ 0,43 = **R$ 2,15** |
| Imagens | 1/dia | **3/dia** | 3 × R$ 0,42 = **R$ 1,26** |
| Extrações | 20/dia | **100/dia** | 100 × R$ 0,03 = R$ 3,00 |
| Busca web | 5/dia | **30/dia** | R$ 3,3–6,6 |

**Matemática de margem (Pro a R$ 24,90/mês):**

- **Usuário pro típico** (~2 gerações/dia em ~12 dias ativos + ~1 imagem em ~8 dias):
  24 × R$ 0,43 + 8 × R$ 0,42 = **~R$ 13,7 de custo/mês**. Menos taxa PSP (~R$ 0,40 no Pix Automático,
  ou ~R$ 1,00 no cartão) ⇒ **margem ~R$ 10,5–11 (≈ 43%)**.
- **Usuário pro pesado** (satura quase todo dia): pode passar de **R$ 50/mês de custo** ⇒ **margem
  negativa**. **[FATO] essa cauda existe e o plano flat não a cobre.** Mitigação: (a) o cap diário
  limita o estrago; (b) o painel de custo detecta o padrão; (c) excedente vira **crédito pré-pago**;
  (d) se virar comum, criar tier acima. Estimo essa cauda em **< 1–2% dos assinantes** — aceitável
  pré-tração, **mas precisa ser vigiada**.

**Crédito pré-pago (auto-limitante, margem sempre positiva):**
- R$ 10 = **12 gerações** (R$ 0,83/geração vs custo R$ 0,43) ⇒ **~48% de margem** bruta.
- Imagem: R$ 1,50–3,00/foto em pacote ⇒ **70–85% de margem**.

---

## 4. Preço

### Recomendação: **R$ 24,90/mês** · anual **R$ 249/ano** (≈ R$ 20,75/mês, ~2 meses grátis)

**Por quê:**
- **[FATO]** Âncoras pt-BR de assinatura de consumo: Spotify ~R$ 23,90, streamings R$ 20–40. Um app
  de receitas com IA precisa ficar **na faixa de "app de consumo"**, não de ferramenta profissional.
- **[FATO / matemática]** A R$ 24,90 com os caps da §3, a **margem no uso típico é ~43%** e ainda há
  folga para a taxa do PSP. A R$ 19,90 a margem típica cai para ~30% e o teto fica desconfortável; a
  R$ 29,90 há mais colchão para a cauda Opus, ao custo de conversão.

**Faixas alternativas:**

| Preço/mês | Margem típica | Colchão p/ cauda Opus | Nota |
|---|---|---|---|
| **R$ 19,90** | ~30% | fraco | mais conversão; margem apertada |
| **R$ 24,90** (recomendado) | ~43% | ok | melhor equilíbrio |
| **R$ 29,90** | ~54% | bom | menos conversão; mais seguro |

**Anual:** **R$ 249/ano** dá ~2 meses grátis (desconto ~17%), melhora *cashflow* e reduz churn.
Alternativa mais agressiva: R$ 199/ano (~33% off) para adiantar caixa na largada.

> **[RECOMENDAÇÃO]** Lançar **mensal + anual** juntos. O anual é o que mais ajuda um solo-founder
> (caixa adiantado, menos cobrança recorrente para gerenciar).

---

## 5. Checklist fiscal / legal

> **[INCERTO / NÃO É ACONSELHAMENTO JURÍDICO]** Abaixo, o que **decidir** e o que **perguntar a um
> contador**. A decisão fiscal **trava o Pix Automático e a NFS-e** — por isso é o gate da Fase 2b.

### Estrutura: PF vs MEI vs ME/CNPJ

| Estrutura | Prós | Contras | Quando |
|---|---|---|---|
| **Pessoa Física** (hoje) | zero burocracia; começa já; nova **isenção de IR até R$ 5.000/mês** (Lei 15.270/2025, vigente jan/2026) ajuda no baixo volume | **carnê-leão** mensal (DARF 0190) sobre o recebido; **sem Pix Automático**; NFS-e como PF é limitada/municipal | **validar** (Fase 2a) |
| **MEI** | **Pix gratuito**; IR isento até **R$ 81 mil/ano**; NFS-e barata; **desbloqueia Pix Automático + NFS-e automática** | **[INCERTO] o CNAE de software/SaaS pode NÃO estar na lista de ocupações MEI** — confirmar; teto R$ 81k/ano | **ao provar receita** (Fase 2b), *se* o CNAE permitir |
| **ME / Simples Nacional** | sem o teto do MEI; atividade de software permitida | contador obrigatório; mais custo/burocracia; **[FATO]** carga de SaaS na reforma 2026 pode chegar a **25–28%** (com transição) | se estourar MEI ou CNAE não couber |

**[RECOMENDAÇÃO]** Faseado: **PF para validar** → **MEI se o CNAE couber** (mais provável ser
enquadrado como serviço de "desenvolvimento/licenciamento de software" — **confirmar**) → **ME**
quando crescer. Não abrir CNPJ antes de haver receita que justifique o custo mensal do contador.

### Perguntas objetivas para o contador
1. Existe **ocupação MEI** que cubra "app/SaaS de receitas por assinatura"? Se não, o caminho é ME?
2. Como **PF de baixo volume**, preciso emitir **NFS-e** por cada assinatura, ou basta carnê-leão?
3. Como a **isenção de até R$ 5.000/mês (Lei 15.270/2025)** interage com receita recorrente de app?
4. **Reforma tributária 2026** (IBS/CBS): qual a carga efetiva sobre SaaS por assinatura no meu caso?
5. A migração **PF → MEI/ME** exige **nova conta no PSP** e altera a **página de privacidade**
   (controlador vira PJ)? (Sim, provavelmente — planejar.)

### Direito de arrependimento (CDC art. 49) + cancelamento/reembolso
- **[FATO]** Contratação **online/à distância** dá ao consumidor **7 dias de arrependimento** a
  contar da assinatura, com **devolução integral** dos valores.
- **[FATO]** Isso **se aplica a serviços digitais/assinaturas** (jurisprudência recente: streaming,
  curso online, licenciamento de app).
- **[FATO]** Exceção possível: se o usuário **consumiu substancialmente** o serviço no prazo **e** foi
  **avisado com clareza** da renúncia — mas sem cláusula válida, o cancelamento em 7 dias **deve** ser
  aceito.
- **[RECOMENDAÇÃO] Política mínima a publicar** (ao lado de `/privacidade` e `/seus-direitos`):
  - **7 dias**: reembolso integral, sem pergunta, por canal simples (e-mail/formulário) — **sem
    barreiras nem exigência de justificativa** (vedado por lei).
  - **Após 7 dias**: cancelamento a qualquer momento, **sem multa**; acesso segue até o fim do ciclo
    pago; **sem reembolso proporcional** do ciclo corrente (padrão de mercado, aceitável).
  - **Crédito pré-pago**: deixar claro se é **não-reembolsável após uso** e prazo de validade (definir
    validade generosa, ex.: 12 meses, para evitar atrito de consumo).
  - Cancelamento **self-service** na conta (não só por e-mail) reduz reclamação e é boa prática.

### O que precisa de contador (não delegável a agente)
Escolha PF/MEI/ME; enquadramento de CNAE; obrigação (ou não) de NFS-e no volume atual; carnê-leão;
impacto da reforma 2026; e o gatilho de quando migrar.

---

## 6. Plano de implementação (faseado)

### O que EU posso codar **antes** de qualquer decisão comercial (destravado)

Tudo abaixo é **aditivo e flag-off** — não liga cobrança, não muda teto efetivo, não trava preço:

1. **Persistir `proCaps`** no `app_config` (P0). O eixo `plan` e a resolução já existem
   (`recipe-gen-config.ts` etc.); falta a **linha de config `pro`** (as três tabelas por papel) e o
   parse/validação — espelhando `parseRecipeGenCapByRole`/`parseImageGenConfig` já prontos.
2. **Tela admin de plano** (P0). Aba em `/admin` para editar os `proCaps` das 3 dimensões, no mesmo
   padrão das abas de config já existentes (`/admin/ia`). Permite calibrar a §3 sem deploy.
3. **Apertar os defaults do free** (P1) — mudança de config, quando você decidir os números da §3.
   Reversível.
4. **Adapter de PSP atrás de interface** (P1). Definir um *seam* `BillingProvider`
   (`createCheckout`, `handleWebhook`, `getSubscriptionStatus`) com uma implementação **stub/fake**
   testável, **sem** SDK real ainda. Isola a escolha de PSP do resto do app (torna a migração
   MP→Asaas barata).
5. **Página de plano / paywall UI** (P1). Hoje o 429 de cota já devolve `retryAfterMs`; trocar o
   countdown por "assine o pro / compre créditos" — **estático**, sem checkout ligado.
6. **Persistir `users.plan` de verdade** (P1) + tela admin para marcar um usuário como `pro`
   manualmente (permite **conceder pro na mão** — útil para os primeiros clientes/concierge, sem
   billing).

### O que **trava** na decisão comercial

- **Escolha do PSP** (§2) → implementar a `BillingProvider` real (SDK do MP ou Asaas), checkout,
  webhook de confirmação, atualização de `users.plan` no callback.
- **Decisão fiscal** (§5) → cadastro no PSP (CPF vs CNPJ), Pix Automático (só com CNPJ), NFS-e.
- **Preço final** (§4) → configuração do plano/assinatura no PSP.
- **Modelo (só-assinatura vs + créditos)** (§1) → se híbrido, a ledger de créditos pré-pago é uma
  segunda leva (a quota-por-plano vem primeiro).

### Ordem sugerida
**Passo 1 (agora, sem gate):** itens 1–2 e 6 → você já consegue **conceder `pro` na mão** e ver o
efeito nos caps. Passo 2: itens 4–5 (adapter + paywall estático). **Gate comercial:** você decide PSP
+ fiscal + preço. **Passo 3:** billing real do PSP escolhido. **Passo 4:** créditos pré-pago +
apertar free no lançamento.

---

## Fontes (jul/2026)

- Pix Automático (recorrência, ~85% bancos abr/2026, obrigatório desde 01/01/2026, 1/10–1/20 do
  cartão): [SocialHub](https://www.socialhub.pro/blog/pix-automatico-recorrencia-e-commerce/),
  [PagBrasil](https://www.pagbrasil.com/pt-br/blog/noticias/pix-automatic-2026/),
  [Mercado Pago](https://www.mercadopago.com.br/blog/pix-automatico-gestao-assinaturas-receita-recorrente),
  [Let's Money](https://www.letsmoney.com.br/noticias/pagbrasil-pix-automatico-um-ano-recorrencia)
- Mercado Pago — assinaturas, taxas Pix/cartão:
  [Docs Assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview),
  [Custo do Pix](https://www.mercadopago.com.br/blog/quanto-custa-receber-pagamentos-via-pix-e-codigo-qr),
  [Taxas cartão](https://www.calculadoradetaxas.com.br/mercado-pago),
  [Emissão de NF (NF-e/NFC-e, não NFS-e nativa)](https://www.mercadopago.com.br/blog/integracao-nota-fiscal-eletronica-sistema-pagamento)
- Asaas — assinatura 1,99%, Pix R$0,99/1,99, NFS-e R$0,49 nativa, Pix Automático PJ-only:
  [Preços](https://www.asaas.com/precos-e-taxas),
  [NFS-e](https://www.asaas.com/nota-fiscal),
  [NFS-e por assinatura (API)](https://docs.asaas.com/docs/emitir-notas-fiscais-automaticamente-para-assinaturas),
  [Pix Automático (PJ)](https://blog.asaas.com/release/pix-automatico/)
- Stripe BR — aceita CPF (PF), tipo imutável, sem Pix Automático/NFS-e:
  [Info Brasil](https://support.stripe.com/questions/brazil-specific-information-to-open-a-stripe-account),
  [Vender sem PJ](https://support.stripe.com/questions/selling-on-stripe-without-a-separate-business-entity)
- Pagar.me/Vindi/taxas Pix PJ (0,99–1,45%), MEI Pix grátis:
  [Vindi](https://vindi.com.br/formas-de-pagamentos/pix/),
  [Serasa](https://www.serasa.com.br/minhas-contas/blog/taxa-pix-para-cnpj/)
- Fiscal — MEI (R$81k, IR isento, Pix grátis), carnê-leão (DARF 0190), isenção R$5k/mês
  (Lei 15.270/2025), SaaS/reforma 25–28%:
  [Carnê-Leão RFB](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/carne-leao/manual),
  [Tributação SaaS 2026](https://esconcontab.com.br/tributacao-para-saas/),
  [IRPF 2026 autônomos](https://sulcontabilsc.com.br/irpf-2026-autonomos-carne-leao-pix/),
  [MEI/autônomos IR 2026](https://confirp.com.br/imposto-de-renda-autonomos-meis-profissionais-liberais/)
- CDC art. 49 — 7 dias de arrependimento em serviços digitais:
  [Serasa](https://www.serasaexperian.com.br/conteudos/direito-de-arrependimento-do-cdc/),
  [ConJur (serviços digitais)](https://www.conjur.com.br/2025-mai-25/direito-de-arrependimento-em-servicos-digitais-posso-cancelar-streaming-curso-online-ou-app/),
  [gov.br/MJ](https://www.gov.br/mj/pt-br/assuntos/noticias/consumidor-tem-direito-ao-arrependimento-em-compras-on-line)
