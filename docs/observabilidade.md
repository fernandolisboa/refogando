# Observabilidade — catálogo das linhas de log

O app não tem fornecedor de observabilidade (ADR-0048). O que existe são linhas curtas no log de runtime da Vercel, cada uma com uma tag `[x]` no começo e, nas mais novas, campos `chave=valor`. Nenhuma linha catalogada aqui carrega dado pessoal (e-mail, nome, handle, id de usuário, IP, cookie, query string); a exceção conhecida é o log CRU que o Next escreve por conta própria (abaixo).

## Como buscar

- **Painel:** Vercel → projeto → **Logs** (runtime). Busque pelo texto da tag (`[erro]`, `[mail]`…) e, se quiser, filtre pelo nível (`error`/`warning`/`info`). A busca é por substring: `origem=cliente`, `tipo=hidratacao`, `rota=/[locale]/recipes` funcionam.
- **CLI:** `vercel logs <url-do-deploy>` mostra o log ao vivo de um deploy; filtre com `grep '\[erro\]'`.
- **Retenção curta.** O log de runtime da Vercel guarda pouco tempo (depende do plano). Estas linhas servem para notar e investigar logo, não como histórico.

## `[erro]` — erros de servidor e de cliente (#590, ADR-0048)

### `[erro] origem=servidor` — `console.error`

Uma linha por erro que o Next entrega ao `onRequestError` (`src/instrumentation.ts`), em qualquer runtime.

```
[erro] origem=servidor rota=/[locale]/recipes/[id] metodo=GET tipo=render fonte=react-server-components erro=Error digest=2968751377
[erro] origem=servidor rota=/api/u/[handle] metodo=GET tipo=route fonte=- erro=DrizzleQueryError codigo=23505 digest=-
```

| Campo | Valor |
|---|---|
| `rota` | a DEFINIÇÃO da rota (`context.routePath`), sem grupo: `/[locale]/recipes/[id]`, `/[locale]/admin`, `/api/feed`. Nunca a URL pedida. |
| `metodo` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` ou `OUTRO`. |
| `tipo` | `render` (página), `route` (route handler), `action` (server action), `proxy`, ou `-`. |
| `fonte` | `server-rendering`, `react-server-components`, `react-server-components-payload` ou `-`. |
| `revalidacao` | só quando o erro aconteceu numa revalidação: `stale` ou `on-demand`. |
| `erro` | o `name` do erro (`TypeError`, `DrizzleQueryError`); valor lançado que não é erro sai como o `typeof` (`string`). |
| `codigo` | só quando existe e é curto: SQLSTATE do Postgres (`23505` = unique, `40P01` = deadlock…) ou código do Node (`ECONNREFUSED`), no erro ou na `cause`. |
| `digest` | o digest do Next (`\d+` ou `\d+@E\d+`), ou `-` (route handler não tem). |

**Achar a stack:** busque o valor do `digest` no mesmo log. O Next escreve, junto, a mensagem e a stack do mesmo erro (é o log cru dele; pode conter o que o código pôs na mensagem). Sem digest, olhe as linhas vizinhas no mesmo request.

**O mesmo digest pode aparecer em duas linhas** (o render RSC e o SSR do mesmo request reportam o mesmo erro). Para contar erros, agrupe por digest.

**A resposta pode ter saído 200:** numa página com streaming (o grupo `(com-carregamento)` tem `loading.tsx`), o erro acontece depois do shell enviado; a linha sai do mesmo jeito.

`notFound()`, `redirect()` e o bailout de render dinâmico não geram linha (o Next filtra). Se o próprio formatador falhar, sai `[erro] origem=servidor formato=falhou`.

### `[erro] origem=cliente` — `console.warn`

Um relato do navegador recebido por `POST /api/client-errors` (`src/server/http/client-error-intake.ts`).

```
[erro] origem=cliente rota=/[locale]/recipes/[param] tipo=hidratacao erro=Error digest=- msg="React #418"
[erro] origem=cliente rota=/[locale]/me tipo=boundary erro=Error digest=2738485511
```

| Campo | Valor |
|---|---|
| `rota` | só a FORMA da página: `[locale]` (ou `[sem-locale]`), os segmentos estáticos do app e `[param]` no lugar de slug, handle e id. Sem query. |
| `tipo` | `boundary` (`src/app/[locale]/error.tsx`), `global` (`src/app/global-error.tsx`, erro no root layout), `janela` (erro não pego), `promessa` (rejeição sem `catch`), `hidratacao` (erro de hidratação do React). |
| `erro` | o `name` do erro no navegador. |
| `digest` | presente quando o erro veio de um Server Component: busque o mesmo digest em `origem=servidor` para achar a stack. |
| `msg` | só sem digest. Mensagem sanitizada, em JSON, ≤160: aspas viram `"…"`/`'…'` (menos `(reading 'title')`), URL/caminho `<url>`, e-mail e palavra com `@` `<email>`, `@handle` solto `<handle>`, UUID `<id>`, token `<token>`, número longo `<num>`, `Minified React error #N` vira `React #N` (decodifique em `react.dev/errors/N`). `=` vira `:` e `[erro]` vira `(erro)`: a `msg` nunca casa `origem=servidor`, `tipo=…` ou `digest=…` numa busca por substring. |

