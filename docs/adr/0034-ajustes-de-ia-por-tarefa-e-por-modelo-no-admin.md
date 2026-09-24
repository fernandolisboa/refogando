# ADR-0034 — Ajustes de IA por tarefa e por modelo no admin, validados por capacidades + chamada de teste

Status: aceito

Estende ADR-0033 (lista viva de modelos). Revisa ADR-0030 dec.1 (thinking da tradução) e a Extração de ingredientes (#112), que tinham modelo e parâmetros fixos em código.

O dono pediu (2026-09-24) que qualquer ajuste específico de modelo, como desligar o thinking, fosse configurável no admin, com defaults, e habilitado só quando o modelo aceita. Antes: a Geração tinha modelo no admin e `effort: 'medium'` fixo; a tradução usava `TRANSLATION_MODEL` com `thinking: disabled` fixo (que Opus 5.5 e Fable recusam); a Extração usava `EXTRACTION_MODEL` (Haiku) fixo.

## Decisões

1. **Três tarefas, cada uma com modelo e ajustes próprios**: Geração (receitas, variações, conversa), Tradução e Extração. O modelo da Geração continua em `app_config.default_model` (as rotas e o histórico já leem dali). Os demais, e os ajustes de todas, vão no jsonb `app_config.ai_tasks` (migração 0066). Sem linha ou sem entrada, Tradução e Extração caem em `TRANSLATION_MODEL`/`EXTRACTION_MODEL` (env) ou `claude-sonnet-5`.

2. **Ajustes são por modelo** (`byModel[model] = { effort, thinking }`). Trocar de modelo e voltar recupera o ajuste anterior; um modelo sem ajuste salvo usa o default da tarefa. `effort: null` e `thinking: 'default'` não mandam o parâmetro (vale o default do modelo). Teto de 50 modelos por tarefa no jsonb.

3. **Defaults por tarefa** (`TASK_DEFAULT_SETTINGS`): Geração `effort: medium`, thinking no default do modelo (teto de 60s da rota). Tradução e Extração `thinking: off`, effort no default (tarefas fiéis; com thinking, os tokens dele dividem o teto com o JSON). Os defaults são seguros para o modelo default de cada tarefa. Com thinking que pode ligar, Tradução e Extração ganham 8k tokens de folga no `max_tokens`.

4. **O que o modelo aceita vem da Models API**: `capabilities.effort.<nível>.supported` e `capabilities.thinking.types.adaptive.supported`. A tela só oferece o que o modelo declara; sem o bloco de capacidades, oferece tudo.

5. **O que a API não informa é testado ao salvar.** A Models API não diz se o thinking pode ser DESLIGADO (Opus 5.5 e Fable recusam `disabled` com 400). Ao salvar, o servidor faz uma chamada mínima (`max_tokens` 512, 20s, sem retry) com o modelo e o ajuste. 400/404 ⇒ `ajuste_recusado` com a mensagem da Anthropic e nada é gravado. Falha de rede/credencial/5xx ⇒ grava sem verificar (queda da API não trava o admin). Rejeitado: tabela de "quem desliga o thinking" em código, que envelhece a cada lançamento.

6. **Troca do modelo em uso**: a 0066 também troca `default_model` de `claude-opus-4-8`/`claude-sonnet-4-6` para `claude-opus-5-5`/`claude-sonnet-5` (adiado da 0065, ver ADR-0033 dec.4). Qualquer outro valor fica.

## Consequências

- A Extração sai do Haiku para `claude-sonnet-5` (Haiku não é mais selecionável). Custa mais por chamada; a Extração segue fora do ledger de custo.
- A tradução e a Extração leem a config a cada chamada (uma leitura do singleton), como a Geração já fazia.
- A chamada de teste custa frações de centavo por salvamento e roda só no admin.
- Um ajuste salvo pode deixar de valer se a Anthropic mudar o modelo; a tarefa então falha como qualquer erro de API e o admin ajusta. A chamada de teste roda de novo a cada salvamento.
