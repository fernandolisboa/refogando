# ADR-0033 — Modelos de texto: lista viva da Anthropic na oferta, default pinado, troca só pelo admin

Status: aceito

O dono pediu (2026-09-24) para subir o modelo da Geração para o Opus 5.5, tirar o Haiku das opções, oferecer o Sonnet e o Opus mais recentes e o Fable, e perguntou se as versões precisam ficar fixas no código. Antes: allowlist fixa `['claude-opus-4-8', 'claude-sonnet-4-6']` duplicada na rota `/api/admin/config` e no select do admin; cada lançamento exigia deploy.

## Decisões

1. **A OFERTA é dinâmica.** As opções do admin vêm da Models API (`GET /v1/models`) via o seam `ModelCatalog` (`server/claude/model-catalog.ts`), com cache de 1h por processo (falha: 5 min). A regra pura (`domain/claude-models.ts`) filtra as famílias **Opus, Sonnet e Fable** e fica com o **mais novo de cada** (`created_at`). Haiku e Mythos ficam de fora. O PUT de `defaultModel` valida contra a mesma lista. Um modelo novo aparece no select sem deploy.

2. **O modelo EM USO não troca sozinho.** `app_config.default_model` só muda quando o admin salva. **Rejeitado: seguir o mais novo automaticamente** (ou um alias "latest"): um modelo novo pode trazer breaking change de API (ex.: Opus 5.5 recusa `thinking: disabled` e `tool_choice` forçado) e muda custo e latência. Trocar o modelo de produção é uma decisão, não um efeito colateral de um lançamento.

3. **Fallback pinado, nunca lista vazia.** API fora do ar, sem chave ou sem nenhuma família nossa ⇒ `FALLBACK_SELECTABLE_MODELS` (Opus 5.5, Sonnet 5, Fable 5.1). O default em código (`DEFAULT_TEXT_MODEL = 'claude-opus-5-5'`) é fonte única para as rotas, o `app-config` e o default da coluna.

4. **Histórico intocado.** `generation.model` guarda o ID cru que gerou cada Receita; nada o reescreve. A leitura de `app_config` também não reescreve um `default_model` fora da lista (o select mostra "em uso, fora da lista atual"). A migração 0065 só leva a linha singleton ao sucessor das duas opções antigas (`opus-4-8 → opus-5-5`, `sonnet-4-6 → sonnet-5`).

5. **Chamada preparada para os modelos novos.** A Geração passa `output_config.effort = 'medium'` (o default varia por modelo; as rotas têm teto de 60s) e teto de `max_tokens` maior (12k single, 20k no lote de variações, abaixo do limite em que o SDK exige streaming), porque Opus 5.5 e Fable rodam com thinking sempre ligado.

## Consequências

- Modelo novo sem linha em `TEXT_PRICE_TABLE` (`domain/text-cost.ts`) gera com `cost_usd` nulo até alguém adicionar o preço (NULL honesto, já era a regra).
- A Extração de ingredientes segue no modelo dedicado barato (`EXTRACTION_MODEL`, env-overridable). Não é opção do admin.
