# ADR-0041 — Restrições alimentares salvas no perfil (default dos pedidos)

Status: aceito

O dono (2026-10-13) notou que a pessoa redigita as mesmas Restrições alimentares a cada pedido — ao criar uma Receita e ao pedir a Sugestão de cardápio — e pediu uma lista salva por pessoa, aplicada por padrão e mudável em cada pedido. Era um follow-up listado desde o handoff 56 ("preferências de restrição no perfil"). Termo no `CONTEXT.md` (**Restrição alimentar** → **Restrições salvas**). Relaciona: ADR-0004 (Aviso de restrição: declarado, não verificado), ADR-0029 (eixos do prompt e Nível de habilidade padrão — o precedente de "default do perfil"), ADR-0036 (Sugestão de cardápio), ADR-0021 (drawer de criação), ADR-0010 (route handler, não Server Action).

## Decisões

1. **Uma lista por Usuário, na própria linha `users`.** `users.restricoes`, mesmo tipo de `recipe.restricoes` (`restricao[]`, NOT NULL default `'{}'`; vazio = nenhuma). Gravada na forma canônica (sem repetição, na ordem do vocabulário `RESTRICOES`). **Rejeitado:** tabela própria (é uma lista curta e fechada, 1:1 com a conta); levar a lista na sessão do Better Auth como `additionalField` (o dado sensível iria em todo payload de sessão); um texto livre de "dieta" (o vocabulário controlado é o que os filtros e o gate da Sugestão já entendem).

2. **Rota própria e seção própria no perfil.** `GET/PUT /api/me/restricoes`, owner-only (`requireSession`), validada com zod contra o vocabulário (`parseListaRestricoes`: qualquer valor desconhecido recusa a lista inteira com 400 `restricoes_invalidas` — nada some em silêncio), `cache-control: no-store`. No `/me/profile`, uma seção "Restrições alimentares" separada do formulário do perfil, com o seu próprio "Salvar", a frase "Só você vê" e o propósito + como apagar destacados junto do botão. **Rejeitado:** pôr o campo no `PATCH /api/me` ao lado do Nível padrão — aquele contrato é o do perfil, quase todo PÚBLICO (nome, bio, links), e o GET dele seria lido por qualquer tela que precise do perfil. Server Action não (ADR-0010).

