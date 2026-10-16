# ADR-0046 — Modelos de texto: só Haiku, Sonnet e Opus, com troca automática de versão após chamada de teste

Status: aceito

Revisa ADR-0033 (dec.1 famílias, dec.2 "o modelo em uso não troca sozinho", dec.3 fallback) e ADR-0034 (dec.3 defaults, dec.5 "rejeitado: tabela de quem desliga o thinking"). Afeta os defaults do ADR-0030 (tradução), ADR-0036 (cardápio) e ADR-0044 (cenário).

O dono pediu (2026-10-16) para o app usar só Haiku, Sonnet e Opus, os três na 5.5, e, como a Anthropic lança versão nova com frequência, que a troca de versão fosse automática: "sempre que lançam versão nova tenho que solicitar ajuste no app". Entre "automático com teste" e "só avisar", escolheu o automático com teste.

## Decisões

1. **Famílias selecionáveis: Opus, Sonnet e Haiku** (`SELECTABLE_FAMILIES`). Fable e Mythos saem da lista. A regra continua a do ADR-0033: o mais novo de cada família segundo a Models API; hoje Opus 5.5, Sonnet 5.5 e Haiku 5.5. Fallback pinado com os mesmos três. Default das tarefas que não são a Geração: `claude-sonnet-5-5` (Geração segue `claude-opus-5-5`).

2. **O modelo em uso troca sozinho, dentro da família, só depois de uma chamada de teste aceita.** Revoga ADR-0033 dec.2. Cron diário `/api/cron/ai-models` (11:00 UTC): para cada tarefa com "Atualizar sozinho" ligado, pega o mais novo da mesma família na lista VIVA (API fora ⇒ nada muda; nunca usa a lista pinada para trocar), confere que ele é MAIS NOVO que o em uso (`createdAt` na lista ou, se o em uso não está listado, a versão do ID; nunca rebaixa) e testa ajustes em ordem (`upgradeCandidates`): o já salvo para o modelo novo; o ajuste de hoje, sem esforço que o modelo novo não oferece; se o thinking de hoje é "desligado", os outros jeitos de desligar (`off`, `betweenTools`) e o default do modelo; por fim o default da tarefa para o modelo novo. O primeiro aceito é gravado (modelo + ajuste, sob lock, conferindo que o admin não mudou a tarefa no meio). Todos recusados ⇒ fica no atual e loga o último motivo da API; teste indisponível ⇒ a passada para e tenta amanhã. Orçamento: nenhuma chamada de teste começa depois de 35s (a rota tem 60s); o mesmo (modelo, ajuste) é testado uma vez só por passada. Família nunca muda sozinha. A trava do ADR-0033 (não trocar para um modelo que quebra a chamada) continua, agora sem depender de alguém salvar.

3. **Interruptor por tarefa** `ai_tasks.<tarefa>.auto` (jsonb, sem migração de schema), ligado por padrão, editável no admin ("Atualizar sozinho para a versão nova da família"). Desligado ⇒ a tarefa fica fixa na versão escolhida. O PUT aceita `auto` opcional; ausente mantém o salvo.

4. **Novo modo de thinking `betweenTools`** ⇒ `thinking: {type: 'between_tools'}`, o nível mais baixo do Sonnet 5.5 (que recusa `disabled`). O admin escolhe "Mínimo (só entre ferramentas)"; a chamada de teste decide se o modelo aceita. O SDK pinado (0.104) não tipa o valor; os pontos de chamada fazem cast (a API aceita, o SDK repassa).

5. **Defaults por modelo para "thinking desligado"** (`defaultSettings`, por família e versão mínima): Sonnet ≥ 5.5 ⇒ `betweenTools`; Opus ≥ 5.5 e Fable ⇒ default do modelo (não desliga); Haiku e o resto ⇒ a base da tarefa (`off`; o Haiku 5.5 aceita). Revisa ADR-0034 dec.5: a regra só semeia o DEFAULT. Quem decide o que vale continua sendo a chamada de teste (ao salvar e no cron), que grava o ajuste aceito em `byModel`; um modelo que a regra erra usa um default recusado só até o cron ou o admin gravar um ajuste testado.

6. **`effort` vai para quem aceita** (`acceptsEffort`): as três famílias, menos o Haiku 4.5 legado (400 com `effort`). Haiku 5.5 aceita (default `medium`).

7. **A troca para a 5.5 em produção vai numa migração SEPARADA (0079), depois deste código no ar.** A migração roda no build da Vercel, enquanto o código anterior ainda serve; o código anterior mandaria `thinking: disabled` ao Sonnet 5.5 (400) nas tarefas sem ajuste salvo. A 0079 move `default_model` e `ai_tasks.<tarefa>.model` para a 5.5 do mesmo nível (Fable ⇒ Opus 5.5); os `byModel` antigos ficam e o modelo novo sem ajuste usa `defaultSettings`. `generation.model` das Receitas não é tocado. Mesmo padrão do ADR-0033 dec.4.

## Consequências

- Versão nova de uma família entra em produção no dia seguinte ao lançamento sem deploy, se a chamada de teste passar. O comportamento (custo, latência, estilo) pode mudar sem aviso prévio; a linha `[ai-models] <tarefa>: A → B (…)` nos logs da Vercel registra cada troca.
- Modelo novo sem linha em `TEXT_PRICE_TABLE` gera com custo nulo até alguém cadastrar o preço; o cron loga `[ai-models] <id> sem preço em text-cost.ts`. Preços adicionados: Sonnet 5.5 $2/$10, Haiku 5.5 $0,10/$0,50 (prompt até 100K tokens).
- Cada passada custa poucas chamadas mínimas (no máximo 5 ajustes por modelo novo, sem repetir), e só quando há versão nova.
- Haiku 5.5 não tem fallback de recusa no servidor e recusa `temperature`/`top_p`/`top_k` não-default; o app não manda `fallbacks` nem parâmetros de amostragem.
- Uma tarefa num modelo que a Models API não lista e cujo ID não dá para comparar fica parada (`naoMaisNovo`); o admin troca à mão.
- Modelo novo sem preço: a troca acontece mesmo assim (o dono pediu que versão nova entre sem pedir ajuste), e o custo dessas gerações fica nulo até cadastrar o preço, o que o painel de custo não soma. O log avisa.
