# Handoff 59 — Guia de uso ("Como usar") e tour guiado (ADR-0039)

**Sessão:** 2026-09-28. **Branch:** `claude/onboarding-guide-tour-f0p4x3` (um PR). **Migração:** nenhuma (o estado do tour fica no localStorage; ADR-0039 dec.3).

Documento auto-suficiente: o que a feature é, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

- **Página "Como usar" (`/guia`)**, pública e indexável (entrou no `sitemap.xml`). Oito seções em texto (encontrar receitas, criar com IA, página da receita, Salvos e coleções, Lista de compras, Cardápio, Comunidade, Conta), índice por âncora e o botão **"Fazer o tour guiado"**. Link no rodapé (todos) e no menu da conta (logado).
- **Tour guiado**: tela escurecida, um componente da chrome destacado por passo (contorno páprica), cartão com "Passo N de M", título, texto, Voltar/Próximo. 7 passos logado (boas-vindas, busca, Criar, Salvos, Cardápio, conta, fim) e 5 para o Visitante (sem Salvos e Cardápio). No celular os itens da nav caem no botão do menu com a linha "No celular, fica no menu ☰".
- **Dispensável em qualquer passo**: X e Esc em todos; "Agora não" no 1º e "Pular tour" nos do meio. Fechar antes do último grava `dismissed`; "Concluir", "Ver o guia completo" ou fechar no último gravam `done`. Clicar fora não fecha; sair da home (voltar do navegador) fecha sem gravar.
- **Abre sozinho uma vez** para conta criada há até 14 dias, na home, sem registro no dispositivo. Conta antiga e Visitante nunca veem o tour sozinhos; qualquer um refaz pelo `/guia`.

## 2. O que ler primeiro

1. `docs/adr/0039-guia-de-uso-e-tour-guiado.md` — as 6 decisões.
2. `CONTEXT.md` — **Guia de uso** e **Tour guiado**.
3. `src/domain/onboarding-tour.ts` — passos, âncoras, `shouldAutoStartTour`, `placeTourCard` (kernel puro).
4. `src/components/onboarding/guided-tour.tsx` — a casca (Radix Dialog + recorte), montada em `src/app/[locale]/layout.tsx`.
5. `src/components/onboarding/tour-signal.ts` — o pedido do `/guia` (sessionStorage + evento).
6. `src/components/onboarding/usage-guide.tsx` e `src/app/[locale]/guia/page.tsx`.
7. Âncoras `data-tour` em `src/components/site-header.tsx`; "Como usar" em `auth-slot.tsx` e `site-footer.tsx`.
8. Textos: `messages.tour` e `messages.guia` (pt-BR e en-US).

## 3. Princípios inegociáveis (não regredir)

- **O tour sempre tem saída**: X e Esc em todo passo, mais "Agora não" no primeiro e "Pular tour" nos do meio.
- **Nunca abre sozinho para Visitante nem para conta antiga**, e nunca fora da home. A busca do Visitante não pode ser bloqueada.
- **Storage ilegível ⇒ não abre sozinho** (sem memória ele voltaria a cada visita).
- **`done` não é rebaixado** por um "pular" posterior.
- **Paridade do guia**: cada `*Itens` tem a mesma quantidade de itens em pt-BR e en-US (o teste recursivo de mensagens exige).

## 4. Landmines

- **O recorte é `box-shadow`**: o destaque usa `outline`, não `ring` (o ring do Tailwind também é box-shadow e sumiria). O scrim é preto (não `bg-fg/40`): no tema escuro `fg` é creme e clarearia a tela.
- **Cartão transparente antes da 1ª medida, nunca `visibility:hidden`**: o navegador não foca nada invisível, e o foco no botão principal do 1º passo se perderia.
- **Pedido do /guia expira em 30s** (`TOUR_START_TTL_MS`); o evento abre na hora quando o pedido nasce já na home, mesmo com o storage bloqueado.
- **`react-hooks/set-state-in-effect`**: a medida do alvo roda num `requestAnimationFrame` (e em resize/scroll), não direto no corpo do efeito. Não "simplificar" para `measure()` síncrono: o lint barra.
- **Testes de "não abre"** usam relógio falso (`AUTO_START_DELAY_MS` exportado) em vez de esperar de verdade.
- **Timer da abertura automática**: a checagem por usuário é marcada DENTRO do timer, não antes. A sessão é re-buscada a cada navegação (AuthSlot), o efeito re-roda e limparia um timer já marcado como "checado", e o tour nunca abriria.
- **Âncora escondida no celular**: a visibilidade é por `getClientRects()`/tamanho; a nav do desktop existe no DOM com `display:none`. Uma âncora nova precisa ter caixa visível para ser destacada.
- **No jsdom não há layout**: os testes simulam `getBoundingClientRect`/`getClientRects` nas âncoras (ver `test/ui/guided-tour.test.tsx`).
- **Build local** precisa de `BETTER_AUTH_SECRET` (como no CI); sem banco, a home cai no "Algo deu errado", mas header, `/guia` e o tour funcionam para conferência visual.

## 5. Pendências e follow-ups

- **Despensa (#560, ADR-0038)**: quando mergear, adicionar uma seção em `messages.guia` (pt-BR e en-US) e, se ficar na nav, um passo `despensa` com âncora `nav-despensa` em `TOUR_STEPS`.
- **Estado do tour no servidor**: se o dono quiser que "dispensei" valha em todos os dispositivos, uma coluna `users.tour_state` substitui a chave do localStorage (o kernel já recebe o estado como entrada). Exige a vez da migração.
- **Tours por página** (ex.: um mini-tour do Cardápio na primeira visita) reusariam a mesma casca com outra lista de passos.
- **Manter o guia em dia**: toda feature visível nova atualiza `messages.guia`.

## 6. Critério de saída

PR mergeado com o painel de revisão limpo e o "checks" verde; deploy de produção com `/guia` no ar; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/59-guia-de-uso-e-tour-guiado-adr-0039.md e o ADR-0039. O guia "Como usar" (/guia) e o tour guiado entraram na main pelo PR #561. Próximo passo sugerido: se a Despensa (#560) já estiver na main, incluí-la no guia e no tour (seção 5); senão, um dos follow-ups do handoff 57. Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
