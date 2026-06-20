-- Handle público, único e legível (#128). drizzle-kit gerou um `ADD COLUMN ... NOT NULL`
-- direto, que ESTOURARIA numa tabela com linhas (sem default). Reescrito como BACKFILL seguro:
-- (1) adiciona NULLABLE; (2) backfilla via slug-do-name + desambiguação numérica em SQL puro;
-- (3) trava NOT NULL; (4) cria o índice UNIQUE. Espelha a lógica de `src/domain/handle.ts`
-- (slugify: unaccent → minúsculo → [^a-z0-9]→'-' → colapsa/apara; fallback 'user'; reservadas).

-- (1) Coluna nullable primeiro: existentes ficam NULL até o backfill.
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint

-- (2) Backfill com unicidade GLOBAL garantida. ATENÇÃO: um ROW_NUMBER particionado SÓ pela base
-- NÃO garante unicidade global — um nome que slugifica pra um literal "ana-2" colidiria com o
-- "ana-2" que a desambiguação da base "ana" produz (cross-base), e o `CREATE UNIQUE INDEX` do
-- passo (4) abortaria o deploy. Então atribuímos SEQUENCIALMENTE num laço, conferindo a cada
-- linha o conjunto GLOBAL já gravado (espelha o `disambiguate` puro de src/domain/handle.ts).
DO $$
DECLARE
  r RECORD;
  candidate text;
  n int;
BEGIN
  FOR r IN
    SELECT
      usr."id" AS id,
      -- Re-apara borda + fallback 'user' p/ base curta (< 3) ou reservada (colidiria com rota
      -- top-level / prefixo de /u/). Ordem estável: conta mais antiga pega a base sem sufixo.
      CASE
        WHEN LENGTH(s.base) < 3 OR s.base IN (
          'admin','api','me','u','users','user','sign-in','sign-up','signin','signup',
          'recipes','recipe','create','conversation','settings','profile','new','edit',
          'about','help','root','null','undefined'
        ) THEN 'user'
        ELSE s.base
      END AS handle_base
    FROM "users" AS usr
    CROSS JOIN LATERAL (
      -- slugify(name): unaccent (dobra acentos) → lower → não-alfanumérico→'-' → colapsa → apara;
      -- trunca a 24 (folga de HANDLE_MAX_LEN 30 − sufixo) e re-apara hífen de borda do LEFT().
      SELECT TRIM(BOTH '-' FROM LEFT(
        TRIM(BOTH '-' FROM
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              LOWER(public.unaccent('public.unaccent', COALESCE(usr."name", ''))),
              '[^a-z0-9]+', '-', 'g'
            ),
            '-+', '-', 'g'
          )
        ),
        24
      )) AS base
    ) AS s
    ORDER BY usr."created_at", usr."id"
  LOOP
    candidate := r.handle_base;
    n := 1;
    -- Confere o conjunto GLOBAL já atribuído (linhas ainda NULL não casam). Garante unicidade
    -- cross-base que o ROW_NUMBER particionado não daria.
    WHILE EXISTS (SELECT 1 FROM "users" WHERE "handle" = candidate) LOOP
      n := n + 1;
      candidate := r.handle_base || '-' || n::text;
    END LOOP;
    UPDATE "users" SET "handle" = candidate WHERE "id" = r.id;
  END LOOP;
END $$;--> statement-breakpoint

-- (3) Agora que toda linha tem handle, trava a presença.
ALTER TABLE "users" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint

-- (4) Unicidade no banco (última linha contra corrida de signups simultâneos).
CREATE UNIQUE INDEX "users_handle_uq" ON "users" USING btree ("handle");
