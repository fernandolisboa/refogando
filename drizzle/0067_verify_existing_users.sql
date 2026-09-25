-- #470 (ADR-0014): o cadastro passa a exigir e-mail confirmado (requireEmailVerification). Contas criadas
-- ANTES disso nunca tiveram como confirmar (não havia o fluxo) e ficariam trancadas no próximo login: todas
-- são marcadas como confirmadas. Só dados, idempotente (re-rodar não acha linha com false). Contas Google já
-- nascem com email_verified do provedor; entram aqui só se, por algum motivo, estiverem false.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
