-- #610 (ADR-0052): crédito público na Receita derivada ("Baseada na receita … de @handle"). Duas colunas novas, ambas
-- metadata-only (sem reescrita da tabela): `recipe.credit_removed_at` (o dono da base retirou o nome desta derivada;
-- NULL = crédito valendo) e `users.credit_on_derivatives` (a pessoa quer ser creditada nas cópias das receitas dela;
-- default true, constante). `lock_timeout` limita a espera pelo ACCESS EXCLUSIVE de cada ALTER (como em 0075–0078):
-- com tráfego segurando a tabela, a migração falha rápido em vez de enfileirar as leituras atrás dela.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "credit_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_on_derivatives" boolean DEFAULT true NOT NULL;