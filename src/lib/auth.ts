import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, testUtils } from 'better-auth/plugins'
import { getDb } from '@/server/deps'
import * as schema from '@/db/schema'
import { ac, roles } from '@/lib/auth-permissions'
import { DEFAULT_ROLE } from '@/domain/user'

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
const googleId = process.env.GOOGLE_CLIENT_ID
const googleSecret = process.env.GOOGLE_CLIENT_SECRET
const hasGoogle = Boolean(googleId && googleSecret)

// E4 — fail-closed: BETTER_AUTH_SECRET é OBRIGATÓRIA fora de teste. O DEFAULT_SECRET
// do Better Auth é público e a lib só lança sozinha em production; aqui falhamos cedo
// em qualquer ambiente não-teste (dev incluso).
const authSecret = process.env.BETTER_AUTH_SECRET
if (!authSecret && process.env.NODE_ENV !== 'test') {
  throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
}

function buildAuth() {
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
    },
    session: {
      // cookieCache OFF (SEC-1, E5): o gating relê role/deletedAt VIVOS do DB a cada
      // request (requireSession barra deletedAt != null; requireRole usa role atual).
      // Com cache ligado, getSession serviria um snapshot stale do cookie — uma conta
      // soft-deletada ou rebaixada continuaria passando até o cache expirar. Explícito
      // aqui (não só por default implícito) para travar a invariante.
      cookieCache: { enabled: false },
    },
    emailAndPassword: { enabled: true }, // D3 — sem requireEmailVerification (sem infra de e-mail)
    socialProviders: hasGoogle
      ? { google: { clientId: googleId!, clientSecret: googleSecret! } }
      : {},
    user: {
      modelName: 'users',
      additionalFields: {
        // role é do plugin admin — NÃO declarar aqui.
        locale: { type: 'string', required: false, input: false },
        deletedAt: { type: 'date', required: false, input: false },
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
