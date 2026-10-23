# ADR-0048 — Captura de erros de servidor e cliente sem fornecedor externo

Status: aceito

Issue #590. Escolher um fornecedor (Sentry etc.) fica fora: entra no texto de privacidade e anda junto com a #471.

## Contexto

Até aqui um erro de produção só aparecia se alguém fosse caçar a mensagem crua nos logs da Vercel. Não havia `onRequestError`, e o erro de cliente (boundary `error.tsx`, hidratação, rejeição sem `catch`) morria no console do navegador de quem o viu. O root layout (`src/app/[locale]/layout.tsx`) nem tinha boundary próprio: um erro nele caía no `global-error` embutido do Next, tela crua em inglês.

O repo já tem um estilo de log operacional: `[tag]` e `chave=valor`, uma linha por desfecho, sem dado pessoal, do erro só o `name` (`[mail]`, `[account-purge]`, `[ai-models]`).

## Decisão

1. **Uma linha `[erro]` por erro, no log da própria Vercel.** Sem fornecedor, sem banco, sem tabela. Formato e campos em `src/domain/error-report.ts` (núcleo puro, edge-safe) e catalogados em `docs/observabilidade.md`.

2. **Servidor: `onRequestError` em `src/instrumentation.ts`, fora do ramo nodejs** (o hook vale em todo runtime). Linha em `console.error`:
   `[erro] origem=servidor rota=<routePath> metodo=<GET…|OUTRO> tipo=<render|route|action|proxy|-> fonte=<renderSource|-> [revalidacao=stale|on-demand] erro=<name> [codigo=<SQLSTATE/código>] digest=<digest|->`.
   - A rota é `context.routePath` (a DEFINIÇÃO, ex. `/[locale]/u/[handle]`, `/api/feed`). **Nunca** `request.path` (traz a query: o token do reset de senha) nem `request.headers` (cookie de sessão, IP).
   - **Sem mensagem.** O Next já loga mensagem e stack do mesmo erro; a nossa linha é o índice pesquisável, ligado a elas pelo `digest`.
   - `codigo=` só quando casa `^[A-Z0-9_]{2,32}$`, no erro ou na `cause` (o Drizzle embrulha o erro do driver). Regra: `code` de erro é constante de biblioteca e **nunca carrega dado de usuário** — quem criar erro próprio com `code` segue isso.
   - Síncrono e em `try/catch`: um erro no formatador vira `[erro] origem=servidor formato=falhou`, nunca um segundo erro no request.

3. **Cliente: relato para `POST /api/client-errors`, que só escreve a linha.** Linha em `console.warn` (no servidor):
   `[erro] origem=cliente rota=<forma da rota> tipo=<boundary|global|janela|promessa|hidratacao> erro=<name> digest=<digest|-> [msg="…"]`.
   - **Quem relata:** a boundary de `src/app/[locale]/error.tsx` (`boundary`) e a nova `src/app/global-error.tsx` (`global`) — erro pego por boundary explícito não vira evento de janela; e os listeners de `src/instrumentation-client.ts` (antes da hidratação): erro não pego (`janela`), rejeição sem `catch` (`promessa`) e os recuperáveis do React que o Next manda para `window.reportError` (`hidratacao` quando `isHydrationError` casa, o mesmo teste do guarda do E2E, só nos primeiros 1000 caracteres: a regex é quadrática num texto grande).
   - **Rota = só a forma:** sem query/hash, 1º segmento `[locale]` (ou `[sem-locale]`), os demais só se forem filho estático conhecido da árvore de `src/app/[locale]` (`CLIENT_ROUTE_TREE`, travada contra o disco por teste), senão `[param]`. Slug, handle e id nunca aparecem.
   - **Mensagem só sem digest** (com digest é a genérica do Next) e sanitizada: corte em 1000 antes das regex (todas lineares); `Minified React error #N` ⇒ `React #N`; controles, separadores Unicode, bidi e zero-width ⇒ espaço; `=` ⇒ `:` e `[erro]` ⇒ `(erro)` (a `msg` não forja `origem=servidor`, `tipo=…`, `digest=…` nem uma 2ª tag que casem as buscas por substring); texto entre aspas duplas e crases ⇒ `"…"`; aspas simples ⇒ `'…'`, exceto o identificador curto depois de `reading `/`setting `/`property ` (preserva `(reading 'title')`); URL e caminho (inclusive `./`, `../`, `~/`) ⇒ `<url>`; e-mail (Unicode: `maría@exemplo.com`, `joao@café.com.br`) e qualquer palavra com `@` (`maria@gmail`) ⇒ `<email>`; `@handle` solto ⇒ `<handle>`; UUID ⇒ `<id>`; sequência longa tipo token ⇒ `<token>`; número com ≥4 dígitos ⇒ `<num>`; ≤160 com `…`; impressa em JSON (uma linha).
   - **O servidor não confia no corpo:** re-valida o schema v1 (`{ v:1, tipo, rota, erro, msg?, digest? }`) e re-sanitiza todos os campos (a sanitização é idempotente).
   - **Regra de código:** não interpolar dado de usuário em `throw new Error(…)` no cliente. A sanitização é rede heurística, não contrato.

