import { APIError, betterAuth } from 'better-auth'
import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import { and, eq, lt, sql } from 'drizzle-orm'
import { after } from 'next/server'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, testUtils } from 'better-auth/plugins'
import { getDb, getMailer } from '@/server/deps'
import * as schema from '@/db/schema'
import { ac, roles } from '@/lib/auth-permissions'
import { DEFAULT_ROLE } from '@/domain/user'
import { isGoogleConfigured } from '@/server/auth/google'
import { generateUniqueHandle } from '@/server/handle'
import { buildResetPasswordEmail } from '@/server/auth/reset-password-email'
import { buildFinishAccountEmail, buildVerifyEmail } from '@/server/auth/verify-email-email'
import { assignNameHandle, isPendingHandle, pendingHandle } from '@/server/auth/pending-account'
import type { MailInput } from '@/server/mail/mailer'
import { getBaseUrlFromEnv } from '@/server/http/base-url'
import { safeInternalPath } from '@/domain/safe-redirect'
import { resolveLocale, type Locale } from '@/i18n/locale'
import { readLocaleCookie } from '@/i18n/cookie'
import { splitLocalePrefix } from '@/i18n/locale-path'

/**
 * Instância Better Auth (issue #5, ADR-0010/0011). Route handlers, NÃO Server Actions
 * (sem nextCookies). Node runtime. ids uuid gerados pelo Postgres (generateId:false +
 * uuid().defaultRandom()). Email+senha sempre; Google dormente sem creds (liga ao pôr
 * GOOGLE_CLIENT_ID/SECRET no .env.local). Soft-delete: só a coluna deletedAt; o gating
 * barra deletedAt != null.
 *
 * getAuth() é MEMOIZADA (E1): a instância só nasce na 1ª chamada, depois que setDb()
 * já rodou nos testes — nunca no module-load. NÃO exportar `const auth` (resolveria
 * getDb() no import, antes do setDb() do harness).
 *
 * ÚNICA instância (E2): testUtils entra condicionalmente na MESMA instância em
 * NODE_ENV==='test', garantindo o MESMO secret e config de adapter — getSession valida
 * cookies mintados por testUtils sem alinhar secret entre instâncias.
 */
// E4 — fail-closed: BETTER_AUTH_SECRET é OBRIGATÓRIA fora de teste. O DEFAULT_SECRET
// do Better Auth é público e a lib só lança sozinha em production; aqui falhamos cedo
// em qualquer ambiente não-teste (dev incluso).
const authSecret = process.env.BETTER_AUTH_SECRET
if (!authSecret && process.env.NODE_ENV !== 'test') {
  throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
}

const DROPPED_LOG_PREFIXES = ['Reset Password: User not found', 'Sign-up attempt for existing email']

/**
 * Log do Better Auth (#469). Descarta as linhas que carregam um email digitado por terceiro: o do reset sem conta
 * e (#470) o da tentativa de cadastro com email já existente — que, além de PII, registraria exatamente o fato
 * que a resposta do cadastro esconde. O resto sai como antes.
 * `message` NÃO é sempre string: a lib passa o próprio `Error` em alguns catches (list-sessions, link de
 * conta OAuth) — tratar como string lançaria TypeError dentro do catch e engoliria o erro original.
 */
export function authLog(level: 'debug' | 'info' | 'warn' | 'error', message: unknown, ...args: unknown[]): void {
  if (typeof message === 'string' && DROPPED_LOG_PREFIXES.some((p) => message.startsWith(p))) return
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (typeof message === 'string') out(`[Better Auth] ${message}`, ...args)
  else out('[Better Auth]', message, ...args)
}

/**
 * Teto de e-mails de conta por DESTINATÁRIO e a janela: no máx. 3 de cada tipo por conta a cada 15 min — `password`
 * (reset de #469 e "conclua seu cadastro" de #470, mesmo token) e `verify` (confirmação de #470).
 */
const ACCOUNT_EMAIL_MAX_PER_WINDOW = 3
const ACCOUNT_EMAIL_WINDOW_MS = 15 * 60 * 1000

