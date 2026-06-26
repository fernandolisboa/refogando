# Dimensionamento do seed de catálogo (#238)

> Pesquisa de 2026-06-26 para refinar o critério de aceitação da issue #238
> ("SEO: seed inicial do catálogo — HITL gerar-com-nosso-AI + curadoria").
> Método: workflow de 13 agentes — 6 ângulos de pesquisa web em paralelo, 1 cético
> adversarial por ângulo (fact-check), 1 síntese. ~192 buscas web.

## Pergunta

Quantas receitas o seed de catálogo precisa ter no lançamento, e **quais** receitas
tradicionais/populares são "obrigação" um site de receitas ter? O dono pensava 50,
hoje pensa "200, talvez pouco". O app é bilíngue (pt-BR + en-US), SEO-driven,
home feed-first; o catálogo é gerado pelo nosso AI + curadoria (`origin=catalog`),
nunca copia de fora.

## Veredito: 200 é o piso certo (mirar ~220–230 na produção)

A intuição "200, talvez pouco" está **bem calibrada**. Os 50 antigos são baixos demais.
O ponto decisivo: **50 e 200 respondem perguntas diferentes.**

| Bar exigido | Regra | Total | Leitura |
|---|---|---|---|
| "Não nascer literalmente vazia" | ≥3 por cozinha | ~50 | a intuição **antiga** |
| "Prateleiras navegáveis" | ≥6 por cozinha | ~85 | intermediário |
| **"Ter o que é obrigação ter"** | cânone BR ~61–85 + staples × cozinhas + americana | **~200** | **o bar declarado pelo dono** |

A dimensão que manda no piso é **cozinha** (baldes mutuamente exclusivos — cada receita
cai em 1). Categoria e restrição não *somam* ao total (descrevem o mesmo pool por outro
ângulo). O cluster brasileiro+regional sozinho já consome ~61–85 receitas só de cânone —
50 não cobre nem isso.

Referências de coleção curada "essencial": ATK *100 Recipes* = 100; Bittman *Basics* = 185;
*The Food Lab* ≈ 300. 200 senta no meio. **Alvo maduro (pós-seed): 250–300.**

> **Honestidade intelectual:** o "~200" é raciocínio de cobertura (densidade por faceta +
> soma do cânone), **não** uma constante provada por fonte externa. Por isso miramos
> ~220–230 na produção, pra entregar ~200–210 líquidas após o corte da revisão humana.

## Decisões do dono (2026-06-26)

1. **Criar faceta `americana`** (decisão (a)) — mini-foco em cânone americano, cross-regional,
   **não** por estado (por estado explodiria a vocabulário e quebraria a simetria; só o Brasil
   ganhou faceta regional — baiana/mineira). Resolve os órfãos en-US (cookies/pancakes/burger).
2. **Head-focus** — brasileira concentra (≥40); nichos ficam no piso (≥8) mas nunca vazios.
3. **Mirar ~220** na produção (folga pro corte da revisão).
4. **Restrições "frescas" magras** — vegano/low_carb/sem_açúcar **sem seed deliberado no v1**;
   nascem com o que vier, facetas magras = noindex. Não é foco agora.

## Critério de aceitação refinado

### Travas (inegociáveis)
- Toda receita gerada pelo **nosso AI** + **revisada por humano**, revisão **registrada** (`origin=catalog`).
- **Nenhum texto/foto copiado de site externo** (nem reescrita disfarçada).

### Volume e cobertura
- **Total ≥ 200** (produção ~220–230).
- **Por cozinha** (head-focus; nenhuma < 8):

  | Cozinha | Mín. | Cozinha | Mín. |
  |---|---|---|---|
  | brasileira | 40 | árabe | 11 |
  | americana | 18 | mineira | 11 |
  | italiana | 14 | chinesa | 10 |
  | japonesa | 12 | portuguesa | 10 |
  | mexicana | 11 | baiana | 9 |
  | indiana | 11 | tailandesa | 9 |
  | francesa | 11 | mediterrânea | 8 |
  | | | peruana | 8 |

  (soma dos pisos ≈ 193; o restante até ~200–220 é folga de curadoria)

- **Por categoria:** prato_principal ≥60 · sobremesa ≥30 · lanche ≥20 · entrada ≥18 ·
  acompanhamento ≥16 · café_da_manhã ≥14 · molho ≥12 · bebida ≥10.
- **Por restrição:** a maioria pega carona (sem_frutos_do_mar/sem_oleaginosas ≥140 via tag;
  sem_lactose ≥40; sem_glúten/vegetariano ≥30). vegano/low_carb/sem_açúcar **sem mínimo no v1**.
- **Lista núcleo-obrigatório (abaixo) 100% incluída** — bloqueio: faltar feijoada/brigadeiro/
  pão de queijo/moqueca = falha de credibilidade.

