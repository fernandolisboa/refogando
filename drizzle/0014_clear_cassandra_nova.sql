-- Handle público, único e legível (#128). drizzle-kit gerou um `ADD COLUMN ... NOT NULL`
-- direto, que ESTOURARIA numa tabela com linhas (sem default). Reescrito como BACKFILL seguro:
-- (1) adiciona NULLABLE; (2) backfilla via slug-do-name + desambiguação numérica em SQL puro;
-- (3) trava NOT NULL; (4) cria o índice UNIQUE. Espelha a lógica de `src/domain/handle.ts`
-- (slugify: unaccent → minúsculo → [^a-z0-9]→'-' → colapsa/apara; fallback 'user'; reservadas).

-- (1) Coluna nullable primeiro: existentes ficam NULL até o backfill.
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint

-- (2) Backfill. Em um CTE: deriva a base-slug de cada user (espelhando handleBaseFromName),
-- desambigua por ROW_NUMBER() particionado pela base (ordem estável por created_at,id) e
-- grava base / base-2 / base-3… Bases vazias/curtas/reservadas caem no fallback 'user'.
WITH base AS (
  SELECT
    "id",
    "created_at",
    -- slugify(name): unaccent (dobra acentos), lower, não-alfanumérico→'-', colapsa, apara.
    -- A base truncada a 24 deixa folga (HANDLE_MAX_LEN 30 − sufixo) pro '-NN'.
    LEFT(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            LOWER(public.unaccent('public.unaccent', COALESCE("name", ''))),
            '[^a-z0-9]+', '-', 'g'
          ),
          '-+', '-', 'g'
        )
      ),
      24
    ) AS raw_base
  FROM "users"
),
normalized AS (
  SELECT
    "id",
    "created_at",
    -- Re-apara hífen que o LEFT() possa ter deixado na borda; fallback 'user' p/ base curta
    -- (< 3) ou reservada (colidiria com rota top-level / prefixo de /u/).
    CASE
      WHEN LENGTH(TRIM(BOTH '-' FROM raw_base)) < 3
           OR TRIM(BOTH '-' FROM raw_base) IN (
             'admin','api','me','u','users','user','sign-in','sign-up','signin','signup',
             'recipes','recipe','create','conversation','settings','profile','new','edit',
             'about','help','root','null','undefined'
           )
        THEN 'user'
      ELSE TRIM(BOTH '-' FROM raw_base)
    END AS handle_base
  FROM base
),
numbered AS (
  SELECT
    "id",
    handle_base,
    -- Ordem estável: conta mais antiga fica com a base sem sufixo (created_at, depois id).
    ROW_NUMBER() OVER (PARTITION BY handle_base ORDER BY "created_at", "id") AS rn
  FROM normalized
)
UPDATE "users" u
SET "handle" = CASE
  WHEN n.rn = 1 THEN n.handle_base
  ELSE n.handle_base || '-' || n.rn::text
END
FROM numbered n
WHERE u."id" = n."id";--> statement-breakpoint

-- (3) Agora que toda linha tem handle, trava a presença.
ALTER TABLE "users" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint

-- (4) Unicidade no banco (última linha contra corrida de signups simultâneos).
CREATE UNIQUE INDEX "users_handle_uq" ON "users" USING btree ("handle");
