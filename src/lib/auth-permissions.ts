import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access'

/**
 * Access control do plugin admin (issue #5, ADR-0011).
 *
 * `catalog`/`config` são as fronteiras de papel do domínio; `...defaultStatements`
 * traz os statements do plugin admin (gestão de usuário: ban/setRole/etc.), para o
 * papel `admin` herdar essas permissões via `...adminAc.statements`.
 *
 * Nota de escopo: o gating dos handlers desta fatia usa o RANK de papel (`ROLE_RANK`
 * em `@/domain/user`), simples e suficiente para #5.AC1/AC2/AC5. Este `ac`/`roles`
 * existe para (a) registrar os papéis customizados no plugin admin e (b) habilitar
 * `getAuth().api.userHasPermission` no futuro. Sem checagem de permissão fina agora.
 */
// `statement` é interno (consumido só por createAccessControl abaixo): export removido
// (QM-4 — não havia consumidor externo). Vira export de novo se userHasPermission precisar.
const statement = {
  ...defaultStatements,
  catalog: ['curate', 'review'], // Curador: curar catálogo + revisar reportadas
  config: ['read', 'write'], // só Admin
} as const

export const ac = createAccessControl(statement)

export const usuario = ac.newRole({})
export const curador = ac.newRole({ catalog: ['curate', 'review'] })
export const admin = ac.newRole({
  catalog: ['curate', 'review'],
  config: ['read', 'write'],
  ...adminAc.statements,
})

export const roles = { usuario, curador, admin }
