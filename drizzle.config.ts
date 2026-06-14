import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit roda FORA do Next.js: não carrega .env.local sozinho. Carregamos aqui.
config({ path: '.env.local' })
config()

// Migrações e DDL exigem conexão de sessão estável: usar o endpoint DIRETO/unpooled.
// (O pooler PgBouncer em modo transação não suporta o advisory lock + transação do migrator.)
const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  ''

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
