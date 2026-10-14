# Handoff 70 — Gaveta "Criar" sob demanda e mais larga (512 px)

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `fefe5a2`, depois do #575). **Migração:** nenhuma. Continuação da auditoria do handoff 64: passo 6 da ordem aprovada em `docs/perf/2026-10-13-respostas.md` (o último), achado G. Aprovado pelo dono: carregar a gaveta sob demanda, com pré-carga no hover, no foco e no ocioso, e fallback para `/create` se o chunk falhar; e a largura de `sm:max-w-md` (448 px) para `sm:max-w-lg` (512 px). Fora a largura, a gaveta abre, fecha, foca e se anuncia como antes.

## 1. O que foi entregue

- **`src/components/recipe/create-drawer-lazy.tsx` (novo).** O header não importa mais `create-drawer`; monta `LazyCreateDrawer` com o mesmo `open`/`onOpenChange`. O código da gaveta vem de um `import('./create-drawer')`: é o **primeiro chunk lazy do app**.
  - **Store de módulo** (`useSyncExternalStore`), um por documento: `idle` → `loading` → `ready` (com o componente) ou `failed`. O header persiste entre navegações, então o estado também.
  - **`preloadCreateDrawer()`**: idempotente (só a primeira chamada faz o `import()`) e nunca rejeita. A rejeição é tratada no `.then(…, onRejected)`, loga `[criar] a gaveta não carregou; o "Criar" vai abrir /create` e vira `failed`.
  - **Pré-carga:** no ocioso, uma vez por documento, logo depois da hidratação (`requestIdleCallback` com `timeout` de 3 s; sem ele, como no Safari, `setTimeout` de 1,5 s); e no `pointerenter`, `pointerdown` e `focus` do "Criar" e ao abrir o menu mobile (o "Criar" do celular mora nele).
  - **Clique com o chunk carregado** (o caso normal, porque o ocioso já o trouxe): a `CreateDrawer` já está montada fechada, como antes, e abre no mesmo render.
  - **Clique antes do chunk:** o header guarda `createOpen = true` e o botão ganha `aria-busy="true"` e `cursor-progress`; a gaveta abre no instante em que o chunk chega, com a animação, o foco e o Escape de sempre.
  - **Chunk que falhou** (antes ou depois do clique): o efeito do wrapper fecha o pedido e faz `window.location.assign('/{locale}/create')` (`createPagePath`, `localePrefixedPath` do ADR-0020). É navegação dura: a rota busca o HTML do deploy atual, e a `/create` importa a gaveta direto (`CreateShellClient`) e a abre no método-picker, que é onde o "Criar" abre. Cada clique seguinte faz o mesmo; não há segundo `import()` (ver §5).
  - **Sem `next/dynamic` nem `React.lazy`, de propósito.** Os dois jogam a rejeição do `import()` no render: cairia numa error boundary e, por ser chunk error, no reload do ADR-0028, que é o que o dono pediu para evitar. Eles também não dizem a quem abre se o código já chegou. O efeito de `ssr: false` vem do estado: no servidor o snapshot é `idle` e o wrapper não renderiza nada (a gaveta fechada também não renderizava nada antes: o Radix só porta o conteúdo aberto).
  - **Sem "casca" provisória, de propósito.** Mostrar outro Radix Dialog enquanto o chunk chega e trocá-lo pela gaveta real repetiria a animação de entrada (overlay e painel) e o foco de abertura iria parar no X da casca. Abrir só quando o código chegou mantém foco, Escape, `aria-*` e animação idênticos; o `aria-busy` cobre a espera, que com a pré-carga só acontece num clique no primeiro segundo da página.
