# Handoff 03 — Issues → Desenvolvimento

**Fase concluída:** Issues (`/to-issues`). **Próxima fase:** Desenvolvimento (fluxo de 8 passos por issue).
Pipeline completo + os 8 passos: ver `CLAUDE.md` → "Fluxo de trabalho".

## Estado

O PRD #1 foi fatiado em **22 vertical slices**, publicadas como issues **#2–#23** no GitHub (`fernandolisboa/refogando`), todas com label `ready-for-agent`. As 319 histórias do PRD estão cobertas; o grafo de dependências é um **DAG limpo** (sem ciclos), com raiz única **#2 (Fundação)**.

A fatiação passou por **duas rodadas de verificação adversarial** (workflows multi-agente) antes e depois da publicação:
1. cobertura + dependências + landmines do rascunho (quebrou um ciclo S14↔S16, re-homed os Avisos de fluxo, dividiu o kernel de geração);
2. revisão das 22 issues publicadas por 5 lentes especializadas (spec/cobertura, ADR/glossário/landmine, dependência, tracer-bullet/altitude, clareza-AFK). Os 4 itens bloqueantes e o AC-tightening foram aplicados — ver "O que a revisão mudou".

## Ler primeiro (no repo / GitHub — não duplicado aqui)

- **Issues #2–#23** (https://github.com/fernandolisboa/refogando/issues) — cada uma é uma fatia auto-suficiente: `## What to build`, `## Acceptance criteria` (asserções pela seam alta), `## Blocked by` (números reais de issue). **Fonte de verdade pra implementar.**
- **`docs/prd/refogando.md`** + **Issue #1** — o PRD: 319 histórias + Decisões de Implementação/Teste/Fora de Escopo. Cada issue cita as histórias que entrega.
- **`CONTEXT.md`** — glossário canônico. Termos são lei; respeite os `_Avoid_`.
- **`docs/adr/0001-0013`** — decisões travadas. Não reabrir.
- **`CLAUDE.md`** — o fluxo de 8 passos por issue (cada passo num subagente fresco).

## Tarefa desta sessão

Implementar as issues **uma de cada vez** pelo **fluxo de 8 passos** (explorar → planejar → revisar plano → corrigir plano → implementar → code-review múltiplo → corrigir → validar e fechar). **Começar por #2 (Fundação)** — é a raiz, pré-requisito de tudo. Selecionar automaticamente a skill certa por caso (`tdd`, `diagnose`, `review`, `verify`, etc.), sem o usuário nomear.

## Ordem / dependências

Pegar sempre uma issue cujo `Blocked by` já esteja **mergeado**. O grafo (validado ao vivo no GitHub):

- **Raiz:** #2 (Fundação).
- **Depois de #2:** #3 (espinha da Receita), #4 (locale shell), #5 (auth) — podem ir em paralelo.
- **Depois de #3:** #6 (busca precisa), #7 (Aviso engine), #8 (kernel de geração, +#5).
- Sequência geral fundação→feature; folhas terminais: #4, #15, #16, #18, #19, #20, #21, #22, #23.
- A ordem topológica está nos `Blocked by`; não há ciclo.

## Princípios inegociáveis (não reabrir)

- **Seam de teste travada:** todo teste de integração entra pela **porta mais alta** (route handler / server action) contra **Postgres real e descartável** (exercitando FTS/`unaccent`/`pgvector` de verdade); o **Claude** e o **embedding** ficam atrás de **uma interface mockável cada**. Provider de banco **neutro** — não cravar Vercel/Neon.
- Receita é o centro; segurança/compliance = **toque leve** (Aviso "declarado, não verificado"), nunca subsistema/gating.
- Identidade única e language-neutral da Receita (nunca bifurcar por locale). Owner ≠ Autoria ≠ Proveniência.
- **Última versão estável** de toda dependência (Next.js não-pinado; ler "15" como a última).
- Termos do `CONTEXT.md` são lei; honrar os 13 ADRs.

## Landmines

- **`result_kind`** no banco só tem `success | degraded | playful`. `impossible`/`invalid` são desfechos de geração que **não** persistem — nunca adicionar ao enum.
- **Invariantes de banco:** CHECK `playful ⇒ private`; CHECK `mode=structured ⇒ briefing presente`; `ON DELETE SET NULL` no `parent_recipe_id`; UNIQUE + **não-autovoto** no Voto; `origin` imutável.
- **Linhagem unificada** (`parent_recipe_id` + `lineage_kind`): uma árvore; **diff só viaja quando `edited`**.
- **Despublicar** (Owner toca `visibility`) ≠ **remover-do-pool** (Curador, estado de moderação). Caminhos distintos.
- **Referências entre issues usam números reais de issue do GitHub** (foi corrigido um off-by-one onde a prosa usava o número da fatia; agora prosa e `Blocked by` batem com o GitHub).

## Mapa de propriedade (evita duplicar concern cross-cutting)

Definido na fatiação pra um concern ter **um dono** e os outros **consumirem**:

