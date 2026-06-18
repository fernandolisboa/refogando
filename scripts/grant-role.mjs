// Concede um papel a um Usuário EXISTENTE — bootstrap do primeiro admin (issue #5/#63).
//
// Há um ovo-e-galinha: a tela de Papéis do /admin promove gente, mas exige um admin
// pra usar — e não há nenhum no começo. Este script concede o primeiro papel fora da
// app; depois disso, use a UID de /admin pra promover o resto.
//
// Uso:  npm run grant-role -- <email> <papel>
//   (equivale a:  node --env-file=.env.local scripts/grant-role.mjs <email> <papel>)
// Papéis: usuario | curador | admin   (ver src/domain/user.ts)
//
// ATENÇÃO: o .env.local aponta para o DB de PRODUÇÃO — isto MUTA produção. Rode
// conscientemente. O usuário precisa ter entrado na app ao menos uma vez (a conta
// nasce no primeiro login).
import postgres from 'postgres'

const ROLES = ['usuario', 'curador', 'admin']
const [email, role] = process.argv.slice(2)

if (!email || !role) {
  console.error('Uso: npm run grant-role -- <email> <papel>')
  console.error(`Papéis: ${ROLES.join(' | ')}`)
  process.exit(1)
}
if (!ROLES.includes(role)) {
  console.error(`Papel inválido: "${role}". Use um de: ${ROLES.join(' | ')}`)
  process.exit(1)
}

// Prefere o endpoint DIRETO/unpooled (one-shot; sem prepared-statement do pooler),
// igual ao drizzle.config.
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL

if (!url) {
  console.error('Defina DATABASE_URL (ou rode com `npm run grant-role`, que carrega .env.local).')
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
try {
  const rows = await sql`
    UPDATE "users" SET "role" = ${role}
    WHERE "email" = ${email}
    RETURNING "id", "email", "role"
  `
  if (rows.length === 0) {
    console.error(
      `Nenhum usuário com email "${email}". Entre na app ao menos uma vez para criar a conta e tente de novo.`,
    )
    process.exit(1)
  }
  console.log(`OK — ${rows[0].email} agora tem o papel "${rows[0].role}".`)
} catch (err) {
  console.error('Falha ao conceder o papel:', err?.message ?? err)
  process.exit(1)
} finally {
  await sql.end()
}
