# Handoff 82 — Console com barra lateral e lista de Usuários

**Sessão:** 2026-10-22, thread "Lista de usuários e visual do admin". **Branch:** `claude/project-thread-09em1i`, sobre a main em `5b4580d`. **Migração:** nenhuma. A decisão está no ADR-0049, e o rascunho aprovado no artifact "Admin Refogando: novo layout".

## 1. O que mudou

- **Layout do Console** (`src/components/admin/`):
  - `console-sections.ts` é o mapa único das seções: grupos Pessoas, Plataforma e Curadoria, com rota, rótulo `nav*`, descrição `desc*` e ícone do lucide. Daí saem `groupsForRole` e `findConsoleSection`. Este último também casa as subrotas.
  - `section-nav.tsx` virou navegação vertical com ícones. Mantém o `role="group"` rotulado e o `aria-current`, e ganhou `onNavigate` (fecha a gaveta) e `idPrefix` (ids únicos quando há duas instâncias).
  - `console-shell.tsx`: barra lateral `lg+` com o título "Console" e a pílula do papel. Abaixo de `lg` entra o botão "Console · <seção>", que abre a mesma nav numa gaveta de baixo. O cabeçalho mostra o grupo, o `h1` da seção e a descrição. O conteúdo vai em `.admin-panels`.
  - `globals.css`: `.admin-panels > section` e `.admin-panels > div > section` viram card (surface, borda, `radius-lg`, padding), dentro de `@layer components`. Dentro do card, `--color-surface` é redefinida um degrau na direção do texto (`color-mix`), para as caixas e os campos `bg-surface` das seções não sumirem no card.
  - `/admin` agora leva o admin para `/admin/users` (1º link). O curador continua indo para a Moderação. O `AccessDenied` dentro do shell usa `h2`, porque o `h1` já é o título da seção.
- **Lista de Usuários** (substitui `roles-section.tsx`, que foi apagada junto com o teste dela):
  - Domínio puro em `src/domain/admin-user-list.ts`: atalhos, ordenações, `parseAdminUserListQuery` (valor desconhecido cai no padrão, página até 400), `deriveAdminUserStatus`, o DTO `AdminUserListItem` e os formatadores de data e tempo relativo.
  - Loader em `src/server/admin/user-list.ts` (`listAdminUsers`): WHERE fixo por atalho, busca via `classifyUserQuery` (texto casa nome ou handle; email só com `@`), contagens com `count(*) FILTER`, e subconsultas por linha para a última sessão e as receitas (total e públicas). `pendingPurgeAt` = marcador + `PENDING_SIGNUP_MAX_AGE_MS`.
  - Rota `GET /api/admin/users` (`requireRole 'admin'`, resposta com `no-store`).
  - UI em `users-section.tsx`: atalhos com contagem (`aria-pressed`), busca com debounce de 300 ms, ordenação, tabela no `md+` e lista no celular, paginação. A gaveta de detalhes (`sm:max-w-xl lg:max-w-2xl`) mostra email, situação, plano, datas, receitas, idioma, geração de imagem e ID (com botão de copiar), mais o link do perfil (só para conta ativa ou não confirmada) e o papel em radio com "Aplicar papel". A gaveta não fecha com o PUT em voo e, ao fechar, devolve o foco ao botão que a abriu. Enquanto a sessão carrega, o papel fica travado. Se a lista encolher e a página atual passar da última, a tela volta para a última página.
- **`PUT /api/admin/roles`** valida o `userId` como uuid e recusa o próprio papel com `400 { error: 'papel_proprio' }`. A comparação é feita em minúsculas, porque o Postgres aceita o uuid em maiúsculas. Conta desativada recebe `409 { error: 'papel_conta_inativa' }`.
- **Gavetas mais largas:** "Criar" (`create-drawer.tsx`) e a de criar receita do Catálogo (`catalog-recipe-drawer.tsx`) agora usam `sm:max-w-2xl lg:max-w-3xl` (672 e 768 px).
- **Mensagens** (pt-BR e en-US): `titulo` virou "Console"; `navPapeis` virou `navUsuarios`; entraram `grupoPessoas`, `abrirSecoes`, `desc*` e o bloco `usuarios*`. Saíram as chaves da busca de Papéis (`papeisTitulo`, `buscaUsuario*`, `usuarioSelecionado`, `trocarUsuario`, `papelLabel`).
- **Testes:** `test/integration/admin-user-list.test.ts` (gate, cada atalho, busca por @handle, email e ID, colunas derivadas, ordenações, allowlist, contagens, teto de página, `no-store`); caso `papel_proprio` em `roles.test.ts`; `test/ui/admin-users-section.test.tsx`, `admin-console-shell.test.tsx` e `admin-section-nav.test.tsx` reescrito; largura da gaveta em `create-drawer-lazy.test.tsx`.

## 2. Landmines

- **Subconsulta correlacionada no Drizzle:** numa select de tabela única, `${users.id}` sai como `"id"`, sem o nome da tabela, e dentro de `(select … from recipe r where r.owner_id = ${users.id})` isso resolve para `r.id`. As contagens davam 0 sem erro. Escreva `users.id` literal no SQL (como já fazia o `searchCooks`).
- **Seção nova do Console** = entrada em `console-sections.ts` + chaves `nav*`/`desc*` nas duas línguas + `page.tsx` com `SectionGate`. Sem a entrada, a página fica sem cabeçalho e sem link. Rota nova sob `src/app/[locale]` ainda precisa ir para o `CLIENT_ROUTE_TREE` (ADR-0048); esta mudança não criou nenhuma.
- **Card automático:** só o `<section>` de 1º nível (ou filho do `<div>` de página) vira card. Um componente que renda `<div>` na raiz fica sem card. Para tirar o padding de um card, use utilitário na própria seção (`p-0 sm:p-0`, como a tabela de Usuários).
- **Cores:** pílula de papel e cadastro pendente usam páprica. Erva e âmbar estão proibidos fora dos selos deles (ADR-0015).
- **jsdom:** a tabela e a lista do celular estão ambas no DOM; nos testes, pegue o primeiro botão de cada conta.
- **Postgres local para o Vitest:** sem Docker, instale `postgresql-17` + `postgresql-17-pgvector` (repo pgdg). Com PG 16 as migrações falham (`unsafe use of new value "web_imported"`). Suba um cluster em loopback e rode `TEST_DATABASE_URL=postgres://postgres@localhost:5433/postgres npx vitest run`, com a variável inline, nunca `export`.

## 3. Critério de saída

"checks" e "e2e" verdes no PR. Local: typecheck, lint, a suíte do Vitest inteira e o painel de revisores limpo. Depois do deploy: abrir `/admin/users` em produção, conferir as contagens da tira contra o banco e mudar o papel de uma conta de teste.

## 4. Próximos passos possíveis (não pedidos)

- Guardar atalho, busca e página na URL (hoje ficam só no estado).
- Ações na gaveta de detalhes além do papel: conceder Pro (hoje fica na aba Plano) e bloquear geração de imagem (hoje fica na Moderação).
- Remover `GET /api/admin/users/search` (#269), que ficou sem consumidor na UI.
