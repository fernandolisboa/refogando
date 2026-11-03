-- Conferência do papel app_rw (#644, ADR-0058). Rode no SQL Editor do Neon, branch `main`, DEPOIS de
-- papel-app-rw.sql. Tem que voltar ZERO linhas. Uma linha = tabela ou sequência de `public` sem o privilégio (um
-- GRANT sobre tabela de outro dono só dá WARNING, não erro), ou o papel com poder demais.
select 'tabela sem ' || p.priv as falta, c.relname as objeto
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
where n.nspname = 'public' and c.relkind in ('r', 'p') and not has_table_privilege('app_rw', c.oid, p.priv)
union all
select 'sequência sem USAGE', c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'S'
  and case when c.relkind = 'S' then not has_sequence_privilege('app_rw', c.oid, 'USAGE') else false end
union all
select 'papel com poder demais', r.rolname
from pg_roles r
where r.rolname = 'app_rw'
  and (r.rolsuper or r.rolcreaterole or r.rolcreatedb
       or exists (select 1 from pg_auth_members m where m.member = r.oid));