3. **Default pré-marcado, nunca trava e nunca age calado.** Regra única (`@/domain/restricoes-perfil`, "seleção com default"): enquanto a pessoa não mexe, valem as do perfil; o primeiro toque torna a seleção dela (inclusive vazia, e um perfil salvo em outra aba depois não atropela). Toda superfície mostra de onde veio ("Marcadas a partir do seu perfil" / chips "Considerar suas restrições" / aviso da Busca). O perfil chega por um contexto client montado no layout, com carga preguiçosa (só busca quando uma superfície pede) e `null` para Visitante — o Visitante não vê nada diferente. Por superfície:
   - **Formulário estruturado (wizard):** as salvas vêm marcadas no passo 2 e vão no `briefing.restricoes` como uma escolha explícita (Aviso pré-geração incluso). "Criar outra" volta ao default.
   - **Prompt aberto:** não tinha campo de restrição. Mostra só as salvas, já marcadas ("Considerar suas restrições"); tocar tira deste pedido. Sobem em `restricoes` (top-level, validadas como no briefing — 400 `restricao_invalida`) e entram como a MESMA linha `Restrições:` do briefing no `userPrompt`, que o prompt-base já manda respeitar estritamente. Quem não salvou nada vê a tela de antes. Não oferecemos o vocabulário inteiro aqui (aí seria o estruturado): uma restrição a mais vai no próprio texto.
   - **Conversa:** mesmos chips, acima do "Enviar"; valem a partir do turno seguinte ao toque. Vão em CADA turno (`restricoes` no corpo do stream) e entram no systemPrompt das DUAS chamadas — a resposta breve e a destilação —, porque a Transcrição vai verbatim (defesa de rótulo de papel). Não são gravadas na Session.
   - **Sugestão de cardápio:** pré-marcadas no pedido; o filtro continua o do ADR-0036 (duro, sobre o que as Receitas declaram).
   - **Busca:** só quando a pessoa **refina** (termo, cozinha ou categoria) e não mexeu na faceta: a trilha marca as do perfil e um aviso acima dos resultados diz "Mostrando só receitas que declaram: … (do seu perfil)" com **"Mostrar tudo"**. No repouso nada muda: a home continua mostrando o feed sem filtro (o mesmo para todos; o feed não tem faceta e a trilha não marca nada que não esteja aplicado). Uma restrição marcada à mão segue sendo critério, como antes.
   - **Fora:** a regeneração (#20) não reaplica restrições a pedidos de Prompt/Conversa (elas não são gravadas; reaplicar as do perfil contrariaria quem as tirou de propósito naquele pedido). O seletor de receita do Cardápio, os Salvos e a Despensa não ganharam filtro.

4. **Não é eixo do ADR-0029.** Eixos são carimbados em `generation.prompt_stamp` para correlação de qualidade; a lista é dado sensível e não precisa morar lá. As restrições pedidas no Prompt e na Conversa ficam só no prompt daquela chamada; o que persiste é o que a Receita entregue declara (e, no estruturado, o `briefing.restricoes`, como sempre).

5. **Dado sensível (LGPD Art. 5 II / Art. 11).** Uma lista como "vegana" ou "sem frutos do mar" pode revelar convicção religiosa ou condição de saúde. Mínimo: só o enum, nada de texto livre, data ou motivo; nunca logada (nenhum `console.*` toca a lista; o fragmento do prompt não vai a log); fora da sessão e do perfil público; `no-store`. **Export** (`account.restricoes`, junto do `nivelPadrao`, que faltava) e **eliminação**: a linha `users` sobrevive anonimizada à eliminação, então a lista é ZERADA ali (e o `nivelPadrao` também, outra lacuna); o expurgo de cadastro pendente apaga a linha inteira (nenhuma FK nova). Ela vai ao provedor de IA (Anthropic) só quando a pessoa gera com ela marcada — o mesmo caminho do briefing de sempre.

## Consequências

- **Migração 0073** (`0073_users_restricoes`): `ALTER TABLE users ADD COLUMN restricoes restricao[] DEFAULT '{}' NOT NULL` (default constante: metadata-only, sem rewrite).
- Domínio: `@/domain/restricoes-perfil` (validação zod, forma canônica, seleção com default, regra da Busca). `@/domain/briefing` ganha o parâmetro `restricoes` em `buildFreeTextPrompt`/`buildConversationPrompt` e `comRestricoesPedidas` — vazio é byte-a-byte o prompt de antes.
- Servidor: `src/app/api/me/restricoes/route.ts`; `restricoes` aceito em `POST /api/generations` (só `free_text`) e em `POST /api/conversations/stream`; export e eliminação.
- UI: `RestricoesPerfilProvider` (layout), `RestricoesPerfilForm` (perfil), `RestricoesPerfilHint`, `RestricoesPedidoChips`; wizard, Prompt aberto, Conversa, Sugestão de cardápio e Busca.
- Guia "Como usar": um item em "Conta e preferências" (pt-BR e en-US).
- **Jurídico (dono, #276):** a política de privacidade precisa citar as Restrições salvas (ver handoff 62, seção 6).

## Alternativas rejeitadas

- **Aplicar as salvas no servidor quando o pedido não traz nenhuma** (como o Nível padrão): "vazio" ficaria ambíguo entre "não mexi" e "tirei todas", e a pessoa não veria o que foi aplicado.
- **Filtrar o feed da home pelo perfil**: o repouso é a porta indexável e igual para todos (ADR-0020); um filtro invisível esconderia receitas sem aviso.
- **Gravar as restrições pedidas no Prompt/Conversa** (coluna em `creation_session` ou no carimbo) só para a regeneração reaplicá-las: mais dado sensível guardado para um ganho pequeno.
- **Pôr no `PATCH /api/me`**: ver dec.2.
