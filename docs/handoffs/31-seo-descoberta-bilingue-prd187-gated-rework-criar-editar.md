# Handoff 31 — SEO + Descoberta bilíngue: domínio feito (PR #186) + PRD #187, **issues retidas** até o rework de Criar/Editar landar

> ⚠️ Este handoff foi **mantido untracked de propósito** (pedido do dono) — não commitar/pushar — **até** o rework de Criar/Editar landar.
>
> **Adendo (2026-06-23):** o hold foi **levantado**. O rework de Criar/Editar concluiu (épico **#190**, mergeado na `main`) e as issues de SEO **#228–#238** já foram criadas a partir do PRD #187. Este doc está agora commitado **para registro histórico**; o sequenciamento descrito abaixo é o contexto da época. Para retomar a perna de SEO, use o **Prompt de kickoff** no fim (ou o handoff **33**, a fase de dev mais recente).

## Estado (onde estamos)

- Iniciativa **SEO + descoberta bilíngue**. **Fase de domínio CONCLUÍDA e MERGEADA** na `main` via **PR #186** (squash). Worktree e branch já removidos.
- **PRD publicado:** issue **#187** (`ready-for-agent`).
- **Issues de implementação NÃO criadas** — retidas de propósito (ver abaixo).
- Nada de app implementado. Próximo passo é `/to-issues` a partir do #187 — **mas só depois** do rework de Criar/Editar.

## Por que está parado (decisão de sequenciamento — tomada com o dono, 2026-06-22)

Outra sessão faz o **rework de Criar/Editar** (criar=drawer lateral, editar=modal central; branch `feat/104-create-consolidation`; memória [[criar-editar-ux-overhaul]]). Esse rework reestrutura o **route tree**: `/create`, `/conversation/*`, e a **página de detalhe** (`src/app/recipes/[id]/page.tsx` vira read-only + modal de edição; está *em aberto* se `/create` continua sendo rota).

A espinha de SEO (envolver **todo `src/app/` em `[locale]`**) + o **detalhe-por-slug** tocam exatamente essas rotas e essa página. Rodar concorrente = conflito de merge + desenhar SEO sobre rotas que vão mudar. **Decisão: rework primeiro, SEO depois.** Único pedaço agnóstico (camada de dados pura, sem rota/detalhe): a fatia de **Slug (schema+geração+backfill)** — e mesmo essa ficou retida, por escolha do dono (opção A: segurar tudo).

## O que ler primeiro (ordem)

1. `docs/adr/0020-url-bilingue-locale-no-caminho-slug-indexacao-default-open.md` — **todas** as decisões (URL, slug, indexação default-open, hreflang/x-default, OG, JSON-LD) + Consequências aterradas no Next 16.
2. `CONTEXT.md` — termos novos/alterados: **Descoberta/Feed**, **Slug**, **Convenção de URL**, **Proveniência** (catálogo AI-assistido), **Imagem** (card sem selo).
3. PRD **#187** (`gh issue view 187 --comments`) — inclui o **comentário de sequenciamento**.
4. Memórias: [[seo-bilingual-discovery-initiative]], [[criar-editar-ux-overhaul]], [[keep-product-core-central-safety-proportionate]].

## O plano (10 fatias) — a forma que o `/to-issues` deve reproduzir

Espinha: **1.** Locale no caminho (`[locale]` + `proxy.ts` 302) → **2a.** Slug (schema+geração+backfill) → **2b.** Detalhe por slug + 301 do UUID + leitura anônima (`loadPublicRecipeBySlug`) → **3.** Links internos → canônico.
B+A: **4.** OG/social cards (B) → **5.** Canônico+hreflang+x-default+robots por receita → **6.** JSON-LD Recipe → **7.** Sitemap+robots.
Front-door: **8.** Fusão feed-home (`/{locale}` feed server-rendered + Busca inline; `/recipes` funde; filtrados `noindex`).
Apoio: **9.** Disclosure configurável do catálogo AI-assistido → **10.** Seed inicial do catálogo (**HITL**, ops; gerar-e-curar).

Dependências: 2a←1; 2b←1,2a; 3←2a,2b; 4←1,2b; 5←2b(após 4); 6←2b; 7←1,2a; 8←1,2a; 9←1; 10←9. Detalhe completo + user stories no #187.

## Princípios inegociáveis (NÃO re-litigar)

- **B→A→C** (cards de link → orgânico → landing). Landing (C) = Out of Scope; quando vier, dobra na home-feed.
- **Indexação DEFAULT-OPEN, sem gate humano.** Usuário publica → Google indexa, na hora. **⚠️ Eu (sessão anterior) derrapei 2x pra um gate de curadoria/revisão antes de indexar — o dono reverteu com veemência ("não sou burocrata"). NÃO reintroduzir.** Qualidade é **reativa** (Aviso de restrição, Moderação reativa) + futuro sinal automático `review_required` só p/ anomalias. Tradução automática **também indexa** (só sinalizada na UI). Ver [[keep-product-core-central-safety-proportionate]].
- **OG/social card SEM selo "gerada por IA"** (no card a imagem de IA é vitrine, não aviso — decisão do dono). O selo **in-app** segue valendo (ADR-0017).
- **Slug congelado** (renomear/revisar/republicar não muda a URL); **locale no caminho** prefix-all (`/pt-BR`,`/en-US`), raiz **302** + **x-default**; **301** do `/recipes/<uuid>` legado.
- **Seed do catálogo: gerar com nosso AI + curadoria humana → `origin=catalog`. NUNCA copiar texto/foto de site externo** (ADR-0019). É pré-requisito do *marketing*, não do friends-test.
- **JSON-LD sem `aggregateRating`** (Voto ≠ nota).

## Landmines

- **Next.js 16:** `middleware` foi renomeado p/ **`proxy`** (`proxy.ts`, **runtime nodejs**, sem edge).
- **Detalhe é o gargalo:** `src/app/recipes/[id]/page.tsx` hoje faz self-fetch `/api/recipes/[id]` com `cache:'no-store'` + cookie → **força render dinâmico** e arrisca personalizar pro crawler. A leitura indexável precisa do seam novo **`loadPublicRecipeBySlug(db, slug, locale)`** (DB direto, anônimo, cacheável), separado do caminho do dono.
- **Conflito com o rework de Criar/Editar** (route tree + página de detalhe) — é o motivo de estar parado. Re-fatiar só **após** ele landar.
- **Drizzle:** histórico de DDL fantasma — grep o `.sql` gerado (slug column + `UNIQUE(locale, slug)`).
- **`metadataBase`/sitemap:** NÃO depender de `headers()` em contexto de build — usar `APP_URL`/`getBaseUrl`.
- **Slug en-US** congela a partir do **título da tradução-máquina inicial** (por design — estabilidade > beleza). Curador corrige título, slug não muda.
- **Risco consciente:** indexar tradução automática crua tem risco "thin content" no Google — aceito (alcance > risco), reversível via robots.

## Critério de saída (quando retomar)

Quando o **rework de Criar/Editar landar na `main`**: re-rodar **`/to-issues` a partir do #187** → as fatias saem conscientes do route tree final (espinha embrulha rotas estáveis; fatia de links internos mira o drawer/modal, não os componentes atuais) → publicar com `ready-for-agent` (exceto a fatia 10/seed, que é **HITL**). Confirmar os seams propostos no #187 (destaque: `loadPublicRecipeBySlug`).

## Gotchas de ambiente

- **Trabalhar em WORKTREE dedicado off `origin/main`** (outra sessão usa o working dir). Hardlink-copy `node_modules` (symlink quebra o build/Turbopack). Endpoint **DIRETO** do DB pra testes (tirar `-pooler`) ou sessões concorrentes falham a suíte. Suíte node completa flaka no Neon → rode focado + confie na CI.
- Commits via **branch + squash PR**; nunca direto na `main`; sempre push após commit. **(Exceção: este handoff é untracked por pedido do dono — não commitar.)**
- Merge quando verde (sem gate de preview); AFK = sem gate humano (subagentes revisam).

---

## Prompt de kickoff (copiar e colar numa sessão nova)

```
Retomando a iniciativa "SEO + descoberta bilíngue" do refogando. Leia primeiro docs/handoffs/31-seo-descoberta-bilingue-prd187-gated-rework-criar-editar.md (handoff completo, untracked), depois o PRD na issue #187 (gh issue view 187 --comments, inclui o comentário de sequenciamento), o ADR docs/adr/0020-url-bilingue-locale-no-caminho-slug-indexacao-default-open.md e os termos novos do CONTEXT.md (Descoberta/Feed, Slug, Convenção de URL, Proveniência, Imagem). Contexto: a fase de domínio foi feita e mergeada (PR #186) e o PRD foi publicado (#187), mas as issues de implementação ficaram retidas porque colidiam com o rework de Criar/Editar (criar=drawer, editar=modal; branch feat/104-create-consolidation) que reestrutura o route tree e a página de detalhe. Antes de qualquer coisa, confirme que esse rework de Criar/Editar já landou na main. Se sim, rode /to-issues a partir do #187 para fatiar a iniciativa nas vertical slices da seção "O plano (10 fatias)" do handoff — agora conscientes do route tree final (a espinha [locale] embrulha rotas estáveis; a fatia de links internos mira os componentes do drawer/modal pós-rework). Respeite os princípios inegociáveis do handoff, com destaque ABSOLUTO para: indexação DEFAULT-OPEN sem gate humano (NÃO reintroduzir curadoria/revisão como pré-condição de indexar — o dono já reverteu isso duas vezes), e OG/social card SEM selo de IA. Publique as issues com ready-for-agent (exceto a fatia 10/seed, que é HITL). Trabalhe em worktree dedicado off origin/main. Se o rework de Criar/Editar ainda NÃO tiver landado, NÃO comece a implementação da SEO — apenas confirme comigo e aguarde.
```