- **Header** (`src/components/site-header.tsx`): o botão "Criar" (o mesmo nó no desktop e no menu mobile) ganhou os três handlers de pré-carga, o `preloadCreateDrawer()` no clique e o `aria-busy` só enquanto espera; o `onOpenChange` do menu mobile pré-carrega ao abrir. Nada mais mudou: o botão segue sem `aria-expanded`/`aria-haspopup` (como antes), o `data-tour="criar"` do tour guiado continua nele.
- **Largura** (`src/components/recipe/create-drawer.tsx`): `sm:max-w-md` → `sm:max-w-lg`. No celular segue `w-full` limitado pelo `max-w-sm` (384 px) da primitiva `Sheet`; de 640 px para cima, 512 px.
- **`AppUpdateGuard`** (`src/components/app-update-guard.tsx`): só o comentário, que dizia "a base não tem nenhum `import()`"; agora explica a interação com a gaveta (§5) e o que fazer num próximo `import()` mid-screen.
- **Testes** (`test/ui/create-drawer-lazy.test.tsx`, 10 testes): o header real com o `AppUpdateGuard` montado e o `import()` controlado por `vi.doMock` (quando chega, se falha, quantas vezes foi pedido); `requestIdleCallback` dublado.
  - nada é pedido na montagem, só no ocioso; sem `requestIdleCallback`, o `setTimeout` de 1,5 s;
  - `pointerenter`, `focus` e `pointerdown` pré-carregam sem abrir, com um `import()` só; o foco pelo teclado também; abrir o menu mobile também;
  - chunk já carregado: o clique abre na hora (asserção síncrona), com o foco no 1º card do método-picker; Escape fecha e o foco fica no `body`, como antes (§5);
  - clique antes da pré-carga terminar: nenhum dialog, botão `aria-busy="true"`; o chunk chega e a gaveta abre com o mesmo nome acessível e o mesmo foco; o `aria-busy` some;
  - `import()` que falha depois do clique, com as duas faces da falha real (o `error` de recurso do `<script>` e a rejeição com `name: 'ChunkLoadError'`): `location.assign('/pt-BR/create')` uma vez, nenhum `reload`, nada no `sessionStorage` do guard, nenhum dialog;
  - pré-carga que já falhou: cada clique vai direto para `/en-US/create`, sem novo `import()` e sem reload;
  - largura: `w-full`, `max-w-sm`, `sm:max-w-lg`, sem `sm:max-w-md`.
  - Os testes existentes do header (`site-header-create`, `site-header-mobile`, `onboarding-entry-points`) e da gaveta passam sem mudança: os que abrem a gaveta pelo header já esperavam o dialog com `findByRole`/`waitFor`.
- ADR-0021 e ADR-0028 ganharam uma linha de atualização; relatório: G resolvido, §8 novo, e a ordem de 2026-10-13 marcada como concluída nos dois documentos de `docs/perf/`.

## 2. Evidência

`next build` (Next 16.2.9, Turbopack) com o env da CI (`BETTER_AUTH_SECRET` dummy, sem `DATABASE_URL`), antes (`fefe5a2`) e depois, e `next start` local. O Next 16 não imprime mais o tamanho por rota ("First Load JS"); a tabela de rotas do build é idêntica antes e depois (mesmos `ƒ`/`○`). A medida é a dos `<script src>` do HTML de cada página, somando os arquivos de `.next/static/chunks` (bruto e `gzip -9`). Marcador do código da gaveta nos chunks: a prop `onBackHandlerChange` (não é minificada e só a gaveta a usa).

| Página | Antes | Depois | Diferença |
|---|---|---|---|
| `/pt-BR/privacidade` | 21 chunks, 1.117.903 B, 344.974 B gzip; gaveta incluída (`0uwq__79br0u-.js`, 55.513 B / 14.164 B gzip) | 20 chunks, 1.026.233 B, 319.220 B gzip; nenhum chunk com a gaveta | −91.670 B (−8,2%), −25.754 B gzip (−7,5%) |
| `/pt-BR` (home) | 22 chunks, 1.145.175 B, 353.500 B gzip; gaveta incluída | 21 chunks, 1.064.986 B, 331.553 B gzip; sem a gaveta | −80.189 B, −21.947 B gzip |
| `/pt-BR/create` | 21 chunks, 1.112.785 B, 343.823 B gzip | 22 chunks, 1.114.463 B, 345.452 B gzip | +1.678 B, +1.629 B gzip |

- **O que o `import()` baixa** (a lista que o runtime do Turbopack carrega para o módulo da gaveta): `1io92reoixxhk.js` (a gaveta e as três experiências, 55.244 B / 14.120 B gzip), `06cpnhgact_-v.js` (Popover e o "pôr no cardápio" do resultado, 20.281 B / 7.054 B gzip) e `2w201r4fi2-c4.js` (Checkbox, ToggleGroup e os campos do wizard, 17.937 B / 6.446 B gzip): 93.462 B / 27.620 B gzip. Por isso saíram ~92 KB, e não só os 55 KB do relatório: o layout só usava essas primitivas dentro da gaveta.
- **A home perde menos** porque os filtros da Busca também usam Checkbox e ToggleGroup, que seguem no bundle dela.
- **A `/create` segue com a gaveta no bundle da página** (o `CreateShellClient` a importa direto; é o destino do fallback). Os +1,6 KB são o wrapper e o rearranjo dos chunks.
- **O byte não deixou de ser baixado:** a pré-carga do ocioso o traz logo depois da hidratação. O ganho é sair do caminho crítico (download, parse e execução antes da página ficar interativa) e não competir com o HTML e os chunks da própria página.

