# Handoff 93 — Console sem rolagem horizontal no celular

**Data:** 2026-10-24.
**PR:** "Console no celular: ações do card do Catálogo quebram linha, sem rolagem horizontal".
**Base:** `main` depois do #633.
**Migração:** nenhuma. **ADR:** nenhum novo (ADR-0049 segue; ADR-0047 segue, a suíte só ganhou uma spec).

## 1. Escopo

- **Bug (print do Fernando, `/pt-BR/admin/catalog` no celular):** no card da fila "Receitas pendentes de curadoria", a
  linha Aprovar / Rejeitar / Editar / Imagem / Ver receita era `flex` sem `flex-wrap`. "Ver receita" ficava fora do
  card e a página inteira rolava para o lado (501 px de conteúdo numa tela de 412 px; 360 px também estourava).
- **Correção:** as duas linhas de botões do card (`catalog-recipe-queue.tsx`, a normal e a do "Rejeitar" com nota)
  passam a quebrar. Pelo mesmo motivo, a linha "Salvar nomes" + "Nomes salvos" das filas de tradução
  (`stale-translations.tsx`, `divergent-stale-translations.tsx`).
- **Varredura das outras seções:** Pixel 7 (412 px) e 360 px, com o Catálogo expandido (Imagem, Ver receita e
  Rejeitar abertos) e a gaveta de detalhes de Usuários. Só o Catálogo estourava. O review conferiu as outras linhas
  `flex` de botões sem `flex-wrap` (Vocabulário, Redes, Usuários, Receita da semana, estúdio de imagem): cabem.
- **Guarda E2E:** `e2e/specs/console-celular.spec.ts` entra com o admin do seed e mede `/admin` e cada seção de
  `CONSOLE_GROUPS`: `scrollWidth ≤ clientWidth`, nos dois perfis. Sem a correção, falha no perfil `celular` com
  `/admin/catalog` 501 > 412.

## 2. O que ler primeiro

1. `src/components/admin/catalog-recipe-queue.tsx`: as linhas de ações do card (procure `flex flex-wrap gap-2`).
2. `e2e/specs/console-celular.spec.ts`.
3. `e2e/harness/seed.ts` + `e2e/fixtures/seed-data.ts`: `SEED_ADMIN` (com senha) e `SEED_PENDENTE` (rascunho do
   Catálogo pendente).
4. `docs/e2e.md`: a linha da spec na tabela e a nota sobre `SEED_ADMIN` em "Escrevendo uma spec nova".

## 3. Princípios inegociáveis

- **Linha de botões no Console quebra.** Card de fila e painel têm ~300 px úteis numa tela de 360 px: qualquer linha
  com três ou mais botões, ou com rótulos que variam (estado "Aprovando…", "Ocultar imagem"), leva `flex-wrap`.
- **Seção nova do Console entra sozinha na guarda.** A spec lê `CONSOLE_GROUPS`; não é preciso listar rota à mão.
  Se a seção nova carrega dados no cliente, o placeholder precisa de `aria-busy` ou do texto "Carregando…"
  (`t.system.loading`), senão a spec mede antes do conteúdo.
- **`SEED_ADMIN` é só leitura.** É a única conta do seed com senha (hash do próprio Better Auth, conta `credential`)
  e serve a todas as specs que precisarem do papel: não mude papel, perfil nem dados dela numa spec.

## 4. Landmines

- O teto de `/sign-in/*` (5/60 s por IP) **não** vale no E2E: o Better Auth deriva o IP só do `x-real-ip`
  (`src/lib/auth.ts`), que o `next start` local não recebe, e sem IP ele pula o rate limit. Não conte com esse teto
  numa spec, nem para provar que ele funciona.
- O harness local precisa de Postgres 17 + pgvector. Com Postgres 16 a migração do CHECK
  `recipe_web_imported_private_chk` falha. Sem Docker rodando, suba um `pgvector/pgvector:pg17` numa porta livre e
  passe `E2E_DATABASE_URL` inline (`docs/e2e.md`).
- No container da nuvem, o Chromium do Playwright fica em `/opt/pw-browsers/chromium`
  (`E2E_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`).

## 5. Critério de saída

- `checks` e `e2e` verdes no PR; a spec `console-celular` passa nos dois perfis.
- Em produção, `/pt-BR/admin/catalog` no celular sem rolagem lateral e com os botões do card dentro dele.
