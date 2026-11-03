-- Papel de RUNTIME da app (#644, ADR-0058): só lê e grava linhas em `public`, sem DDL.
-- Rode no SQL Editor do Neon, branch `main`, database `neondb`, como `neondb_owner`. Troque COLE_A_SENHA por uma
-- senha só de letras e números (entra na URL sem escapar). Crie por SQL, NÃO pela tela de Roles do Neon: lá o
-- papel vira membro de `neon_superuser`.
-- As duas últimas instruções fazem as tabelas e sequências que as migrações (rodadas como neondb_owner) criarem
-- depois já nascerem com acesso para o app_rw.
-- test/integration/runtime-role.test.ts roda ESTE arquivo (trocando os nomes) e prova que o papel faz DML e não
-- faz DDL: mudou aqui, o teste acompanha.
CREATE ROLE app_rw WITH LOGIN PASSWORD 'COLE_A_SENHA';
GRANT CONNECT ON DATABASE neondb TO app_rw;
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