Um erro de hidratação recuperado pode chegar com a mensagem da CAUSA (o Next desembrulha `error.cause`), não com o `#418`.

Não viram relato: erro de chunk velho pós-deploy (é atualização; a página recarrega), falha de rede (`Failed to fetch`, `NetworkError`, `Load failed`), `AbortError`, o loop do `ResizeObserver`, `Script error.` e erros de script de outra origem ou de extensão. O navegador manda no máximo 5 relatos por carga de página e 20 por sessão; o endpoint aceita uma rajada de 5 requests a cada 10 s por IP (IPv6 pela /64). Corpo inválido ⇒ 400 `{ error: 'dados_invalidos' }`, sem linha.

### `[erro] origem=cliente limite=atingido` — `console.warn`

O endpoint passou de 60 linhas de relato no minuto nesta instância (conta só relato válido escrito; request inválido não gasta). Sai uma vez por janela de 1 minuto; o resto da janela é descartado em silêncio (429). Se aparecer com frequência, algo está quebrando para muita gente ao mesmo tempo — ou alguém está martelando o endpoint.

## Outras tags

| Tag | Onde | Nível | O que diz |
|---|---|---|---|
| `[mail]` | `src/server/mail/mailer.ts` | info/warn | `envio desligado (<tipo>): falta …`, `Resend aceitou o envio (<tipo>)`, `Resend recusou o envio (<tipo>): HTTP <status>`, `falha ao chamar o Resend (<tipo>): <nome do erro>`. |
| `[auth]` | `src/lib/auth.ts` | warn | `e-mail de conta não enviado (<reset\|verify\|finish>)`; `<etapa> falhou: <nome do erro>` (limpeza pós-cadastro). |
| `[account-purge]` | `src/app/api/cron/account-purge/route.ts` | info/warn/error | `passada concluída: <contagens>` ou `passada com falha`; `<etapa> falhou: <nome do erro>`. |
| `[ai-models]` | `src/app/api/cron/ai-models/route.ts`, `src/server/claude/model-auto-upgrade.ts` | info/warn | passada do cron (`passada concluída: <contagens>`), troca de versão (`<tarefa>: A → B (…)`), modelo sem preço, recusas e Models API fora. |
| `[image-derivatives]` | `src/app/api/cron/image-derivatives/route.ts`, `src/server/images/derivatives-backfill.ts` | info/warn | passada do cron de derivados; `original ilegível: <nome do erro>`. |
| `[imagens]` | `src/server/images/image-derivatives.ts` | warn | `derivados não gerados (<etapa>): <motivo ou nome do erro>`. |
| `[image-scene]` | `src/server/images/image-scene.ts` | info/warn | diretor de arte: `diretor <ok\|prazo\|falhou>: registro=… fonte=… recipe=<id da Receita> modelo=… in=… out=… ms=…`; `diretor lançou, seguindo com as regras: <mensagem>`. |
| `[generations]` | `src/app/api/generations/route.ts` | error | geração ou lote de variações inválido (→ 502), com os motivos da classificação. |
| `[cache-tags]` | `src/server/cache-tags.ts` | warn | falha ao expirar uma tag de cache; leva o objeto do erro. |
| `[notification]` | `src/server/notification.ts` | error | emissão de notificação falhou (engolida); leva o objeto do erro. |
| `[home]` | `src/app/[locale]/(com-carregamento)/page.tsx` | warn | config da descoberta na web ilegível; gatilhos escondidos; leva o objeto do erro. |
| `[e2e]` | `src/instrumentation.ts`, `src/server/e2e/fetch-guard.ts` | warn/error | só no harness do E2E: `MODO FAKE ATIVO` e `fetch RECUSADO para fora de loopback`. Em produção, nunca. |

`[cache-tags]`, `[notification]` e `[home]` passam o objeto do erro inteiro ao console (mensagem e stack), anteriores ao padrão "só o nome".

No navegador (não chegam ao log da Vercel): `[criar]` (`src/components/recipe/create-drawer-lazy.tsx`, a gaveta não carregou) e `[conversation]` (`src/hooks/use-conversation-chat.ts`, linha NDJSON malformada).

## Linha nova

- Comece com a tag entre colchetes; prefira `chave=valor` com chaves ASCII.
- Do erro, só o `name` (e, se for o caso, um código curto de biblioteca). Nunca mensagem de erro que possa ter dado de usuário, corpo, query, cookie, e-mail, nome, handle ou IP.
- Uma linha por desfecho. Registre a tag aqui.
