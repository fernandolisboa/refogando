import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { and, eq, gt, like, lt, sql } from 'drizzle-orm'
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
import { buildVerifyEmail } from '@/server/auth/verify-email-email'
import { getBaseUrlFromEnv } from '@/server/http/base-url'
import { safeInternalPath } from '@/domain/safe-redirect'
import { resolveLocale, type Locale } from '@/i18n/locale'
import { readLocaleCookie } from '@/i18n/cookie'

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

/** #469 — teto de e-mails de reset por conta e a janela (ver `sendResetPassword`). */
const RESET_MAX_PER_WINDOW = 3
const RESET_WINDOW_MS = 15 * 60 * 1000

/** Quantos pedidos de reset (tokens `reset-password:*`) esta conta fez na janela. */
async function recentResetRequests(userId: string): Promise<number> {
  const [{ n }] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.verification)
    .where(
      and(
        eq(schema.verification.value, userId),
        like(schema.verification.identifier, 'reset-password:%'),
        gt(schema.verification.createdAt, new Date(Date.now() - RESET_WINDOW_MS)),
      ),
    )
  return n
}

/**
 * #469 (SEGURANÇA): sem `BETTER_AUTH_URL`, o Better Auth fixa a base na origem do 1º request da instância —
 * derivada do `Host`. O link do e-mail NUNCA pode herdar um host forjado (roubo do token), então trocamos a
 * origem pela base confiável de ENV (`BETTER_AUTH_URL` → `getBaseUrlFromEnv`: APP_URL / domínio de produção).
 */
function withTrustedOrigin(url: string): string {
  const u = new URL(url)
  return new URL(`${u.pathname}${u.search}`, process.env.BETTER_AUTH_URL || getBaseUrlFromEnv()).toString()
}

/** #470 — teto de e-mails de confirmação por conta e a janela (ver `sendVerificationEmail`). */
const VERIFY_MAX_PER_WINDOW = 3
const VERIFY_WINDOW_MS = 15 * 60 * 1000
/** Link de confirmação vale 24h (casa a copy do e-mail). É um JWT sem estado: o teto acima conta envios. */
const VERIFY_EXPIRES_IN_S = 24 * 60 * 60

/**
 * #470 — anti mail-bombing por DESTINATÁRIO do e-mail de confirmação (o rate limit do Better Auth é por IP e o
 * reenvio aceita qualquer email). O token de confirmação é um JWT sem linha no banco, então o envio deixa um
 * MARCADOR em `verification` (`verify-email-sent:<userId>`, só o id — sem PII) que expira com a janela; os
 * vencidos da conta são apagados aqui mesmo. Devolve `false` quando a conta já recebeu o teto na janela.
 */
