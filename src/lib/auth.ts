import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, testUtils } from 'better-auth/plugins'
import { getDb, getMailer } from '@/server/deps'
import * as schema from '@/db/schema'
import { ac, roles } from '@/lib/auth-permissions'
import { DEFAULT_ROLE } from '@/domain/user'
import { isGoogleConfigured } from '@/server/auth/google'
import { generateUniqueHandle } from '@/server/handle'
import { buildResetPasswordEmail } from '@/server/auth/reset-password-email'

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

function buildAuth() {
  // hasGoogle deriva da MESMA fonte que as pages de autenticação (isGoogleConfigured) —
  // o botão Google na UI e o provider no servidor nunca divergem. Lido aqui dentro de
  // buildAuth (deferido), não no module-load.
  const googleId = process.env.GOOGLE_CLIENT_ID
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET
  const hasGoogle = isGoogleConfigured()
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
    },
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
      },
    },
    emailAndPassword: {
      enabled: true, // D3 — sem requireEmailVerification
      // Esqueci minha senha (#469). O Better Auth gera o token (tabela `verification`, uso único) e a rota
      // GET `/reset-password/:token` que redireciona pra nossa tela com `?token=`. Aqui só mandamos o link.
      // Conta soft-deletada NÃO recebe e-mail (o gating já a barra; um reset não pode reanimá-la). O
      // endpoint responde igual exista ou não a conta (sem enumeração pela resposta).
      sendResetPassword: async ({ user, url }) => {
        if ((user as { deletedAt?: Date | null }).deletedAt) return
        await getMailer().sendAccountEmail(
          buildResetPasswordEmail({
            to: user.email,
            name: user.name,
            locale: (user as { locale?: string | null }).locale,
            url,
          }),
        )
      },
      resetPasswordTokenExpiresIn: 60 * 60, // 1h — casa a copy do e-mail
      // Quem redefine a senha por suspeita de invasão derruba as sessões abertas (inclusive a do invasor).
      revokeSessionsOnPasswordReset: true,
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

export type Auth = ReturnType<typeof getAuth>
