# Handoff 62 — Restrições alimentares salvas no perfil (ADR-0041)

**Sessão:** 2026-10-13. **Branch:** `claude/project-thread-e6iox3-diet` (a partir de `main` em 4a0ca65). **Migração:** `0073_users_restricoes`. **Merge:** pendente (PR a abrir pelo orquestrador).

Documento auto-suficiente: o que entrou, onde mora no código, o que não pode regredir e o que ficou de follow-up.

---

## 1. O que foi entregue

O dono pediu que a pessoa deixe de redigitar as Restrições alimentares a cada pedido: uma lista salva por pessoa, aplicada por padrão e mudável em cada pedido.

- **Dado:** `users.restricoes` (`restricao[]`, NOT NULL default `'{}'`), forma canônica (sem repetição, ordem de `RESTRICOES`).
- **Perfil:** seção "Restrições alimentares" no `/me/profile`, separada do formulário do perfil (que é quase todo público), com "Só você vê", o propósito e como apagar destacados junto do "Salvar". Rota `GET/PUT /api/me/restricoes` (owner-only, zod contra o vocabulário, `no-store`).
- **Default nos pedidos** (sempre visível, sempre mudável; Visitante não vê diferença):
  - Formulário estruturado (wizard do drawer): pré-marcadas no passo 2 com "Marcadas a partir do seu perfil"; "Criar outra" volta ao default.
  - Prompt aberto: chips "Considerar suas restrições" (só as salvas, já marcadas; tocar tira). Sobem em `restricoes` no `POST /api/generations` e viram a linha `Restrições:` do `userPrompt`.
  - Conversa: os mesmos chips acima do "Enviar"; `restricoes` vai em cada turno do stream e entra no systemPrompt das duas chamadas (resposta e destilação).
  - Cardápio, "Sugerir com IA": pré-marcadas com a indicação e "Editar no perfil".
  - Busca: só ao refinar (termo, cozinha ou categoria) — a trilha marca as do perfil e o aviso "Mostrando só receitas que declaram: … (do seu perfil) · Mostrar tudo" aparece acima dos resultados. O repouso (feed da home) não muda.
- **LGPD:** `account.restricoes` (e `nivelPadrao`, que faltava) no export; eliminação zera `restricoes` e `nivelPadrao` (a linha `users` sobrevive anonimizada).
- Guia "Como usar" (item em "Conta e preferências", pt-BR e en-US), `CONTEXT.md` (**Restrição alimentar** → Restrições salvas), ponteiro no ADR-0036.

## 2. O que ler primeiro

1. `docs/adr/0041-restricoes-no-perfil.md`.
2. `src/domain/restricoes-perfil.ts` — `parseListaRestricoes` (zod), `restricoesEfetivas`/`alternarRestricao`/`vemDoPerfil` (a "seleção com default") e `restricoesDaBusca`/`restricaoEhCriterio` (a regra da Busca).
3. `src/components/profile/restricoes-perfil-provider.tsx` (contexto no layout, carga preguiçosa), `restricoes-perfil-form.tsx`, `restricoes-perfil-hint.tsx`, `restricoes-pedido-chips.tsx`.
4. `src/app/api/me/restricoes/route.ts`; o campo `restricoes` em `src/app/api/generations/route.ts` (ramo `free_text`) e `src/app/api/conversations/stream/route.ts`; `buildFreeTextPrompt`/`buildConversationPrompt`/`comRestricoesPedidas` em `src/domain/briefing.ts`.

## 3. Princípios inegociáveis (não regredir)

