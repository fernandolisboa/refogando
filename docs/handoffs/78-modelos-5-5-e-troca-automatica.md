# Handoff 78 — Modelos Haiku, Sonnet e Opus 5.5, com troca automática de versão

**Sessão:** 2026-10-16. **Branch:** `claude/modelos-ia-5-5-kozvv4` (sobre a main em `27fdfef`, depois do #585). **Migração:** nenhuma neste PR; a 0079 (só dados) vai num PR seguinte, depois deste código no ar. **ADR:** 0046 (revisa 0033 e 0034). Origem: o dono pediu só Haiku, Sonnet e Opus na 5.5 e, como lançam versão nova com frequência, que a troca fosse automática (escolheu "automático com teste").

## 1. O que mudou

- **Lista**: `SELECTABLE_FAMILIES = ['opus', 'sonnet', 'haiku']` (`src/domain/claude-models.ts`); fallback pinado Opus/Sonnet/Haiku 5.5; `DEFAULT_TASK_MODEL = 'claude-sonnet-5-5'`. `acceptsEffort` substitui o "família selecionável" na decisão de mandar `effort` (Haiku 4.5 legado fica sem).
- **Thinking**: modo novo `betweenTools` ⇒ `{type: 'between_tools'}` (`tuningParams`), opção "Mínimo (só entre ferramentas)" no admin. `defaultSettings(task, model)` troca o "desligado" das tarefas Tradução/Extração/Cenário pelo jeito que cada modelo aceita (Sonnet 5.5 ⇒ `betweenTools`, Opus 5.5 ⇒ default). Todo uso de `TASK_DEFAULT_SETTINGS[task]` como fallback em runtime passou a `defaultSettings`.
- **Troca automática**: `src/server/claude/model-auto-upgrade.ts` + cron `src/app/api/cron/ai-models/route.ts` (`vercel.json`, 11:00 UTC). Escada de ajustes em `upgradeCandidates` (`src/domain/ai-task-config.ts`). Interruptor `auto` por tarefa no jsonb (`resolveAiTasks` ⇒ `true` por padrão; `withTaskSettings` preserva quando ausente), checkbox no `config-section.tsx`, PUT aceita `auto`.
- **Preço**: `TEXT_PRICE_TABLE` ganhou Sonnet 5.5 ($2/$10) e Haiku 5.5 ($0,10/$0,50 até 100K de prompt).
- **Migração 0079 (PR seguinte)**: `default_model` e `ai_tasks.<tarefa>.model` vão para a 5.5 do mesmo nível (Fable ⇒ Opus 5.5). Separada porque roda no build, com o código anterior ainda servindo, e ele mandaria `thinking: disabled` ao Sonnet 5.5. Sem ela, o próprio cron já sobe Sonnet 5 ⇒ 5.5 e Haiku ⇒ 5.5 após teste; só Fable ⇒ Opus precisa do SQL.

## 2. Como conferir em produção

- `/admin/ia` (depois da 0079 ou da 1ª passada do cron): as cinco tarefas mostram Opus 5.5 (Geração) e Sonnet 5.5 (demais, salvo escolha anterior), o select oferece só os três 5.5 e cada bloco tem "Atualizar sozinho…" marcado.
- Logs da Vercel, todo dia ~11:00 UTC: `[ai-models] passada concluída: atual=5 …` sem versão nova; com versão nova, `[ai-models] <tarefa>: A → B (thinking=… effort=…)`.
- Para forçar uma passada: Vercel → Settings → Cron Jobs → `/api/cron/ai-models` → Run.

## 3. Landmines

- O SDK pinado (0.104) não tipa `between_tools`; os pontos de chamada (`client.ts`, `model-probe.ts`, `translator.ts`) fazem cast para `Anthropic.ThinkingConfigParam`. Ao subir o SDK, remover os casts.
- `between_tools` só vale no Sonnet 5.5 e com esforço ≤ high; `disabled` dá 400 no Sonnet 5.5 e no Opus 5.5. A chamada de teste é a autoridade; `defaultSettings` (família + versão mínima, `src/domain/model-id.ts`) só semeia defaults.
- Painel de admin aberto desde antes de uma troca noturna: salvar o modelo antigo dá `modelo_invalido` (não é mais o mais novo nem o em uso); recarregar resolve.
- O cron nunca troca pela lista pinada (só pela viva), nunca muda de família e nunca rebaixa (`naoMaisNovo`). Uma tarefa num modelo fora das três famílias (Fable legado) fica parada (`foraDaFamilia`).
- `writeUpgrade` relê a linha sob lock e desiste se o admin mudou o modelo ou desligou o automático durante os testes.
- Integração local sem Docker: igual ao handoff 77 (PG16 + `postgresql-16-pgvector`, SQL arquivo a arquivo no `template1`, linha em `drizzle.__drizzle_migrations`).

## 4. Critério de saída

"checks" verde, painel de revisão limpo, migração 0079 aplicada no build da Vercel e `/admin/ia` em produção mostrando só os três 5.5.