4. **Limites.** Navegador: dedup por impressão digital, 5 relatos por carga, 20 por sessão (o sessionStorage guarda só o contador). Endpoint: `Sec-Fetch-Site` presente e diferente de `same-origin` ⇒ 204 sem log; rajada de 5 requests a cada 10 s por IP, IPv6 pela /64 (`createIpBurstLimiter`, best-effort por instância, poda no máximo uma vez por janela e Map com teto; sem IP pula este passo); 60 LINHAS/min por instância — conta só a linha escrita, então request de lixo (400/413) não gasta o teto —, com UMA linha `[erro] origem=cliente limite=atingido` por janela; corpo ≤ 2 KB (`content-length` e leitura com teto, que cobre chunked); JSON inválido ou fora do schema ⇒ 400 `{ error: 'dados_invalidos' }`; nunca 500.
   - **Por que rajada e não 1/s por IP:** 1/s = 60/min, igual ao teto da instância — um IP sozinho a enchia. E a rajada legítima (boundary + rejeição no mesmo segundo, `#418` seguido de `#423`) perdia o 2º relato, que o navegador já contou nos tetos dele e nunca reenvia. 5/10 s cabe a rajada e fica bem abaixo do teto da instância.

5. **Transporte sem cookie e sem referrer.** `fetch` POST com `keepalive: true`, `credentials: 'omit'` e `referrerPolicy: 'no-referrer'`: o `Referer` same-origin levaria a URL INTEIRA, com query (`Referrer-Policy: strict-origin-when-cross-origin` no `next.config.ts`). `sendBeacon` foi descartado por não controlar o referrer. O relato **nunca** escreve no console do navegador e nunca lança. Só liga em produção.

6. **`src/app/global-error.tsx`** com `<html>`/`<body>` e CSS global próprios, fora do `LocaleProvider`: texto e `lang` do locale do 1º segmento do pathname (`useSyncExternalStore` com snapshot de servidor `DEFAULT_LOCALE`, porque o arquivo é pré-renderizado no build), `ThemeCookieSync` para o tema, "Tentar de novo" pelo `unstable_retry` do Next 16 (sem ele, recarrega). O conteúdo vive em `src/components/global-error-screen.tsx`, testável no jsdom.

7. **Erro de chunk velho não é relatado**: é atualização pós-deploy, e a boundary/o guard já recarregam (ADR-0028). Também ficam fora o ruído de rede (`Failed to fetch`, `NetworkError`, `Load failed`), `AbortError`, o loop do `ResizeObserver`, o `Script error.` opaco e erros vindos de outra origem ou de extensão.

8. **Nenhuma mudança em texto legal**: as duas linhas não carregam dado pessoal. O acesso ao endpoint fica no log de requisições da Vercel com IP e user-agent, como qualquer outra requisição ao app.

   > **Atualização 2026-10-22 (supera a decisão 8):** o sign-off interno (`docs/legal/parecer-interno-2026-10-22.md` §4, achado 7) pediu que os registros técnicos entrassem na política, e a Política de Privacidade v3 os descreve no item 3.7 (`privacidade.s37Valores` em `src/i18n/messages/`): legítimo interesse, campos mascarados, nenhum IP nem identificador de conta nas linhas que o app escreve, o IP do relato do navegador só em memória, até 30 dias na Vercel, e o aviso de que o log cru do Next pode trazer, em casos raros, um trecho do dado processado (achado 26). Daqui em diante, campo novo em log precisa caber no item 3.7, ou o mesmo PR muda a política (regra "Privacidade" do `CLAUDE.md`).

## Alternativas rejeitadas

- **Sentry/Highlight/Datadog agora.** Exige operador novo no texto de privacidade e na lista de prestadores (#471), e manda stack e contexto para fora. A linha estruturada resolve o "o erro aparece" sem isso.
- **Logar a mensagem do erro de servidor.** O Next já loga; repetir duplicaria qualquer PII que a mensagem tenha, agora num formato mais fácil de buscar.
- **`request.path` na linha do servidor.** Traz query string (token de reset de senha, termos de busca).
- **Gravar os relatos no banco.** Tabela nova, retenção nova, texto de privacidade novo, e escrita pública num endpoint sem sessão.
- **`navigator.sendBeacon`.** Não aceita `referrerPolicy`; mandaria a URL completa da página no `Referer`.

## Consequências e riscos

- **Retenção curta:** os logs de runtime da Vercel guardam pouco tempo (depende do plano). A linha serve para notar e investigar logo, não como histórico. Um log drain é o próximo passo se precisar de mais.
- **O log cru do Next continua:** mensagem e stack do erro de servidor seguem no log, como antes. Se um código interpolar PII numa mensagem de erro, ela já aparecia lá; esta mudança não piora nem resolve isso.
- **O mesmo digest pode gerar duas linhas de servidor** (o render RSC e o SSR do mesmo request reportam o mesmo erro). Para contar, agrupe por digest.
- **Sanitização heurística:** nome próprio solto numa mensagem (sem aspas, sem `@`) passa. Por isso a regra de código do item 3.
- **Erro recuperado na hidratação pode chegar com a mensagem da CAUSA** (o Next desembrulha `error.cause` antes do `reportError`), não com o `#418`; ainda assim passa pela mesma sanitização.
- **Rate limit em memória, por instância:** um burst distribuído passa; um cold start zera. É anti-flood do log, não quota.
- **Adblock pode bloquear `/api/client-errors`** (nomes com "error" às vezes entram em listas). O relato some em silêncio; não há retentativa.
- **`global-error` muda a UX** do erro no root layout: antes a tela embutida do Next, agora a tela calma do app no locale do caminho.
- **`instrumentation-client.ts` entra no bundle principal.** Pequeno, sem efeito fora de produção e em `try/catch`.
- Rota nova sob `src/app/[locale]` precisa entrar em `CLIENT_ROUTE_TREE`; o teste `test/ui/route-segments-allowlist.test.ts` reprova até entrar.
