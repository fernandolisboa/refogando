# Handoff 75 — Cenário dinâmico nas imagens geradas

**Sessão:** 2026-10-15. **Branch:** `claude/project-thread-fmi2hy`. **Migração:** `0078_image_scene`. O 73 e o 74 (e o ADR-0043) são do #580 e do #581, em voo junto. Origem: o dono achou "todas as imagens geradas muito parecidas" e pediu que o cenário acompanhasse o prato (tipo, país, cozinha), por exemplo "um prato contemporâneo numa mesa de restaurante mais refinado". Ele escolheu a opção "Diretor + regras" da proposta. Decisões no ADR-0044; termos no `CONTEXT.md` (**Cenário da imagem**, **Diretor de arte**, **Nota visual**).

## 1. O que mudou

- **Preâmbulo da imagem v2** (`src/domain/image-prompt.ts`, `STYLE_LIBRARY_VERSION = 2`): saíram os quatro eixos sorteados e o mapa `CUISINE_VISUAL_CONVENTION`; saiu o "editorial" do `STYLE_BASE`. Geração do zero: base + `Cena:` (variante do registro) + `Câmera:` + região e detalhes opcionais + nota visual subordinada. Edição: só a base.
- **Registros de cenário** (`src/domain/image-scene.ts`, puro e importável no cliente): 10 registros × 2–3 variantes, 4 enquadramentos, regras de reserva (`sceneFromRules`), sanitização da saída do diretor, `parseSceneChoice`.
- **Diretor de arte**: tarefa de IA `imageScene` (Sonnet 5 por padrão, esforço baixo, thinking off), prompt em `src/domain/image-scene-director.ts`, schema em `src/domain/image-scene-schema.ts`, `ClaudeClient.directImageScene` (uma tentativa, prazo de 8 s). `src/server/images/image-scene.ts` (`resolveImageScene`) junta diretor, regras e nota visual e nunca lança.
- **Geração**: `generateAndStoreGalleryImage` recebe `appCfg`, `sceneChoice` e `claude`; resolve a cena só sem `sourceImageId`. Rotas de geração do dono e da curadoria aceitam `cena` (só o modal do dono tem seletor; a fila de curadoria gera em Automático); a do dono devolve `scene: {registro, fonte}` e ganhou `maxDuration = 60`.
- **Admin**: tarefa "Cenário da imagem" na aba IA; checkbox "Diretor de arte do cenário" no bloco de imagem (`app_config.image_scene_director_enabled`); campo "Nota visual" por cozinha na aba Vocabulário (≤400).
- **Modal de imagem**: o cenário mora no botão de gerar, um botão dividido (`GenerateSplitButton`): o texto gera, a seta abre a lista (`DropdownMenuRadioItem`, novo na primitiva) e o escolhido entra no rótulo ("Gerar · Bistrô"); na edição não há seta. O cenário usado aparece no selo da prévia. "Refinar o prompt" virou um disclosure da largura do modal com chevron ⌄/⌃ (`aria-expanded`). Ajuste de 2026-10-15, pedido do dono depois do primeiro layout (seletor solto acima do botão).
- **Testes**: o `test/setup.ts` instala um `FakeClaudeClient` por padrão (nenhum teste chama a API). O Fake ganhou `cannedScene` (7º argumento), `lastSceneInput` e `sceneCalls`. Todo dublê `implements ClaudeClient` precisa de `directImageScene`.

## 2. Evidência

- Testes novos: `test/unit/image-scene.test.ts`, `test/unit/image-prompt.test.ts` (reescrito), o bloco "cenário (ADR-0044)" de `test/integration/recipe-image-generate.test.ts` (diretor ok, falha ⇒ regras, diretor que lança ⇒ regras, escolha do usuário pula o diretor com fonte `usuario`, `cena` inválida ignorada, diretor desligado, nota visual do banco, edição sem cena), `cena` na rota da curadoria (`catalog-image.test.ts`), tetos do prompt do diretor, `directImageScene` em `claude-client-real-params`, nota visual em `admin-vocabulary`, `sceneDirector` em `admin-config`, seletor em `recipe-image-manager`.
- Suíte completa, lint, `tsc` e `next build` verdes localmente (Postgres 17 na 5433).

## 3. O que muda para quem vê

- Imagens novas saem em cenas diferentes conforme o prato; as existentes não mudam.
- Gerar imagem do zero fica até ~8 s mais lento no pior caso (o diretor roda antes da imagem; na prática ~1–2 s). Escolher o cenário no modal pula o diretor.
- Custo: ~US$ 0,006 a mais por imagem gerada do zero (fora do ledger, só no log).

## 4. Landmines

- **Migração 0078** é a única em voo; o próximo PR com migração usa 0079. Preview da Vercel pode falhar em PR com migração (corrida com o branch do Neon), o que não bloqueia o "checks".
- **`IMAGE_SCENE_MODEL`** na env troca o modelo padrão do diretor; a escolha salva no admin vence.
- **Log para conferir em produção:** `[image-scene] diretor ok|prazo|falhou: registro=… fonte=diretor|regras recipe=… modelo=… in=… out=… ms=…`. `prazo` ou `falhou` com `fonte=regras` é o fallback funcionando, não erro de imagem; muitos `prazo` pedem olhar o modelo escolhido no admin. `[image-scene] diretor lançou` só deveria aparecer com dublê de teste.
- **Zod fora do cliente:** `image-scene.ts` é importado pelo modal e pelas mensagens de i18n; não importar zod nem o prompt do diretor ali.
- Não persistimos o cenário nem a versão do preâmbulo na imagem (ADR-0044 dec.7). Quem quiser estatística por registro lê o log.

## 5. Critério de saída

"checks" verde, painel de revisão limpo, migração 0078 aplicada em produção (as 15 cozinhas com `visual_note` preenchida) e uma geração de imagem em produção com a linha `[image-scene]` no log.

## 6. O que resta

- Custo do diretor no painel de uso, se ele crescer (ADR-0044 dec.6).
- Afinar as variantes da biblioteca e as regras conforme o dono for vendo imagens; as notas visuais ele mesmo ajusta no admin.