**Verificação:** `npx tsc --noEmit` limpo; `npx eslint .` sem erro (os 4 warnings de `<img>` são de arquivos que não mudaram); `vitest run` completo verde (node + ui, `TEST_DATABASE_URL` e `TEST_DATABASE_URL_UNPOOLED` inline no Postgres local da 5433); `npm run build` verde com o env da CI.

## 3. O que ler primeiro

1. `src/components/recipe/create-drawer-lazy.tsx` (o comentário do topo tem o desenho inteiro).
2. `src/components/site-header.tsx`: o `ctaButton`, o `onOpenChange` do menu mobile e o `<LazyCreateDrawer>` no fim.
3. `src/components/app-update-guard.tsx` e `src/lib/app-update-reload.ts` (`isChunkLoadError`).
4. `test/ui/create-drawer-lazy.test.tsx`.
5. `docs/adr/0028-sistema-de-notificacoes-caixa-in-app-e-atualizacao-graceful.md`, decisão 5-A e o adendo de 2026-10-14.

## 4. Princípios inegociáveis

- **A falha do chunk da gaveta é da gaveta.** A rejeição do `import()` é capturada no loader e vira navegação para `/create`; nunca chega ao `AppUpdateGuard` (nem como `unhandledrejection`, nem por error boundary).
- **Nada visível muda além da largura.** Gaveta pronta antes do clique (o caso normal): mesma árvore de antes, `CreateDrawer` montada fechada. Gaveta ainda chegando: o mesmo dialog, aberto um instante depois, com `aria-busy` no botão enquanto isso.
- **Fallback por navegação dura e com locale.** `location.assign(createPagePath(locale))`, nunca `router.push`: a navegação client-side de uma aba velha pediria chunks do deploy antigo.
- **Um `import()` por documento.** `preloadCreateDrawer` é idempotente; estado `failed` não tenta de novo.

## 5. Landmines

- **O guard e a falha do `<script>`.** Quando o chunk some (aba antiga, deploy novo), o navegador dispara `error` no `<script>` do chunk; o listener de captura do `AppUpdateGuard` o vê, mas é um `Event` de recurso, sem `error` nem `message`, e `isChunkLoadError` devolve `false`. O `ChunkLoadError` (o Turbopack de produção põe `name = 'ChunkLoadError'` no erro "Failed to load chunk … from module …") só existe na rejeição da promessa, que o loader captura. Conclusão: o guard não faz nada nesse caso, e a gaveta depende disso. **Se alguém fizer o guard reconhecer falha de `<script>`** (pelo `e.target`, por exemplo), ele recarregaria a página antes do fallback da gaveta. Nesse caso, ignore o chunk da gaveta no guard ou deixe a decisão para quem fez o `import()`. O teste "import que falha depois do clique" dispara as duas faces e quebra se o guard recarregar.
- **O ramo de captura do guard não pegava falha de `<script>` nem antes** (pelo mesmo motivo); o comentário dele dizia o contrário. Não mexi: mudar o guard muda o comportamento de toda falha de chunk. Fica anotado.
- **Primeiro chunk lazy do app.** Antes, toda falha de chunk vinha de navegação (o App Router faz navegação dura sozinho) ou do render (error boundary com reload). Agora há um chunk que um clique pede no meio de uma tela. Outro `import()` mid-screen deve seguir o mesmo padrão: capturar a rejeição e dar um fallback próprio, ou aceitar o reload do guard sabendo que a tela se perde.
- **O Turbopack guarda a promessa rejeitada do chunk.** Um segundo `import()` do mesmo módulo na mesma página falha na hora, por isso `failed` é definitivo até a próxima carga. Trocar o fallback por "tentar de novo" não funcionaria sem recarregar.
- **A aba antiga quase sempre já tem a gaveta.** A pré-carga do ocioso roda segundos depois da carga; uma aba aberta antes do deploy já tem o código na memória e abre a gaveta antiga (com as APIs do deploy novo), exatamente como antes do PR, quando o código vinha no bundle. O fallback só entra quando a pré-carga não chegou a rodar ou falhou (rede, bloqueio, aba que nunca ficou ociosa antes do deploy).
- **Foco ao fechar fica no `body`, como antes.** A gaveta é controlada por estado, sem `DialogTrigger`, e o Radix Dialog modal devolve o foco ao trigger dele (inexistente). O teste pina o comportamento de antes. Devolver o foco ao "Criar" (`onCloseAutoFocus`) é uma melhoria de a11y à parte: muda comportamento, então não entrou.
- **Pedido de abertura pendente atravessa navegação.** Se a pessoa clicar "Criar" com o chunk ainda chegando e navegar antes dele chegar, a gaveta abre na página nova (o header persiste). A janela é de milissegundos com a pré-carga; não tratei.
- **`useSyncExternalStore` com store de módulo:** testes que montam o header precisam de `vi.resetModules()` por teste (o estado fica de um teste para o outro). `test/ui/create-drawer-lazy.test.tsx` mostra o padrão, incluindo a "época" que impede um `import()` de um teste anterior de contar no seguinte.
- **Imagem dentro da gaveta:** se a Receita gerada aparecer com foto no resultado, a `<img>` usa o slot `detailHero` (handoff 69), que declara até 784 px, mais que os 512 px da gaveta. Errar o `sizes` para mais só baixa o derivado maior, como já era com 448 px; nenhum slot depende da largura da gaveta.
- Herdado: Postgres local na 5433 (`postgres:postgres`), URLs inline por comando, nunca exportadas. Um vitest por vez no cluster.

