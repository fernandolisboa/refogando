-- #600: prova do consentimento das restrições salvas (LGPD art. 8º, §2º). Quando e com qual versão do texto a
-- pessoa salvou uma lista não vazia; salvar a vazia (revogar) e a eliminação zeram. Contas que já tinham
-- restrições ficam com NULL: consentiram antes do registro, e o formulário mostra o aviso de mudança até salvarem
-- de novo.
ALTER TABLE "users" ADD COLUMN "restricoes_consentidas_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restricoes_consentimento_versao" text;--> statement-breakpoint
-- #604 (ADR-0016, seção do #604): até o #604 o Better Auth aceitava `image` vindo do cliente em /update-user e
-- /sign-up/email, então `users.image` pode ter um valor plantado: o blob de outra pessoa (foto de receita ou de
-- avaliação) exibido como avatar, um blob de OUTRO store do Vercel (de quem plantou) ou uma URL externa
-- (rastreio). Fica só o que o app grava: avatar no NOSSO store (`ye2pksugovlrhxoq`, o host que já aparece em toda
-- URL de imagem pública), na forma exata que o store grava (`avatars/[<chave de 22>/]<arquivo>.<ext>`, a mesma de
-- `src/server/images/avatar-blob.ts`: sem `..`, `//`, query, hash, porta nem %), ou a foto do Google do login.
UPDATE "users" SET "image" = NULL
WHERE "image" IS NOT NULL
  AND "image" !~ '^https://ye2pksugovlrhxoq\.public\.blob\.vercel-storage\.com/avatars/([A-Za-z0-9_-]{22}/)?[A-Za-z0-9-]+\.(webp|jpg|png)$'
  AND "image" !~ '^https://lh[0-9]+\.googleusercontent\.com/';--> statement-breakpoint
-- O mesmo avatar em mais de uma conta (depois do UPDATE acima só resta o nosso host, então a URL inteira basta):
-- alguém plantou o avatar de outra pessoa. O banco não diz quem é a dona, então todas perdem a foto (sobem outra);
-- o blob vira órfão e a varredura semanal (#603) o recolhe. Uma passada (GROUP BY), sem self-join por linha.
UPDATE "users" SET "image" = NULL
WHERE "image" IN (
  SELECT "image" FROM "users"
  WHERE "image" LIKE 'https://ye2pksugovlrhxoq.public.blob.vercel-storage.com/avatars/%'
  GROUP BY "image"
  HAVING count(*) > 1
);