/**
 * #469 (SEGURANÇA): sem `BETTER_AUTH_URL`, o Better Auth fixa a base na origem do 1º request da instância —
 * derivada do `Host`. O link do e-mail NUNCA pode herdar um host forjado (roubo do token), então trocamos a
 * origem pela base confiável de ENV (`BETTER_AUTH_URL` → `getBaseUrlFromEnv`: APP_URL / domínio de produção).
 */
function withTrustedOrigin(url: string): string {
  const u = new URL(url)
  return new URL(`${u.pathname}${u.search}`, process.env.BETTER_AUTH_URL || getBaseUrlFromEnv()).toString()
}

/** Link de confirmação vale 24h (casa a copy do e-mail). É um JWT sem estado: o teto abaixo conta envios. */
const VERIFY_EXPIRES_IN_S = 24 * 60 * 60

/**
 * Anti mail-bombing por DESTINATÁRIO (o rate limit do Better Auth é por IP e os pedidos aceitam qualquer email).
 * Cada envio deixa um MARCADOR em `verification` (`<kind>-email-sent:<userId>`, só o id — sem PII) que expira com
 * a janela; os vencidos da conta são apagados aqui mesmo. Devolve `false` quando a conta já recebeu o teto.
 * Contar-e-inserir sob um advisory lock DE TRANSAÇÃO por conta e tipo: pedidos paralelos se enfileiram e o teto
 * não estoura (nem sub-envia). `xact` (não de sessão) funciona atrás do pooler em modo transação.
 * Trade-off aceito: terceiros podem esgotar a cota da janela, mas os e-mails que ELES dispararam chegam à caixa
 * do dono com links válidos — o dono nunca fica sem um link utilizável.
 */
