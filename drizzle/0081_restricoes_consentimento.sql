-- #600: prova do consentimento das restrições salvas (LGPD art. 8º, §2º). Quando e com qual versão do texto a
-- pessoa salvou uma lista não vazia; salvar a vazia (revogar) e a eliminação zeram. Contas que já tinham
-- restrições ficam com NULL: consentiram antes do registro, e o formulário mostra o aviso de mudança até salvarem
-- de novo.
ALTER TABLE "users" ADD COLUMN "restricoes_consentidas_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restricoes_consentimento_versao" text;--> statement-breakpoint
-- #604 (ADR-0016, seção do #604): até o #604 o Better Auth aceitava `image` vindo do cliente em /update-user e
-- /sign-up/email, então `users.image` pode ter um valor plantado: o blob de outra pessoa (foto de receita ou de
-- avaliação) exibido como avatar, ou uma URL externa (rastreio). Fica só o que o app grava: avatar no nosso
-- Vercel Blob, sob /avatars/, na forma canônica (sem query, hash, porta nem %), ou a foto do Google do login.
UPDATE "users" SET "image" = NULL
WHERE "image" IS NOT NULL
  AND "image" !~ '^https://[a-z0-9]+\.public\.blob\.vercel-storage\.com/avatars/[A-Za-z0-9_./-]+$'
  AND "image" !~ '^https://lh[0-9]+\.googleusercontent\.com/';--> statement-breakpoint
-- O mesmo avatar (pelo CAMINHO, em qualquer host do Vercel Blob) em mais de uma conta: alguém plantou o avatar
-- de outra pessoa. O banco não diz quem é a dona, então todas perdem a foto (sobem outra); o blob vira órfão e a
-- varredura semanal (#603) o recolhe.
UPDATE "users" AS u SET "image" = NULL
WHERE u."image" ~ '^https://[a-z0-9]+\.public\.blob\.vercel-storage\.com/avatars/'
  AND EXISTS (
    SELECT 1 FROM "users" AS o
    WHERE o."id" <> u."id"
      AND o."image" ~ '^https://[a-z0-9]+\.public\.blob\.vercel-storage\.com/avatars/'
      AND regexp_replace(o."image", '^https://[^/]+', '') = regexp_replace(u."image", '^https://[^/]+', '')
  );