- **Regra de `stale`** (qual mudança marca tradução/embedding como stale; campo invariante **não** marca) → **dona: #3** (espinha). #14/#19/#20/#21/#23 **invocam**, não reimplementam.
- **Re-embedding (recompute do vetor)** → **dono: #14** (semântica).
- **Motor de Aviso de restrição** (lookup estático alérgeno→restrição) → **dono: #7**; #10/#11/#16/#21 reusam.
- **Kernel de geração + scaffold da CreationSession + registro de geração (comentário consultivo fora da Receita)** → **dono: #8**; #11 estende com Briefing+CHECK, #12 com transcript.
- **Transcript (persistir/retomar/apagar)** → **dono: #15**.
- **Vocabulário culinário** (enums `cozinha/dificuldade/restrição/porções`) → módulo de #2; `Categoria` e `Tag` são vocabulários separados (Briefing não tem Tag/Categoria).
- **Colunas/junção de faceta da Receita** (`cozinha`, `categoria`, Receita↔Tag N:M, `restrições[]`+GIN) → nascem em #3.

## O que a revisão mudou (já aplicado nas issues)

- **#3** ganhou colunas/junção de faceta (cozinha/categoria/Tag) + a regra de `stale` + AC da exclusão de campo invariante.
- **#8** passou a criar o scaffold mínimo da `CreationSession`/registro de geração (pra o comentário consultivo ter onde morar).
- **#14** ganhou asserções **seedadas** do piso da camada precisa (exato > só-semântico) e da degradação (embedding cai → resultado = só-precisa, 200, não-vazio); a fórmula de fusão é ponto de plano, não congelada.
- Renumeração global das refs em prosa; vários ACs viraram observáveis pela seam; #22 ganhou #11 como blocker (modo estruturado efêmero).

## Critério de saída por issue / fase

Por issue: tudo verde (testes, lint, types, code-reviews satisfeitos) → **mergear o PR e fechar a issue**. Fase de Desenvolvimento concluída quando as 22 estiverem mergeadas. Rodar `/handoff` ao fim.

## Gotchas de ambiente

- **Branch:** `main`. PRD, handoffs e issues **já pushed**.
- **`gh` funciona** direto do clone (`fernandolisboa/refogando`, público). Labels de triagem existem.
- **Escritas no GitHub** podem ser barradas pelo classificador do harness; se barrar, o usuário aprova ou roda via `! ...`.
- Os corpos das issues foram montados a partir de arquivos transientes em `/tmp/refogando-issues/` — **o GitHub é a fonte de verdade agora** (não depender do `/tmp`).
- **Memória persistida** (`always-push-after-commit`): dar `git push` depois de cada commit, sem perguntar.

## Como trabalhar com este usuário (memória)

- Linguagem **simples e direta**, sem firula (pt-BR informal). Termos do glossário à risca.
- Grelhar **só** forks irreversíveis / que congelam schema; em detalhe reversível, decidir com default + **o porquê** e deixar vetar. Sem bikeshed; priorizar momentum.
- Receita é o centro; compliance = toque leve.
- Gosta de **subagentes especializados** revisando o trabalho antes de fechar.

## Suggested skills

- **`tdd`** — red-green-refactor com teste de integração pela seam alta (o pão-com-manteiga de cada issue).
- **`diagnose`** — quando algo quebra/regride de forma difícil.
- **`review`** / **code-review** — no passo 6, múltiplos revisores especializados (bugs, segurança, qualidade, performance, aderência a ADR/CONTEXT).
- **`verify`** / **`run`** — confirmar comportamento no app real quando fizer sentido.
- **`request-refactor-plan`** — se aparecer dívida que mereça plano incremental.
- **`triage`** — se precisar ajustar estado/labels das issues.

---

Prompt de kickoff (copiar a partir da próxima linha):

Você é o arquiteto-implementador do Refogando. Esta sessão começa a fase de Desenvolvimento: implementar as issues #2–#23 (já publicadas no GitHub, label ready-for-agent) uma de cada vez, pelo fluxo de 8 passos do CLAUDE.md, cada passo num subagente fresco. Comece lendo o handoff @docs/handoffs/03-issues-para-dev.md (estado, ordem/dependências, princípios inegociáveis, landmines, mapa de propriedade, gotchas), e tenha à mão @docs/prd/refogando.md (PRD, fonte das histórias), @CONTEXT.md (glossário — termos são lei) e docs/adr/0001-0013 (decisões travadas). As 22 issues formam um DAG limpo com raiz única #2 (Fundação): comece por #2 e sempre pegue uma issue cujo Blocked by já esteja mergeado. Honre a seam de teste travada (Postgres real e descartável pela porta mais alta; Claude e embedding atrás de uma interface mockável cada; provider de banco neutro) e o mapa de propriedade do handoff (regra de stale em #3, re-embedding em #14, motor de Aviso em #7, kernel + scaffold de CreationSession em #8, transcript em #15) — não duplique concern cross-cutting. Respeite os landmines: result_kind só success|degraded|playful no banco; os CHECKs (playful⇒privada, structured⇒briefing); ON DELETE SET NULL; UNIQUE + não-autovoto; origin imutável; linhagem unificada com diff só quando edited; despublicar (Owner/visibility) ≠ remover-do-pool (Curador/moderação); identidade única por idioma. Referências entre issues são números reais de issue do GitHub. Por issue: explorar → planejar → revisar o plano → corrigir → implementar (subagentes em paralelo quando der) → code-review com múltiplos especialistas → corrigir → validar e fechar (verde em testes/lint/types/reviews → mergear o PR e fechar a issue). Estilo: linguagem simples e direta, pt-BR; grelhe só decisão irreversível/que congela schema, no resto decida com default + porquê e me deixe vetar; receita é o centro, compliance é toque leve; última versão estável de toda dependência; git push depois de cada commit. Selecione automaticamente a skill certa por caso (tdd, diagnose, review, verify, run, request-refactor-plan). Comece explorando a issue #2.
