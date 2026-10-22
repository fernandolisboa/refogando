# ADR-0049 — Console com barra lateral e lista de Usuários

Status: aceito

Pedido do Fernando em 2026-10-22: a aba "Papéis" exigia já conhecer o usuário (buscar por nome, @handle, email ou ID) para atribuir um papel, e não havia como ver quem são as contas. O layout do Console, uma tira de abas com rótulos de grupo, também foi considerado pouco profissional. O rascunho aprovado está no artifact "Admin Refogando: novo layout".

## Decisão

1. **Navegação em barra lateral, com três grupos.** Os grupos são Pessoas (Usuários, Plano), Plataforma (IA, Descoberta, Comparador, Cozinhas, Site) e Curadoria (Moderação, Traduções, Catálogo), cada link com ícone. O mapa das seções fica num lugar só, `src/components/admin/console-sections.ts`, de onde saem os links e o cabeçalho de cada página (grupo, título `h1` e descrição). No celular e no tablet (abaixo de `lg`), a barra lateral vira um botão "Console · <seção>" que abre a mesma navegação numa gaveta de baixo. Pessoas e Plataforma continuam escondidos do Curador. O gate de verdade continua no `SectionGate` de cada `page.tsx` (#125).

2. **Seções como cards, sem wrapper por página.** O `ConsoleShell` põe a classe `admin-panels` em volta do conteúdo. Em `globals.css` (`@layer components`), essa classe pinta como card todo `<section>` que é filho direto ou filho do `<div>` de página. Os componentes de seção não mudam. Um utilitário da própria seção (ex. `p-0`) vence a regra.

3. **"Papéis" vira "Usuários" (`/admin/users`, admin-only).** A lista é paginada no servidor (`GET /api/admin/users?preset=&q=&sort=&page=`, 25 por página, página até 400). Os atalhos formam um enum fechado e cada um vira um WHERE fixo no servidor: `todos` (sem as desativadas), `novos` (7 dias), `sem-papel`, `equipe` (curador ou admin), `pendentes` (`pending_signup_at`), `pro` e `desativadas` (`deleted_at`, inclui as eliminadas). A tira mostra a contagem de cada atalho, sem a busca, numa só varredura com `count(*) FILTER`. A busca reusa o `classifyUserQuery` (#269): texto casa nome ou handle, que têm índice trigram, e o email entra quando o termo tem `@`, como no `searchUsers`. "Último acesso" é a última atualização de uma sessão ainda guardada; sem sessão, a lista mostra "Sem sessão".

4. **O papel muda na gaveta de detalhes.** O admin escolhe o papel e aplica. Não há mudança direto na linha: um clique errado lá mudaria o papel de alguém sem confirmação. O `PUT /api/admin/roles` passa a recusar o próprio papel (`400 papel_proprio`), porque um clique errado tiraria o único acesso de admin. Outro admin, ou `npm run grant-role`, faz essa troca. O id passa a ser validado como uuid e comparado em minúsculas, porque o Postgres aceita o uuid em maiúsculas e isso furaria a trava. Conta desativada ou eliminada recebe `409 papel_conta_inativa`. A UI desabilita os dois casos antes de chegar ao servidor.

5. **Dados pessoais.** Email só aparece para admin (como já era na busca de Papéis) e a resposta da lista é a allowlist `AdminUserListItem`. Ficam de fora `banReason`, restrições alimentares, básicos da Despensa e links. A resposta vai com `cache-control: no-store` e nada da tela vai a log. Conta eliminada (LGPD Art. 18 VI) aparece só em "Desativadas", com o que sobrou da anonimização.

6. **Cores.** O papel aparece em pílula de páprica: Admin preenchida, Curador com borda, Usuário neutra. O cadastro pendente aparece em texto de marca. Erva e âmbar ficam fora (ADR-0015).

## Consequências

- Seção nova do Console = uma entrada em `console-sections.ts` (rota, rótulo `nav*` e descrição `desc*` nas mensagens), mais a `page.tsx` com o seu `SectionGate`.
- A ordenação por último acesso calcula a subconsulta de sessão para todas as linhas filtradas. Com centenas de contas não pesa. Se `users` crescer muito, isso vira coluna `last_seen_at`.
- `GET /api/admin/users/search` (#269) ficou sem consumidor na UI. Continua de pé, coberto pelo próprio teste, até alguém decidir removê-lo.
- A gaveta "Criar" foi de 512 px para 672 px no tablet e 768 px no desktop. A de criar receita do Catálogo e a de detalhes do usuário seguem a mesma ideia: o Fernando quer gavetas largas.