async function takeAccountEmailSlot(kind: 'password' | 'verify', userId: string): Promise<boolean> {
  const identifier = `${kind}-email-sent:${userId}`
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`)
    const now = new Date()
    await tx
      .delete(schema.verification)
      .where(and(eq(schema.verification.identifier, identifier), lt(schema.verification.expiresAt, now)))
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.verification)
      .where(eq(schema.verification.identifier, identifier))
    if (n >= ACCOUNT_EMAIL_MAX_PER_WINDOW) return false
    await tx
      .insert(schema.verification)
      .values({ identifier, value: userId, expiresAt: new Date(now.getTime() + ACCOUNT_EMAIL_WINDOW_MS) })
    return true
  })
}

/**
 * #470 (B3) — o gate só vê se a env EXISTE; chave inválida/remetente não verificado no Brevo fariam os e-mails de
 * conta sumirem calados. Cada envio recusado deixa UMA linha `warn` no log da função, sem PII (sem email/nome).
 */
async function sendAccountEmail(kind: 'reset' | 'verify' | 'finish', mail: MailInput): Promise<void> {
  const { sent } = await getMailer().sendAccountEmail(mail)
  if (!sent) console.warn(`[auth] e-mail de conta não enviado (${kind}): confira BREVO_API_KEY e o remetente no Brevo`)
}

// #470 — a cura do handle de espera roda em hook `after` de sessão/usuário; o better-auth re-executa o hook
// que rejeita e propaga o 2º erro pro endpoint (500 no login/confirmação). O handle nunca derruba entrar ou
// confirmar: falha vira um aviso (sem PII) e a próxima sessão tenta de novo.
async function healPendingHandle(run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (err) {
    console.warn(`[auth] cura do handle de espera falhou: ${err instanceof Error ? err.name : 'erro'}`)
  }
}

/**
 * #470 — idioma do e-mail de confirmação: `users.locale` (preferência salva) e, sem ela (conta recém-criada
 * ainda não tem), o cookie `locale` / Accept-Language do request que disparou o envio.
 */
function verifyEmailLocale(user: { locale?: string | null }, request?: Request): Locale {
  return resolveLocale({
    preferred: user.locale ?? readLocaleCookie(request?.headers.get('cookie') ?? ''),
    acceptLanguage: request?.headers.get('accept-language'),
  })
}

/**
 * Idioma do e-mail de senha: `users.locale`; sem ele, o locale do `redirectTo` que o pedido trouxe (a tela de
 * "esqueci a senha" e o reenvio de #470 mandam `/{locale}/reset-password`); por fim o request.
 */
function resetEmailLocale(user: { locale?: string | null }, url: string, request?: Request): Locale {
  if (user.locale) return verifyEmailLocale(user, request)
  const callback = new URL(url, 'http://localhost').searchParams.get('callbackURL') ?? ''
  const fromPath = splitLocalePrefix(callback).locale
  return fromPath ?? verifyEmailLocale(user, request)
}


/**
 * #470 — o link do Better Auth (`/api/auth/verify-email?token=…&callbackURL=<destino>`) passa a voltar pela
 * NOSSA tela `/{locale}/verify-email?returnTo=<destino>`: é ela que mostra "link inválido/expirado" (o Better
 * Auth anexa `&error=…` ao callbackURL) e manda o Usuário, já logado, ao destino. O destino passa pela guarda
 * anti open-redirect. Origem trocada pela confiável de ENV (`withTrustedOrigin`).
 */
function verifyEmailLink(url: string, locale: Locale): string {
  const u = new URL(url)
  const dest = safeInternalPath(u.searchParams.get('callbackURL'))
  u.searchParams.set('callbackURL', `/${locale}/verify-email?returnTo=${encodeURIComponent(dest)}`)
  return withTrustedOrigin(u.toString())
}

/**
 * #470 (anti-enumeração pelo CORPO): com a confirmação ligada o Better Auth já responde 200 `{ token: null, user }`
 * também para email existente, mas o `user` sintético sai só com os campos do schema (sem o `handle` gerado
 * pelo hook, `role`/`plan` null em vez dos defaults do banco, id base62 em vez de uuid) — distinguível do real.
 * A resposta do cadastro é reduzida a estes campos, iguais em forma nos dois casos (o id sintético é uuid, ver
 * `customSyntheticUser`).
 */
const SIGNUP_USER_FIELDS = ['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt'] as const

/**
 * #470 (B1/R1) — o link "conclua seu cadastro" para conta NÃO confirmada: é o token do reset de senha
 * (`requestPasswordReset` → `sendResetPassword`, que escolhe a copy e aplica o teto `password`). Concluir define a
 * senha de quem abriu o e-mail, derruba as sessões e confirma a conta (`onPasswordReset`) — a senha de quem
 * pré-registrou o email morre ali. Usado pelo reenvio público e pelo cadastro repetido de conta pendente.
 */
async function sendFinishAccountLink(email: string, locale: Locale): Promise<void> {
  await getAuth().api.requestPasswordReset({ body: { email, redirectTo: `/${locale}/reset-password` } })
}

function buildAuth() {
  // hasGoogle deriva da MESMA fonte que as pages de autenticação (isGoogleConfigured) —
  // o botão Google na UI e o provider no servidor nunca divergem. Lido aqui dentro de
  // buildAuth (deferido), não no module-load.
  const googleId = process.env.GOOGLE_CLIENT_ID
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET
  const hasGoogle = isGoogleConfigured()
  // #470 — GATE da confirmação de email: só é EXIGIDA quando o e-mail de conta pode de fato sair (Brevo com
  // chave + remetente, `canSendAccountEmail`). Sem canal de e-mail, exigir a confirmação trancaria TODA conta
  // nova de email+senha (o link nunca chegaria) — então o cadastro segue como antes de #470: loga direto e
  // responde 200 com token. Preço consciente: enquanto o Brevo não está configurado, o `/sign-up/email` ainda
  // enumera contas (422 para email existente); a correção liga sozinha quando a env entra (novo deploy — a
  // instância é memoizada, então o gate é lido uma vez por instância, aqui).
  const verifyEmail = getMailer().canSendAccountEmail()
  // #470 (R3): TUDO o que é específico da confirmação só entra na config com o gate ligado — desligado, a config é
  // a de antes de #470 (sem `emailVerification`: o `/send-verification-email` responde 400
  // VERIFICATION_EMAIL_NOT_ENABLED, sem marcador nem log; sem `onPasswordReset`/`onExistingUserSignUp`).
  // #470 (F1): o erro do login de conta não confirmada, reescrito para o 401 de credencial inválida.
  const INVALID_CREDENTIALS = { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL, // resolvido em runtime; opcional em dev
    secret: authSecret,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      // Mapeia o modelo `user` do Better Auth para nossa tabela `users` (C2).
      // As demais (session/account/verification) casam por nome (singular).
      schema: { ...schema, user: schema.users },
    }),
    advanced: {
      database: {
        // CRÍTICO (C1): pg adapter + generateId:false ⇒ Better Auth NÃO envia id;
        // o default uuid().defaultRandom() de cada PK preenche. Mantém users.id uuid,
        // coerente com recipe.owner_id e com as PKs uuid de session/account/verification.
        generateId: false,
      },
      // SEGURANÇA (hardening pós #449/#464): o rate-limiter do Better Auth chaveia pelo IP derivado por
      // `getIp`, cujo default é o 1º hop do `x-forwarded-for` — CONTROLADO pelo cliente na Vercel (a edge
      // appenda o IP real ao FIM). Isso torna a chave forjável e o teto contornável (brute-force de senha
      // ilimitado). Forçamos a derivação pelo `x-real-ip`, que a edge da Vercel seta e o cliente NÃO
      // sobrescreve. Mesma fonte confiável usada por `clientIpFromHeaders` (http/params.ts).
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
      // #469 (anti-enumeração por TEMPO): o e-mail de reset roda DEPOIS da resposta (`after` do Next), senão
      // conta existente responderia devagar (round-trip do Brevo) e inexistente, na hora. Fora de request
      // (scripts) `after` lança ⇒ a promise segue sozinha. Em teste, sem handler: o envio é aguardado e o
      // FakeMailer já tem o e-mail quando a resposta volta.
      ...(process.env.NODE_ENV === 'test'
        ? {}
        : {
            backgroundTasks: {
              handler: (task: Promise<unknown>) => {
                try {
                  after(task)
                } catch {
                  // fora de um request scope do Next: a promise já está rodando.
                }
              },
            },
          }),
    },
    // #469 (LGPD): o Better Auth loga em nível error o email digitado quando não há conta ("Reset Password:
    // User not found", { email }). Email de terceiro não vai pro log da função; o resto segue o default.
    logger: { log: authLog },
    session: {
      // cookieCache OFF (SEC-1, E5): o gating relê role/deletedAt VIVOS do DB a cada
      // request (requireSession barra deletedAt != null; requireRole usa role atual).
      // Com cache ligado, getSession serviria um snapshot stale do cookie — uma conta
      // soft-deletada ou rebaixada continuaria passando até o cache expirar. Explícito
      // aqui (não só por default implícito) para travar a invariante.
      cookieCache: { enabled: false },
    },
    // Rate limit PERSISTENTE (issue #449, SEC). O default do Better Auth é enabled em
    // produção mas com storage:'memory' — em Vercel serverless cada instância tem memória
    // própria e o estado zera no cold start, tornando o teto contornável com requisições
    // paralelas/instâncias frescas. storage:'database' compartilha o contador entre todas
    // as instâncias via a tabela `rate_limit` (schema.rateLimit). O adapter drizzle já está
    // montado. customRules endurece os caminhos sensíveis de autenticação: 5 tentativas /
    // 60s por IP (mais apertado que o default 100/60s), cobrindo login, cadastro e reset de
    // senha — brute-force de senha inviável mesmo com o scrypt. Wildcards verificados contra
    // o wildcardMatch do Better Auth (`/sign-in/*` casa /sign-in/email e /sign-in/social).
    rateLimit: {
      // Ligado em prod E dev; DESLIGADO em teste — o harness minta muitas sessões em
      // sequência e um contador compartilhado o derrubaria com falsos 429.
      enabled: process.env.NODE_ENV !== 'test',
      window: 60,
      max: 100,
      storage: 'database',
      customRules: {
        '/sign-in/*': { window: 60, max: 5 },
        '/sign-up/*': { window: 60, max: 5 },
        // Exatos: as rotas de reset não têm sub-segmento na submissão (o wildcard
        // `/reset-password/*` NÃO casaria o POST `/reset-password`).
        // Reset de senha é caminho SENSÍVEL: NÃO afrouxar acima do default 3/60 do Better Auth (hardening
        // pós-merge — antes estava 5/60, mais frouxo que o próprio default). 3 tentativas/60s por IP.
        // #469: o pedido de link é `/request-password-reset` no Better Auth 1.6 (`/forget-password` é o nome
        // antigo, mantido só por garantia caso a lib volte a expô-lo). Cada pedido dispara um e-mail real.
        '/request-password-reset': { window: 60, max: 3 },
        '/forget-password': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 3 },
        // #470: reenvio do link de confirmação — público, aceita qualquer email e dispara e-mail real.
        '/send-verification-email': { window: 60, max: 3 },
      },
    },
    emailAndPassword: {
      enabled: true,
      // #470 (anti-enumeração no cadastro), SÓ com e-mail de conta configurado (`verifyEmail`, gate acima): sem
      // conta confirmada não se entra. Isso também liga a resposta GENÉRICA do Better Auth no `/sign-up/email` —
      // email já cadastrado responde 200 igual a um novo (sem 422 USER_ALREADY_EXISTS), sem criar nada nem mexer
      // na conta existente. O cadastro NÃO loga: a sessão nasce ao abrir o link do e-mail
      // (`autoSignInAfterVerification`). Contas anteriores a #470 foram marcadas confirmadas pela migração 0067.
      requireEmailVerification: verifyEmail,
      ...(verifyEmail
        ? {
            // Forma do `user` sintético (email existente) = a do real: id uuid como o do Postgres. Os demais
            // campos são cortados pelo hook `after` do cadastro (SIGNUP_USER_FIELDS).
            customSyntheticUser: ({ coreFields }: { coreFields: Record<string, unknown> }) => ({
              ...coreFields,
              id: crypto.randomUUID(),
            }),
            // #470 (R1, pré-sequestro): cadastro com email JÁ cadastrado. Conta confirmada: nada sai (como
            // antes). Conta NÃO confirmada: a vítima que cadastra depois de um atacante recebe na hora o
            // "conclua seu cadastro" (link de senha) — é o e-mail que ela espera, e concluí-lo tira a conta do
            // atacante. A lib roda isto em background (`runInBackgroundOrAwait`), então a resposta e o tempo
            // não mudam; o teto `password` por conta vale (via `sendResetPassword`).
            onExistingUserSignUp: async (
              { user }: { user: { email: string; emailVerified: boolean; locale?: string | null } },
              request?: Request,
            ) => {
              if (user.emailVerified) return
              await sendFinishAccountLink(user.email, verifyEmailLocale(user, request))
            },
            // #470 (B1): o link de senha prova a posse da caixa — conta não confirmada passa a confirmada (e ganha
            // o handle do nome, F2). A senha trocada substitui a de quem a cadastrou, e as sessões caem (abaixo).
            onPasswordReset: async ({ user }: { user: { id: string; emailVerified: boolean } }) => {
              if (user.emailVerified) return
              await getDb().update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, user.id))
              await assignNameHandle(user.id)
            },
          }
        : {}),
      // Esqueci minha senha (#469). O Better Auth gera o token (tabela `verification`, uso único) e a rota
      // GET `/reset-password/:token` que redireciona pra nossa tela com `?token=`. Aqui só mandamos o link.
      // Conta soft-deletada NÃO recebe e-mail (o gating já a barra; um reset não pode reanimá-la). O
      // endpoint responde igual exista ou não a conta (sem enumeração pela resposta).
      sendResetPassword: async ({ user, url }, request) => {
        if ((user as { deletedAt?: Date | null }).deletedAt) return
        // Anti mail-bombing por DESTINATÁRIO (o rate limit é por IP): no máx. 3 e-mails de senha por conta na
        // janela (`takeAccountEmailSlot`). Protege a caixa do Usuário e a cota Brevo compartilhada com os
        // alertas do DPO.
        if (!(await takeAccountEmailSlot('password', user.id))) return
        const input = {
          to: user.email,
          name: user.name,
          locale: resetEmailLocale(user as { locale?: string | null }, url, request),
          url: withTrustedOrigin(url),
        }
        // #470 (B1): conta ainda NÃO confirmada (com a confirmação ligada) recebe o "conclua seu cadastro: crie
        // sua senha" — mesmo token/rota do reset; concluir troca a senha, derruba sessões e confirma o email
        // (`onPasswordReset`).
        if (verifyEmail && !user.emailVerified) await sendAccountEmail('finish', buildFinishAccountEmail(input))
        else await sendAccountEmail('reset', buildResetPasswordEmail(input))
      },
      resetPasswordTokenExpiresIn: 60 * 60, // 1h — casa a copy do e-mail
      // Quem redefine a senha por suspeita de invasão derruba as sessões abertas (inclusive a do invasor).
      revokeSessionsOnPasswordReset: true,
    },
    // #470 — confirmação de e-mail (só com o gate ligado, R3). O Better Auth manda o link no cadastro
    // (`sendOnSignUp` segue o requireEmailVerification) e no reenvio (`/send-verification-email`, que responde
    // igual exista ou não a conta). Abrir o link confirma e JÁ LOGA (`autoSignInAfterVerification`).
    ...(verifyEmail
      ? {
          emailVerification: {
            // #470 (R1): login de conta não confirmada NÃO manda e-mail. Com senha certa ele mandaria o link
            // de confirmação simples — e quem pré-registrou o email da vítima (com a senha dele) o dispararia
            // logo depois do cadastro dela, que espera exatamente esse e-mail; clicar confirmaria a conta DO
            // ATACANTE. O login só responde o 401 de sempre (F1); a tela oferece o reenvio, que manda o link
            // de senha ("conclua seu cadastro").
            sendOnSignIn: false,
            autoSignInAfterVerification: true,
            expiresIn: VERIFY_EXPIRES_IN_S,
            sendVerificationEmail: async (
              {
                user,
                url,
              }: {
                user: { id: string; email: string; name: string; locale?: string | null; deletedAt?: Date | null }
                url: string
              },
              request?: Request,
            ) => {
              // Conta soft-deletada não recebe (o gating já a barra).
              if (user.deletedAt) return
              const locale = verifyEmailLocale(user, request)
              // #470 (B1, pré-sequestro): o reenvio PÚBLICO (sem sessão) aceita qualquer email. Se ele mandasse
              // o link de confirmação, a vítima que cadastrou depois de um atacante apertaria "Reenviar",
              // confirmaria a conta DO ATACANTE e entraria nela — com a senha que o atacante conhece. Então o
              // reenvio público manda o link de SENHA ("conclua seu cadastro"). O link de confirmação simples
              // fica para o cadastro (quem o disparou escolheu a senha). A resposta do endpoint é a mesma nos
              // três casos (não depende deste callback).
              if (request && new URL(request.url, 'http://localhost').pathname.endsWith('/send-verification-email')) {
                const signedIn = await getAuth().api.getSession({ headers: request.headers })
                if (!signedIn) {
                  await sendFinishAccountLink(user.email, locale)
                  return
                }
              }
              if (!(await takeAccountEmailSlot('verify', user.id))) return
              await sendAccountEmail(
                'verify',
                buildVerifyEmail({ to: user.email, name: user.name, locale, url: verifyEmailLink(url, locale) }),
              )
            },
          },
        }
      : {}),
    // #470 (F3, pré-sequestro via Google): SEM vínculo implícito conta↔Google por email. A migração 0067 marcou
    // como confirmadas contas cujo email ninguém provou; com o default (vincula quando o email local está
    // confirmado), quem cadastrou o email de outra pessoa ganharia a conta Google dela no 1º "Continuar com o
    // Google". Quem entrou pelo Google continua entrando (o vínculo é achado pelo accountId); conta de
    // email+senha que tenta o Google recebe o mesmo "account not linked" de hoje.
    account: { accountLinking: { disableImplicitLinking: true } },
    hooks: {
      // #470 — resposta do cadastro com a MESMA forma exista ou não a conta (ver SIGNUP_USER_FIELDS). Erros
      // (400 de validação etc.) passam intactos: não dependem da conta. Só com o gate ligado: desligado, o
      // cadastro responde como antes de #470 (token da sessão + user completo) e o 422 já distingue a conta —
      // cortar o corpo ali não esconderia nada e apagaria o `token` que a UI usa para saber que já entrou.
      //
      // #470 (F1) — login: com a confirmação ligada, `EMAIL_NOT_VERIFIED` (403, só com a senha CERTA) viraria
      // oráculo — cadastrar X com a senha P (sempre 200) e entrar com X/P dá 403 se X era novo e 401 se X já
      // existia. Reescrito para o MESMO 401 de credencial inválida (status, corpo e headers). O link de
      // confirmação NÃO sai no login (R1, `sendOnSignIn: false`); os dois caminhos passam pelo password.verify.
      after: createAuthMiddleware(async (ctx) => {
        if (!verifyEmail) return
        if (ctx.path === '/sign-in/email') {
          const err = ctx.context.returned
          if (!isAPIError(err) || (err.body as { code?: string } | undefined)?.code !== 'EMAIL_NOT_VERIFIED') return
          // Via HTTP, lançar outro APIError não basta: o dispatch do Better Auth mantém o STATUS do erro original
          // (403) ao serializar. Devolvemos a Response pronta, idêntica à que o 401 natural gera (corpo
          // `{ message, code }`, statusText `UNAUTHORIZED`, JSON). Em chamada de servidor (`api.signInEmail`,
          // sem request) o APIError lançado já sai com 401.
          if (!ctx.request) throw APIError.from('UNAUTHORIZED', INVALID_CREDENTIALS)
          return new Response(JSON.stringify(INVALID_CREDENTIALS), {
            status: 401,
            statusText: 'UNAUTHORIZED',
            headers: { 'content-type': 'application/json' },
          })
        }
        if (ctx.path !== '/sign-up/email') return
        const out = ctx.context.returned as { user?: Record<string, unknown> } | undefined
        if (!out || typeof out !== 'object' || !out.user || typeof out.user !== 'object') return
        const user = Object.fromEntries(SIGNUP_USER_FIELDS.map((k) => [k, out.user![k] ?? null]))
        return ctx.json({ token: null, user })
      }),
    },
    socialProviders: hasGoogle
      ? { google: { clientId: googleId!, clientSecret: googleSecret! } }
      : {},
    user: {
      modelName: 'users',
      additionalFields: {
        // role é do plugin admin — NÃO declarar aqui.
        locale: { type: 'string', required: false, input: false },
        // Plano comercial (#466, scaffold flag-off). input:false: o plano NUNCA vem do cliente (muda por
        // billing na Fase 2), só é LIDO na sessão p/ a resolução de teto considerar `plan` além de `role`.
        plan: { type: 'string', required: false, input: false },
        deletedAt: { type: 'date', required: false, input: false },
        // handle é gerado pelo databaseHooks.user.create.before (não vem do input do signup);
        // input:false impede que o cliente o forneça/sobrescreva na criação da conta (#128).
        handle: { type: 'string', required: false, input: false },
      },
    },
    // #470 — CURA do handle de espera, registrada SEMPRE (com ou sem o gate): a conta que passa a ser de alguém
    // perde o `pendente-<16>` e ganha o handle do nome. Cobre o link de confirmação (inclusive aberto depois de o
    // gate desligar), o admin marcando o email como confirmado e o gate desligado depois do cadastro (a conta
    // entra direto). O reset de senha cura em `onPasswordReset`. Tudo idempotente e só com o handle de espera
    // EXATO (`isPendingHandle`).
    databaseHooks: {
      session: {
        create: {
          // Sessão nova de conta com handle de espera: com o gate ligado só cura se confirmada (conta não
          // confirmada nem entra, mas por garantia); desligado, a conta é normal e cura já.
          after: async (session) => {
            await healPendingHandle(() => assignNameHandle(session.userId, { requireVerified: verifyEmail }))
          },
        },
      },
      user: {
        update: {
          // Email confirmado (link, admin…) ⇒ cura. Sem `handle` no retorno, `assignNameHandle` relê a linha.
          after: async (user) => {
            // `user` vem `undefined` quando o UPDATE não casou linha (conta apagada no meio do caminho).
            const u = user as { id: string; emailVerified?: boolean; handle?: string | null } | undefined
            if (!u?.emailVerified) return
            if (u.handle !== undefined && !isPendingHandle(u.handle)) return
            await healPendingHandle(() => assignNameHandle(u.id))
          },
        },
        create: {
          // #128 — todo Usuário nasce com um handle único derivado do `name` (com
          // desambiguação). Roda ANTES do INSERT: injetamos `handle` no `data`. A unicidade
          // é consultada aqui (best-effort) e travada pela UNIQUE `users_handle_uq` no banco.
          // `name` sempre presente (email+senha e Google enviam name); fallback 'user' no
          // domínio cobre nomes vazios/só-símbolos.
          //
          // #470 (F2): com a confirmação ligada, o cadastro de EMAIL+SENHA (`/sign-up/email`, conta nasce não
          // confirmada) ganha handle de ESPERA aleatório — o derivado do nome escolhido por quem cadastra seria
          // oráculo de enumeração (`-2`, `/u/<handle>`). O handle do nome chega quando o email é provado. SÓ esse
          // caminho: conta criada pelo Google (mesmo com `email_verified=false` do provedor), pelo admin etc. tem
          // sessão/dono e ganha o handle do nome direto. `ctx` é o contexto do endpoint que está criando (null
          // fora de endpoint).
          before: async (user, ctx) => {
            const credentialSignUp = ctx?.path === '/sign-up/email'
            const handle =
              verifyEmail && credentialSignUp && !user.emailVerified
                ? pendingHandle()
                : await generateUniqueHandle((user.name as string | undefined) ?? '')
            return { data: { ...user, handle } }
          },
        },
      },
    },
    plugins: [
      admin({
        ac,
        roles,
        adminRoles: ['admin'],
        // OBRIGATÓRIO (E7): o default do plugin admin é 'user', que NÃO existe no
        // nosso pgEnum role (usuario/curador/admin). Sem este override, todo signup
        // tentaria gravar role='user' e estouraria 22P02/23514 no INSERT.
        // DEFAULT_ROLE de @/domain/user é a fonte única (QM-4) — não hardcodar 'usuario'.
        defaultRole: DEFAULT_ROLE,
      }),
      // E2 — testUtils SÓ em teste, na MESMA instância (mesmo secret/adapter).
      ...(process.env.NODE_ENV === 'test' ? [testUtils()] : []),
    ],
  })
}

// _auth herda o tipo PRECISO inferido de buildAuth() (não o genérico
// `ReturnType<typeof betterAuth>`, que colidiria com `Auth<BetterAuthOptions>` e
// quebraria a inferência de `.api`). Memoização: a instância só nasce na 1ª chamada.
let _auth: ReturnType<typeof buildAuth> | null = null

export function getAuth(): ReturnType<typeof buildAuth> {
  return (_auth ??= buildAuth())
}

/**
 * #470 — a confirmação de email está EXIGIDA nesta instância? (o gate lido em `buildAuth`). Consultado pelas
 * superfícies públicas de Usuário (escondem conta não confirmada) e pela tela de entrar (dica de confirmação).
 */
export function emailVerificationRequired(): boolean {
  return getAuth().options.emailAndPassword?.requireEmailVerification === true
}

/**
 * SÓ TESTE: descarta a instância memoizada para a próxima `getAuth()` reler a config — hoje, o gate da
 * confirmação de email (#470), que depende do mailer injetado (`setMailer`) no momento da construção.
 */
export function resetAuthForTests(): void {
  _auth = null
}

export type Auth = ReturnType<typeof getAuth>