## 6. Critério de saída

- PR mergeado com painel de revisão limpo e "checks" verde.
- **Em produção, depois do deploy:**
  - **a gaveta abre:** numa página qualquer (ex.: `/pt-BR/privacidade`), espere 2–3 s e clique "Criar": a gaveta abre na hora, no método-picker, com 512 px num desktop; Escape fecha. No DevTools (Network, filtro JS), os três chunks da gaveta aparecem depois da carga da página, iniciados pelo runtime do Turbopack, e não na lista do HTML;
  - **clique antes da pré-carga:** com o throttling "Slow 4G" do DevTools, recarregue e clique "Criar" logo que a página aparecer: o botão fica `aria-busy` e a gaveta abre quando o chunk chega;
  - **fallback de aba antiga:** no DevTools, Network → botão direito no chunk grande da gaveta (o que contém `onBackHandlerChange`) → **Block request URL**; recarregue a página e clique "Criar": a URL vira `/pt-BR/create` (navegação dura) com a gaveta aberta, sem recarregar a página de origem antes e sem loop; o console mostra `[criar] a gaveta não carregou…`. Tire o bloqueio no fim. Isso reproduz o caso da aba antiga (o chunk que não existe mais responde 404, a mesma falha de `<script>`). Se não der para testar em produção, o raciocínio do §5 e o teste de UI cobrem o caminho;
  - **celular:** no menu hambúrguer, "Criar" fecha o menu e abre a gaveta em tela cheia, como antes.

## 7. Fora deste PR

- **Foco de volta ao "Criar" ao fechar a gaveta** (§5): hoje vai para o `body`, antes e depois.
- **O ramo de captura do `AppUpdateGuard`** não reconhece falha de `<script>` (§5). Se o dono quiser que ele reconheça, primeiro excluir o chunk da gaveta.
- **Follow-ups do handoff 69 §8, todos em aberto:** foto da avaliação exposta a SVG/TIFF caro rotulado `image/png`; `CRON_SECRET` comparado com `!==` nos quatro crons (trocar por `crypto.timingSafeEqual`); upload que já é WebP de até 1280 px reencodado no `detail`; capa do detalhe um pouco menos nítida em desktop retina (derivado de ~1600 px ou o original no `srcset`); `owns()` preso ao host do nosso store.

## 8. O que resta da auditoria (a ordem de 2026-10-13 está concluída)

Os seis passos da ordem aprovada em `docs/perf/2026-10-13-respostas.md` foram entregues (#570 a #575 e este PR). Fica:

1. **A, segundo passo (fora da ordem, decisão do dono):** ISR do detalhe público. Bloqueios no handoff 67 §5 (o detalhe lê `searchParams` e `headers()` para o ramo do dono).
2. **Em espera, até o catálogo crescer:** B (HNSW nos semelhantes e na busca semântica: hoje a varredura exata custa poucos ms; voltar quando a query passar de ~50 ms nos logs) e H passo 2 (paginar Minhas criações, Salvos e perfil; amarras no `respostas` §H: o seletor do Cardápio filtra o acervo inteiro no client, o cursor por `updated_at` e a contagem do perfil). Despensa: pré-filtro por palavras e nome traduzido gravado na escrita, se o acervo crescer (handoff 68).
3. **Opcional, se o dono quiser:** OG com um derivado JPEG de 1200 px (handoff 69 §1).
4. Os follow-ups do §7.