- **O default nunca age calado.** Toda superfície que aplica as salvas diz que vieram do perfil e deixa tirar. Um filtro invisível é bug.
- **O primeiro toque é da pessoa.** Depois de mexer, nem o perfil carregando depois nem um perfil salvo em outra aba muda a seleção daquele pedido. "Vazio" é uma escolha válida.
- **O repouso da home é igual para todos.** As salvas sozinhas não filtram o feed nem viram critério de busca.
- **Dado sensível, mínimo e privado.** Fora da sessão do Better Auth (não é `additionalField`), fora do `/api/me` e do perfil público, nunca em log, nunca no `prompt_stamp`, `no-store`. Entra no export; zera na eliminação. Toda coluna nova de dado do Usuário segue o mesmo checklist (export, eliminação, expurgo de cadastro pendente).
- **Sem restrições, os prompts são byte-a-byte os de antes** (regeneração #20 e call sites antigos dependem disso).

## 4. Landmines

- **`restricao` no `search-experience.tsx` é memoizado** (`useMemo`): entra nas deps do `doSearch` e do reflexo de URL. Um array novo a cada render relança a busca em laço.
- **A regeneração (#20) não reaplica** restrições pedidas no Prompt/Conversa (não são gravadas). Se alguém quiser isso, decidir antes onde guardar (é dado sensível) — ver ADR-0041, alternativas.
- **O Prompt aberto só oferece as salvas.** O ramo estruturado legado do mesmo componente (`CreateStructuredExperience` fora do drawer) oferece todas; o envio do `free_text` filtra pela interseção com o perfil.
- **Ambiente local:** como no handoff 61 — PG 16 do container não roda as migrações numa transação só; integração usa Testcontainers (pgvector pg17, `dockerd &` se o Docker não estiver de pé). `TEST_DATABASE_URL`/`DATABASE_URL` nunca exportados. `drizzle-kit generate` não precisa de banco.

## 5. Testes

- `test/domain/restricoes-perfil.test.ts` — validação, forma canônica, seleção com default, regra da Busca.
- `test/unit/briefing.test.ts` — `Restrições pedidas…`: free_text e conversa com/sem restrições (byte-a-byte sem).
- `test/integration/me-restricoes.test.ts` — rota (401, default `[]`, canônica, limpar, 400, sem IDOR, não vaza no `/api/me`), export, eliminação, `free_text` e stream recebendo as restrições, 400 antes do seam.
- `test/ui/restricoes-perfil.test.tsx` — seção do perfil, Visitante, wizard, Prompt aberto (com e sem salvas), Conversa, Sugestão de cardápio e Busca (repouso, aviso, "Mostrar tudo").

## 6. Pendências e follow-ups

- **Jurídico (dono, #276) — a política de privacidade precisa ganhar:** (a) a categoria "Restrições alimentares que você salva no perfil (ex.: vegana, sem glúten, sem frutos do mar)", tratada como **dado pessoal sensível** (pode revelar saúde ou convicção religiosa — LGPD Art. 5 II); (b) finalidade única: pré-marcar os seus pedidos de criação, Sugestão de cardápio e busca; (c) base legal: consentimento específico e destacado (Art. 11 I) — dado ao salvar, com o texto ao lado do botão; revogável desmarcando tudo e salvando; (d) só o titular vê; não vai ao perfil público nem a terceiros, exceto ao provedor de IA (Anthropic, operador, transferência internacional) quando a pessoa gera uma receita ou pede uma sugestão com elas marcadas — e, nesse caso, só naquele pedido; (e) entra no export (`account.restricoes`) e é apagada na eliminação da conta. Junto: citar também o Nível de habilidade padrão no export (entrou agora). Mesmo bloco pendente do Cardápio, da Lista e da Despensa.
- Restrições no seletor de receita do Cardápio, nos Salvos e na Despensa (não entraram; avaliar se o dono quer).
- Dos handoffs anteriores: descontar da Despensa ao cozinhar, básicos configuráveis, trocar um item da prévia da Sugestão, editar anotação na linha, copiar de uma semana qualquer.

## 7. Critério de saída

PR desta branch mergeado com o painel de revisão limpo e o "checks" verde; migração 0073 aplicada no build da Vercel (`npm run db:migrate`); deploy de produção; verificação manual em produção: salvar restrições no perfil → abrir "Criar" (Estruturado, Prompt, Conversa), "Sugerir com IA" e uma busca e ver a indicação; memória do projeto atualizada.

---

## Kickoff da próxima sessão (colar como primeira mensagem)

```
Leia docs/handoffs/62-restricoes-no-perfil-adr-0041.md e o ADR-0041. As Restrições alimentares salvas no perfil (users.restricoes, migração 0073) viram o default pré-marcado na criação, na Sugestão de cardápio e na Busca, sempre com indicação visível e mudáveis em cada pedido. Primeiro passo: confirmar que o PR desta branch foi mergeado e a migração 0073 aplicada em produção; depois, levar ao dono o texto da política de privacidade da seção 6 ou seguir um follow-up da seção 6. Seguir o fluxo de 8 passos do CLAUDE.md e respeitar os princípios da seção 3.
```