async function takeVerifyEmailSlot(userId: string): Promise<boolean> {
  const db = getDb()
  const identifier = `verify-email-sent:${userId}`
  const now = new Date()
  await db
    .delete(schema.verification)
    .where(and(eq(schema.verification.identifier, identifier), lt(schema.verification.expiresAt, now)))
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, identifier))
  if (n >= VERIFY_MAX_PER_WINDOW) return false
  await db
    .insert(schema.verification)
    .values({ identifier, value: userId, expiresAt: new Date(now.getTime() + VERIFY_WINDOW_MS) })
  return true
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
      // Forma do `user` sintético (email existente) = a do real: id uuid como o do Postgres. Os demais campos
      // são cortados pelo hook `after` do cadastro (SIGNUP_USER_FIELDS). Inerte com o gate desligado (a lib só
      // monta o sintético na resposta genérica).
      customSyntheticUser: ({ coreFields }) => ({ ...coreFields, id: crypto.randomUUID() }),
      // Esqueci minha senha (#469). O Better Auth gera o token (tabela `verification`, uso único) e a rota
      // GET `/reset-password/:token` que redireciona pra nossa tela com `?token=`. Aqui só mandamos o link.
      // Conta soft-deletada NÃO recebe e-mail (o gating já a barra; um reset não pode reanimá-la). O
      // endpoint responde igual exista ou não a conta (sem enumeração pela resposta).
      sendResetPassword: async ({ user, url }) => {
        if ((user as { deletedAt?: Date | null }).deletedAt) return
        // Anti mail-bombing por DESTINATÁRIO (o rate limit é por IP): no máx. RESET_MAX_PER_WINDOW e-mails por
        // conta na janela. Protege a caixa do Usuário e a cota Brevo compartilhada com os alertas do DPO. O
        // token do pedido atual já foi gravado quando este callback roda, então ele entra na contagem.
        // Trade-off aceito: terceiros podem esgotar a cota da janela, mas os e-mails que ELES dispararam chegam
        // à caixa do dono com links válidos por 1h — o dono nunca fica sem um link utilizável.
        if ((await recentResetRequests(user.id)) > RESET_MAX_PER_WINDOW) return
        await getMailer().sendAccountEmail(
          buildResetPasswordEmail({
            to: user.email,
            name: user.name,
            locale: (user as { locale?: string | null }).locale,
            url: withTrustedOrigin(url),
          }),
        )
      },
      resetPasswordTokenExpiresIn: 60 * 60, // 1h — casa a copy do e-mail
      // Quem redefine a senha por suspeita de invasão derruba as sessões abertas (inclusive a do invasor).
      revokeSessionsOnPasswordReset: true,
    },
    // #470 — confirmação de e-mail. O Better Auth manda o link no cadastro (`sendOnSignUp` segue o
    // requireEmailVerification), a cada login com senha certa de conta não confirmada (`sendOnSignIn`, resposta
    // 403 EMAIL_NOT_VERIFIED) e no reenvio público (`/send-verification-email`, que responde igual exista ou
    // não a conta). Abrir o link confirma e JÁ LOGA (`autoSignInAfterVerification`).
    emailVerification: {
      // Com o gate desligado o login não exige confirmação e não há o que reenviar (o `sendOnSignUp` segue o
      // requireEmailVerification, então também desliga).
      sendOnSignIn: verifyEmail,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_EXPIRES_IN_S,
      sendVerificationEmail: async ({ user, url }, request) => {
        // Conta soft-deletada não recebe (o gating já a barra); teto por destinatário como no reset.
        if ((user as { deletedAt?: Date | null }).deletedAt) return
        if (!(await takeVerifyEmailSlot(user.id))) return
        const locale = verifyEmailLocale(user as { locale?: string | null }, request)
        await getMailer().sendAccountEmail(
          buildVerifyEmail({ to: user.email, name: user.name, locale, url: verifyEmailLink(url, locale) }),
        )
      },
    },
    hooks: {
      // #470 — resposta do cadastro com a MESMA forma exista ou não a conta (ver SIGNUP_USER_FIELDS). Erros
      // (400 de validação etc.) passam intactos: não dependem da conta. Só com o gate ligado: desligado, o
      // cadastro responde como antes de #470 (token da sessão + user completo) e o 422 já distingue a conta —
      // cortar o corpo ali não esconderia nada e apagaria o `token` que a UI usa para saber que já entrou.
      after: createAuthMiddleware(async (ctx) => {
        if (!verifyEmail || ctx.path !== '/sign-up/email') return
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
    databaseHooks: {
      user: {
        create: {
          // #128 — todo Usuário nasce com um handle único derivado do `name` (com
          // desambiguação). Roda ANTES do INSERT: injetamos `handle` no `data`. A unicidade
          // é consultada aqui (best-effort) e travada pela UNIQUE `users_handle_uq` no banco.
          // `name` sempre presente (email+senha e Google enviam name); fallback 'user' no
          // domínio cobre nomes vazios/só-símbolos.
          before: async (user) => {
            const handle = await generateUniqueHandle((user.name as string | undefined) ?? '')
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
 * SÓ TESTE: descarta a instância memoizada para a próxima `getAuth()` reler a config — hoje, o gate da
 * confirmação de email (#470), que depende do mailer injetado (`setMailer`) no momento da construção.
 */
export function resetAuthForTests(): void {
  _auth = null
}

export type Auth = ReturnType<typeof getAuth>