### Qualidade de faceta (anti-thin-content)
- Páginas de faceta abaixo do piso nascem **noindex** até povoadas.
- Combos cozinha×categoria vazios (ex.: "café da manhã peruano") ocultados/acinzentados,
  não prometidos (mincount=1).

### Pré-requisito de código
- Adicionar `americana` ao enum `COZINHAS` (`src/domain/vocabulary.ts`) + rótulos i18n
  (`cozinhaLabel` em pt-BR/en-US). Pode ser PR precursor.

## Núcleo-obrigatório — Brasil (~61 hard, ~85 com 2ª camada)

**Brasileira geral (37)**
- *Prato principal (6):* feijoada, arroz com feijão, picanha/churrasco, strogonoff de frango, bife à parmegiana, baião de dois
- *Sobremesa (8):* brigadeiro, beijinho, pudim de leite condensado, bolo de cenoura, mousse de maracujá, quindim, cocada, pavê
- *Lanche/salgado (5):* coxinha, pastel de feira, empada de frango, risole, bolinho de chuva
- *Acompanhamento (5):* farofa, arroz branco soltinho, feijão temperado, couve refogada, vinagrete
- *Café da manhã (4):* tapioca, pão na chapa, bolo de fubá, cuscuz de milho
- *Bebida (3):* caipirinha, suco de maracujá, limonada suíça
- *Entrada (2):* bolinho de mandioca, caldo de feijão
- *Molho (2):* molho de pimenta caseiro, chimichurri/molho à campanha
- *Lanche (2):* misto quente, cachorro-quente

**Baiana (8):** acarajé, moqueca baiana, vatapá, caruru, bobó de camarão, xinxim de galinha, abará, cocada baiana

**Mineira (9):** pão de queijo, feijão tropeiro, tutu, frango com quiabo, doce de leite, goiabada cascão, Romeu e Julieta, angu, torresmo

**Herança lusa enraizada (7):** bacalhoada/bolinho de bacalhau, caldo verde, rabanada, arroz doce, pastel de nata, canja de galinha, sonho

**2ª camada (~+24):** escondidinho de carne-seca, galinhada, pamonha, canjica, paçoca, pé de moleque, açaí na tigela, mandioca frita, etc.

## Núcleo-obrigatório — americana (~18–25, cross-regional)

cheeseburger · fried chicken · mac and cheese · pulled pork (BBQ) · BBQ ribs · buffalo
wings · jambalaya (Cajun) · philly cheesesteak · club sandwich · pancakes · waffles ·
French toast · eggs benedict · biscuits and gravy · apple pie · brownies · chocolate chip
cookies · New York cheesecake · pecan pie · cornbread · coleslaw · caesar salad · mashed
potatoes & gravy · cinnamon rolls

## Piso internacional (~70–80, ~6–8 por cozinha)

| Cozinha | Staples |
|---|---|
| Italiana | carbonara, lasanha à bolonhesa, pizza margherita, risoto, nhoque, sugo, tiramisù |
| Japonesa | sushi, ramen, yakisoba, tempurá, gyoza, temaki, sopa de missô |
| Mexicana | tacos, guacamole, quesadilla, enchiladas, burrito, salsa/pico de gallo |
| Indiana | butter chicken/tikka masala, biryani, dal, naan, samosa, curry de grão-de-bico |
| Francesa | quiche lorraine, ratatouille, coq au vin, crème brûlée, croissant, sopa de cebola |
| Árabe | homus, falafel, shawarma, tabule, baba ganuche, baklava |
| Chinesa | frango xadrez, arroz frito, chow mein, frango agridoce, rolinho primavera, guioza |
| Tailandesa | pad thai, curry verde, tom yum, massaman, pad krapow |
| Mediterrânea | salada grega, moussaka, tzatziki, gyros, shakshuka, falafel |
| Peruana | ceviche, lomo saltado, ají de gallina, causa limeña, pollo a la brasa |
| Portuguesa | coberta pela herança lusa do cluster brasileiro |

## Ressalvas (estatísticas refutadas pelo cético — NÃO citar como fato)

- O "top-10 do Ministério do Turismo" (feijoada 1º) é **enquete de marketing turístico**
  (amostra ~2.151), não estudo oficial. Vale como sinal de demanda, não como prova de obrigação.
- "Sandbox do Google de 3–9 meses" é **mito** negado pelo próprio Google — use "sites novos
  levam meses pra ganhar confiança".
- Conversão "cauda-longa 36% vs head 11%" é **comparação inválida**.
- "3–5 itens por página de faceta" vem de fonte única — heurística, não constante.

A **direção** (densidade por faceta + cânone obrigatório) é sólida; os números exatos de
terceiros, não. O ~200 é planejamento, refinável na curadoria.

## Premissas

- **Bilinguismo não muda a contagem.** Conta-se *receitas* (conceitos), não páginas por locale.
  200 receitas = ~400 páginas indexáveis (pt-BR + en-US), mas continua **200 unidades de oferta**.
- O seed é o **arranque** do catálogo/SEO, não o estado final — cresce por cadência depois.
