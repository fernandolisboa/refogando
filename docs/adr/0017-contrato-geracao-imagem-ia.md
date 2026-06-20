# ADR-0017 — Contrato de geração de imagem por IA: REST sem SDK, prompt auto-com-refino, tetos configuráveis

Status: aceito

Irmão do ADR-0009 (que cobre só a geração de **texto** da Receita). A geração da **imagem** do prato segue um contrato próprio:

- **Provedor por REST puro, sem SDK.** Default **Nano Banana 2** (`gemini-3.1-flash-image`, Google). Chamado com `fetch` + API key direto no endpoint `generateContent` — **nenhum pacote npm novo** (sidestepa o histórico de cutoff de registro do ambiente). O modelo **devolve os bytes** (base64) → vão direto pro blob, sem segundo fetch nem corrida de URL expirável.
- **Atrás de uma abstração fina** `generateDishImage(): Buffer`, com o provedor por trás. Google/OpenAI entregam bytes direto; agregadores (fal/Replicate) precisariam de um passo interno "fetch a URL retornada" — o resto do app é provider-agnóstico.
- **Prompt automático com refino opcional.** Default: um clique gera, com o prompt **montado da receita atual/final** (título + ingredientes + cozinha/categoria + preâmbulo de estilo). Quem quiser, abre um prompt **pré-preenchido e editável** + presets de estilo. Mesma filosofia da Extração de ingredientes (ADR-0009 adendo): a IA pré-preenche, o usuário finaliza.
- **Só o Owner logado dispara** (gerar tem custo marginal ~$0,05/imagem; não pode ser anônimo nem em receita alheia).
- **Selo "gerada por IA"** visível nas superfícies públicas em imagens `ai_generated` (honestidade, na linha de Proveniência sempre-visível).

## Custo: tetos por papel, configuráveis, janela deslizante

- **Teto diário por papel**, default `usuario: 3`, `curador: 5`, `admin: ∞` — **editável na config do admin** (`/admin/ai`), na mesma config que já guarda o modelo de LLM (ADR-0009). **Nada de variável de ambiente/flag.**
- **Janela de 24h deslizante** (`created_at > agora - 24h`), com **countdown** na UI ("libera em Xh"). Contado a partir das próprias linhas `recipe_image` com `provenance = ai_generated` do usuário — **sem contador separado** pra manter.
- O teto vale **só pra geração** (que custa); **upload de foto não tem teto de negócio** (custo desprezível). Abuso/DoS é **concern transversal** (rate-limiting geral por usuário/IP), tratado fora destas features.
- Segurança de conteúdo: confia-se no **filtro embutido do provedor** na geração; **sem scanner de NSFW próprio** (proporcional). No upload, vale a moderação reativa (ADR-0003 / ADR-0016).

## Por quê

REST-sem-SDK mata o problema crônico de cutoff do npm e ainda deixa o provedor trocável. Bytes→blob num passo evita a corrida de URL expirável dos agregadores. Tetos por papel protegem a conta do gasto marginal; configuráveis na tela porque o dono quer mexer no número sem deploy. **24h deslizante** é a única janela com **teto de custo realmente duro** (≤ 3 gerações em qualquer 24h = ≤ ~$0,15/usuário/dia) e sem o incentivo perverso de empilhar gerações na virada da meia-noite (que o dia-de-calendário criaria).

## Considered options

- **SDK oficial (`@google/genai`) (rejeitado):** risco de cutoff de npm; desnecessário (é um `fetch`).
- **Janela "dia de calendário" (rejeitada):** mais simples de explicar, mas permite empilhamento na meia-noite (até 6 num span curto) e incentiva gaming.
- **Sem teto / teto via env (rejeitado):** custo descontrolado e fricção operacional pra ajustar.

## Consequências

- A config do admin cresce: `imageGen { enabled, model, dailyCapByRole }`.
- Imagem gerada vira uma linha `recipe_image` (`provenance = ai_generated`, ADR-0016); imagem moderada **continua contando** no teto (custo já gasto, não devolve slot).
- Trocar o provedor/modelo de imagem é trocar a config (ou a impl de `generateDishImage`), não migração de dado.
