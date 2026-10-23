# ADR-0053 — Navegação rápida: funções em São Paulo, detalhe em duas etapas e cache do roteador

Status: aceito (2026-10-23)

Pedido do Fernando (2026-10-23): abrir uma receita, e voltar a ela, demorava "um bom tempo", mesmo já visitada. Ele
sugeriu cachear telas e requisições, mostrar o que já se tem e atualizar em segundo plano, e pré-carregar a receita
ao passar o mouse. Decisão de região tomada por ele no mesmo dia ("Mover para São Paulo").

## Contexto (medido em produção, 2026-10-23)

- `/{locale}/recipes/<slug>` levava **~1,4 s no servidor em toda requisição**, HTML ou RSC (navegação no app), sem
  diferença entre primeira visita e revisita. A home levava ~0,6 s e `/cooks` ~0,8 s.
- As funções da Vercel rodavam em `iad1` (Washington) e o banco Neon fica em `sa-east-1` (São Paulo): **~120 ms por ida
  e volta**. O postgres.js no pooler (`prepare:false`) faz Parse/Describe antes do Bind, então cada consulta
  parametrizada custa duas idas e voltas (handoff 66). O detalhe encadeava ~6 etapas seriais (gate por slug → espinha
  → traduções/itens/tags/autor/imagem → avaliações, que reliam o gate antes do agregado → vocabulário de cozinha) ≈ 12
  idas e voltas ≈ 1,4 s. O tempo era quase todo geografia, não CPU nem volume de dados.
- No navegador, o detalhe é rota dinâmica sem `loading.tsx` (fica fora do grupo `(com-carregamento)` para responder
  404/308 de verdade, #578). Consequências: o `<Link>` só pré-carregava o layout; o clique não dava sinal nenhum até a
  página chegar; e, com `staleTimes.dynamic` padrão (0), cada navegação por link ia ao servidor de novo (só o botão
  voltar do navegador reusava a página).
- O ISR do detalhe (A passo 2, `docs/perf/2026-10-14-a-passo2-isr-detalhe-proposta.md`) segue fora: cache
  compartilhado entregaria receita despublicada ao primeiro anônimo e pede ~55 escritores invalidando.

## Decisão

1. **Funções em `gru1` (São Paulo).** `vercel.json` → `"regions": ["gru1"]`, ao lado do banco (e do store do Blob, que
   já estava em `gru1`). A ida e volta ao banco cai para poucos ms, em todas as rotas, APIs e crons; quem acessa do
   Brasil também deixa de atravessar até os EUA. Custos aceitos: a CPU em `gru1` é mais cara que em `iad1` (no
   tráfego atual cabe no incluído do Pro); chamadas à Anthropic, Gemini, Brave e Resend passam a atravessar para os
   EUA (+~0,1 s por chamada, irrelevante em gerações de dezenas de segundos). Jurídico: política v3.6 (item 5,
   transferência internacional), texto do consentimento das restrições salvas versão `2026-10-23` ("o app funciona no
   Brasil e a IA, nos Estados Unidos"), registro de operações e nota no parecer. É menos transferência, a favor da
   pessoa: vale na publicação, sem o aviso de 15 dias (critério do ADR-0051); quem já tinha restrições salvas vê o
   aviso informativo no formulário (art. 8º, §6) e não perde nada se não salvar de novo.
2. **Detalhe em duas etapas.** `loadPublicRecipeRowBySlug` casa `(locale, slug)` e traz a linha inteira de `recipe`
   numa query, já com o gate público. Com a linha em mãos, a página dispara em paralelo o resto da receita
   (`loadRecipeRowsForRow`), slugs, cozinhas ativas, avaliações, aviso de catálogo, semelhantes, crédito e o
   vocabulário de cozinha da chrome (antes lido em série no `DetailChrome`). `loadRecipeReviews` roda o gate em
   paralelo com o agregado e a lista e descarta as duas fora do pool (`null`, leak-safe como antes). Saída idêntica,
   ~6 etapas seriais → 2. `generateMetadata` divide as mesmas leituras pelo `React.cache` (a linha da etapa 1 é a
   mesma identidade nas duas chamadas).
3. **Cache do roteador só no detalhe: `export const unstable_dynamicStaleTime = 300`** na página. Por 5 minutos, voltar
   a uma receita já aberta (por link, não só pelo botão voltar) reusa a página que a aba já tem. As outras rotas não
   mudam (`staleTimes.dynamic` global continua 0). Correção:
   - É o cache de **uma aba**: nada é servido a outra pessoa, então não há o vazamento que barrou o ISR.
   - O que a própria pessoa muda na página chama `router.refresh()`, que no Next 16 invalida o cache de segmentos e o
     bfcache inteiros: edição, imagem, avaliação, clonar/regenerar já chamavam; o controle de crédito (#610) passou a
     chamar. A sessão que some ou troca de conta recarrega a página (`SessionLossGuard`, ADR-0028).
   - Fica de fora a mudança feita por **outra** pessoa nesses 5 minutos (uma avaliação nova, uma edição do autor em
     outro aparelho): aparece na próxima busca ou num recarregar. Os controles do leitor (salvar, gestão do dono,
     a própria avaliação) buscam o estado no cliente ao montar, então seguem frescos.
   - **Por que não "mostra o cache e atualiza em segundo plano"**: o único jeito de o Next atualizar a página exibida
     é `router.refresh()`, que joga fora o cache de todas as rotas (inclusive o do botão voltar). Usá-lo a cada
     revisita anularia o ganho. A janela de 5 minutos com invalidação imediata nas mudanças da própria pessoa é a
     forma barata e correta do mesmo efeito.
4. **Pré-carregamento no hover/toque: `RecipeLink`** (`src/components/recipe/recipe-link.tsx`), um `<Link>` com
   `unstable_dynamicOnHover` (habilitado por `experimental.dynamicOnHover` no `next.config.ts`). Passar o mouse ou
   encostar o dedo num card busca a página **inteira**, e o clique logo depois abre do cache. Usado nos cards de
   lista (Busca/feed/perfil/semelhantes via `RecipeResultItem`, Salvos, Minhas receitas, Cardápio, Despensa); links
   de texto soltos e o da sugestão do Cardápio (abre em nova aba) seguem com `<Link>`. Custo aceito: cada hover/toque
   é uma renderização no servidor; numa rolagem no celular, o toque que vira rolagem também pré-carrega.
5. **Retorno imediato no clique.** O `RecipeLink` mostra uma barra fina no topo (`.nav-pending-bar`, portal no
   `<body>`) enquanto `useLinkStatus().pending`; aparece só depois de 150 ms, então a navegação pré-carregada não
   pisca. Não muda o status HTTP (nada de Suspense acima do `notFound`/`permanentRedirect`).

## Consequências

- Duas APIs `unstable_` do Next 16 (`unstable_dynamicStaleTime`, `unstable_dynamicOnHover`): numa atualização do
  Next, conferir se mudaram de nome. O tipo público de `next/link` não traz a prop; o `RecipeLink` faz o cast para o
  tipo do Link do App Router.
- Os mocks de `next/link` nos testes de UI precisam exportar `useLinkStatus` (todos ganharam a linha).
- Nova mutação na página da receita feita por quem a vê: chamar `router.refresh()` depois do sucesso, senão uma
  revisita em 5 minutos mostra o estado antigo.
- Novo link de lista para o detalhe: usar `RecipeLink`.
- Trocar de região de novo muda a política (item 5) e o texto do consentimento das restrições (CLAUDE.md, Privacidade).
