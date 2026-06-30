# Handoff 46 — Desfazer/refazer a medida de ingrediente (Direção B reprovada ao vivo)

## TL;DR / Escopo

O **PR #357** (Direção B) está **mergeado e no ar** (main `6027301`), mas o **dono REPROVOU ao ver na
tela de produção**. Esta sessão **decide e executa**: reverter tudo, ou manter o modelo de dados
(medida estruturada = fonte única) e **refazer só o display + plurais**. Tudo é **reversível**.

Esta NÃO é mais a Direção B "travada" — o dono mudou de ideia depois de ver ao vivo (lição
[verificar-arte-na-superficie-real / #270]: validar na superfície real). O que era "decisão
travada, não re-litigar" agora está **em aberto**.

## Por que reverter (3 problemas reais, vistos ao vivo)

1. **Rótulo da unidade não pluraliza** — "3 dente", "4 colher de sopa", "2 louro". Era a decisão
   "zero gramática" do ADR-0012 Adendo (não pluralizar a unidade). Na prática lê errado.
2. **O em-dash "—" é ruim** — feio, **inconsistente** (contável tipo "1 cebola picada" / "6 tomates"
   NÃO tem dash; não-contável tipo "3 dente — alho" tem), e **às vezes não renderiza** na fonte de
   produção. O dono sugeriu que **"de" / prosa natural** seja melhor.
3. **A migração over-stripou palavras de porção** — "4 folhas de alga nori" → "alga nori", "2 folhas
   de louro" → "louro" (vira "2 louro"). São ~**618 linhas** que começam com porção/contável + número
   onde a palavra-de-porção ERA a unidade-de-contagem e foi perdida. Isso é **dado**, não só display.
   (Os NOMES plurais em si NÃO foram trocados pra singular — "alho picados", "cebolinha em tiras"
   mantiveram o plural; o singular na tela é o item 1 + o over-strip do item 3.)

## O que ler primeiro (real, file:line)

- `docs/handoffs/45-medida-de-ingrediente-estruturada-fonte-unica-rawtext-vira-nome.md` — o handoff que
  originou (a Direção B agora questionada).
- **PR #357** / merge commit `6027301` — TUDO que foi feito (gen `rawText`→`nome`, `formatIngredientLine`
  compõe, importer strip, forms name-only, scripts de migração).
- `docs/adr/0012-*.md` **Adendo (2026-06-30)** + `docs/adr/0009-*.md` **Adendo (2026-06-30)** + `CONTEXT.md`
  "Item de receita" — o design travado a ser **re-grelado/emendado** (não mais lei).
- `src/domain/ingredient-line.ts` — `formatIngredientLine`, o composer "{qtd} {unitLabel} — {nome}" a
  refazer (ou reverter).
- `scripts/data/strip-measure-applied.json` — o **ledger**: `before`→`after` de **1887 linhas**. É a
  rede de reversão dos dados.

## Estado atual (real)

- **Código:** PR #357 merged na main `6027301`, deploy de produção no ar.
- **Dados de prod:** 1849 `recipe_ingredient.raw_text` viraram nome-só; ~618 perderam palavra de porção;
  **7 sinalizadas ficaram INTACTAS** (ledger `method:'flagged'`, `after==before` — nunca escritas). O
  ledger tem `before` exato de todas.
- **7 sinalizadas** (não consertadas; moot se reverter): 1 é receita do dono ("Macarrão Alho e Óleo
  Rápido"), 6 são catálogo escondido. Lista no fim do chat da sessão anterior.

## Caminho de UNDO (limpo, determinístico)

Reverter ao estado pré-#357 = **dois passos** (faça os DOIS, ou nenhum):

1. **Dados:** script de reversão que lê o ledger e faz `UPDATE recipe_ingredient SET raw_text = before
   WHERE id = <id>` pra cada entrada (espelha `scripts/strip-measure-from-raw-text.ts`; escreva-o). É
   **restaurar o original** (não escolha do agente), determinístico.
2. **Código:** `git revert` do merge commit `6027301` (volta `formatIngredientLine` a exibir `raw_text`
   verbatim = comportamento do #354; gen volta a `rawText`; importer volta a não-stripar; placeholders).

**ORDEM importa:** reverter o CÓDIGO sem os DADOS ⇒ `raw_text` nome-só exibido cru = "arroz arbóreo" SEM
medida (perde a medida na tela). Reverter os DADOS primeiro (ou junto no mesmo deploy). O alvo é o
estado pré-#357: `raw_text` = linha completa, exibida verbatim.

## A decisão a GRELHAR (não pré-decidir — é do dono)

- **Reverter tudo** (volta pro #354: `raw_text` = linha humana completa, sem medida estruturada
  confiável, sem escalar) **vs. manter o modelo** (medida estruturada = fonte única, `raw_text` = nome) e
  **refazer só o display** com prosa natural + plurais.
- Se **manter o modelo**: o display precisa **pluralizar a unidade** ("colher"→"colheres", "dente"→
  "dentes") e juntar com **"de"** ("2 colheres de sopa de azeite") — exatamente a gramática que o ADR
  tentou evitar. Plurais corretos exigem formas singular/plural ⇒ **Ingrediente canônico** (ADR-0012,
  hoje deferido) OU uma heurística de plural pt-BR/en-US (frágil: "limão"/"pão"/concordância). Decidir.
- Se **reverter tudo**: reprocessar nada; aceitar que escalar/filtrar por medida fica fora de novo.
- **Over-strip de porção** (~618): se NÃO reverter os dados, essas precisam reprocessamento (restaurar a
  palavra de porção OU re-derivar a medida).

## Princípios inegociáveis / landmines

- **Nunca corromper/perder dado sem reversibilidade** — o ledger é a rede; use-o.
- **Validar na SUPERFÍCIE REAL** (lição #270) — conferir no app de produção, não só em teste verde.
- **branch + PR**, nunca direto na main (handoffs também).
- O **classifier BLOQUEIA escrita agent-chosen em prod** (é o HITL); reversão-via-ledger é "restaurar o
  original", deve passar — mas confirme, e se travar, peça o `!` ao dono.
- A migração foi **assistida por IA**, mas a **reversão é determinística** (ledger guarda o `before`).
- CI ~12min; a migração de dados **NÃO é schema** (roda à mão via `npm run strip-measure`, não no deploy).
- `gh pr merge --delete-branch` falha no git local (`main` na worktree) mas o merge remoto acontece —
  confirme `gh pr view --json state`.

## Critério de saída

- Decisão tomada e **registrada** (ADR-0012/0009 emendado de novo, honesto sobre a reversão).
- Display no ar **concorda com a decisão** (plurais certos OU linha completa; sem dash feio).
- Se revertido: `raw_text` restaurado (verify: para cada id do ledger, prod `raw_text == before`),
  display = #354, gen volta a `rawText`.
- Testes verdes, tsc + lint, PR mergeado, **conferido no app de produção**.

## Suggested skills

- **`/grill-with-docs`** — re-grelar o modelo de exibição contra ADR-0012/0009 + CONTEXT.md e **emendar
  inline** (a Direção B deixa de ser lei).
- **`/verify`** ou **`/run`** — conferir no app de PRODUÇÃO (a falha foi não conferir na superfície real).
- **Workflow (ultracode)** — se refazer o display, review adversarial multi-lente.

## Prompt de kickoff (copiar e colar numa sessão nova)

Reverter (ou refazer) o conserto de medida de ingrediente da Direção B (PR #357, mergeado na main 6027301), que o dono REPROVOU ao ver na tela de produção. Leia primeiro docs/handoffs/46-desfazer-refazer-medida-direcao-b-display-plurais.md e o que ele referencia. Os 3 problemas vistos ao vivo: (1) o rótulo da unidade não pluraliza ("3 dente", "4 colher de sopa", "2 louro") — decisão "zero gramática" do ADR ficou ruim; (2) o em-dash "—" é feio, inconsistente (contável não tem dash, não-contável tem) e às vezes não renderiza, o dono prefere "de"/prosa natural; (3) a migração over-stripou palavras de porção ("4 folhas de alga nori"→"alga nori", "2 folhas de louro"→"louro") em ~618 linhas. Tudo é reversível: git revert do merge 6027301 volta o display do #354 (raw_text exibido verbatim), e o ledger scripts/data/strip-measure-applied.json tem o before→after de 1887 linhas pra restaurar raw_text (reverter os DADOS antes ou junto do código, senão a tela mostra nome sem medida). NÃO pré-decida: grele com o dono (/grill-with-docs) entre reverter tudo (volta pro #354) ou manter a medida estruturada como fonte e refazer SÓ o display com prosa natural + plurais corretos (plurais moram no Ingrediente canônico do ADR-0012, hoje deferido; heurística de plural é frágil). As 7 linhas sinalizadas ficaram intactas e são moot se reverter. Princípios: nunca perca dado sem o ledger, valide na superfície REAL de produção (não só teste verde), branch+PR nunca direto na main.
