# PRD — Imagens de receita, Perfil de usuário e Split do Admin

> Iniciativa única com **fundação compartilhada de storage de imagem**. Grillada em sessão `/grill-with-docs` (2026-06-19). Decisões duras em ADR-0016 (imagem como entidade) e ADR-0017 (contrato de geração de imagem por IA); adendo de stack em ADR-0010 (Vercel Blob). Termos novos no CONTEXT.md: **Imagem da receita** e **Handle**.

## Problema

Hoje a Receita é 100% texto. O usuário não consegue **ver** o prato — nem subir a própria foto do que cozinhou, nem pedir pra IA ilustrar a receita. O app não tem storage de arquivo nenhum, e `users.image` (a URL do Google) nem é exibida.

Além disso, duas arestas de produto incomodam:
- **O perfil é invisível e inerte:** não dá pra mexer no próprio nome, avatar, bio ou links; e a Autoria (quem criou uma receita pública) — que o domínio já modela — nunca aparece pra ninguém.
- **O admin é uma página-monstro escondida:** `/admin` empilha ~1.600 linhas de 5 concerns distintos numa rota só, sem link em lugar nenhum da navegação (acessível só digitando a URL).

## Solução

Três frentes de produto sobre **uma** fundação de storage de imagem, na seguinte ordem:

1. **Fundação de storage + Perfil.** Sobe Vercel Blob atrás de uma interface fina e entrega a edição de perfil (nome, avatar, bio, links) + Handle + perfil público + crédito de autor. O avatar é o caso de upload mais simples e valida a fundação com risco baixo.
2. **Imagem de receita — upload.** O Owner sobe a foto do prato; ela é entidade própria, carregada pra frente ao versionar sem duplicar arquivo.
3. **Imagem de receita — geração por IA.** Botão "Gerar imagem" usando a receita atual (prompt automático com refino opcional), via Nano Banana 2 por REST, com tetos de custo por papel.
4. **Split do admin.** Quebra `/admin` em rotas aninhadas sob um layout com gate único, dá uma entrada "Painel" na navegação pra curador+, e abre `/admin/ai` (onde moram os tetos de geração).

## Histórias de Usuário

### Fundação de storage (atravessa todas as frentes)

1. Como desenvolvedor, quero um primitivo único `storeImage`/`deleteImage` atrás de interface fina, para trocar o provedor de blob (Vercel Blob → Cloudinary) sem vazar pro resto do app.
2. Como usuário, quero que minhas imagens sejam servidas otimizadas (via `next/image`), para carregar rápido em qualquer conexão.
3. Como usuário em celular, quero que minha foto seja redimensionada antes de subir, para não estourar o limite de upload nem gastar dados à toa.
4. Como operador, quero que um arquivo de blob só seja apagado quando nenhuma Receita o referencia mais, para nunca perder a imagem de uma versão que ainda a usa.

### Perfil — edição

5. Como Usuário, quero editar meu nome de exibição, para me apresentar do jeito que prefiro.
6. Como Usuário, quero subir um avatar, para ter uma cara no app em vez da foto do Google (ou de nada).
7. Como Usuário, quero trocar meu avatar quando quiser, e que o avatar antigo seja apagado, para não acumular arquivo.
8. Como Usuário, quero escrever uma bio curta, para contar quem sou em poucas palavras.
9. Como Usuário, quero adicionar até 5 links (instagram, x, github, youtube, site), para apontar pras minhas outras presenças.
10. Como Usuário, quero que links com URL inválida ou esquema perigoso (ex.: `javascript:`) sejam recusados, para o perfil ser seguro de clicar.
11. Como Usuário, quero ver meu e-mail no perfil mas **não** poder editá-lo, porque é minha identidade de login.
12. Como Usuário recém-criado, quero já ter um avatar e nome funcionando (do Google ou default), para o perfil nunca nascer quebrado.
13. Como Usuário, quero que só **eu** possa editar meu próprio perfil, e que uma conta desativada não consiga, para ninguém mexer no que é meu.

### Perfil — Handle e página pública

14. Como Usuário, quero um endereço de perfil legível (`/u/<handle>`), para compartilhar quem eu sou com uma URL bonita.
15. Como Usuário novo, quero receber um handle gerado automaticamente do meu nome, para ter endereço desde o primeiro dia sem precisar escolher nada.
16. Como Usuário, quero poder trocar meu handle por um @nome de vaidade, para ter a identidade que eu escolher.
17. Como Usuário, quero ser avisado quando o handle que pedi já existe ou é reservado (`admin`, `api`, `me`…), para escolher outro.
18. Como Visitante (anônimo), quero ver a página pública de um autor (nome, avatar, bio, links), para conhecer quem fez as receitas que gostei.
19. Como Visitante, quero ver, na página de um autor, **as receitas públicas dele**, para explorar mais do mesmo cozinheiro.
20. Como Visitante, quero **não** ver as receitas privadas de ninguém na página pública, para a privacidade ser respeitada.
21. Como Usuário, quero que minhas receitas no pool mostrem um **crédito de autor** ("por 🟢 Fulano") linkando pro meu perfil, para receber atribuição pelo que publiquei.
22. Como Usuário que despublicou/foi moderado, quero que minha receita removida do pool **não** apareça na minha página pública, coerente com a remoção.

### Imagem de receita — upload

23. Como Owner, quero subir uma foto do prato que cozinhei, para ilustrar minha receita com a coisa real.
24. Como Owner, quero trocar a foto da receita, e que a anterior seja descartada se ninguém mais a usa, para não acumular lixo.
25. Como Owner, quero remover a foto da minha receita, para voltar ao estado sem imagem (que é normal).
26. Como qualquer pessoa vendo uma receita, quero ver a imagem dela no detalhe e como thumbnail no feed/busca, para reconhecer o prato de relance.
27. Como Owner, quero que **só eu** consiga mexer na imagem da minha receita, e ninguém em receita alheia.
28. Como Owner de uma receita sem imagem, quero que a UI mostre isso de forma limpa (sem placeholder feio), porque receita sem foto é caso comum.

### Imagem de receita — carry-forward ao versionar

29. Como Owner, ao **editar** minha receita, quero que a imagem atual seja **mantida** por padrão, para não perder a foto a cada ajuste.
30. Como Owner, ao **regenerar** a receita, quero que a imagem anterior venha junto como ponto de partida, para decidir se ela ainda serve.
31. Como Owner, quando a mudança é **grande** (mexeu em ingredientes, título ou cozinha — muda a cara do prato), quero ser perguntado se quero gerar/subir uma imagem nova, para a foto não mentir sobre o prato.
32. Como Owner, quando a mudança é **pequena** (porções, dificuldade, notas, descrição, restrições), quero que a imagem seja mantida **sem me perguntar nada**, para não me encher por bobagem.
33. Como Owner, quero que carregar a imagem pra frente **não gere um arquivo novo**, para o storage não inchar com cópias.

### Imagem de receita — geração por IA

34. Como Owner logado, quero um botão "Gerar imagem" na minha receita, para ilustrar o prato sem ter foto.
35. Como Owner, quero que o botão gere com **um clique** usando a receita atual (título + ingredientes + cozinha/categoria), para o caso comum ser instantâneo.
36. Como Owner mais exigente, quero abrir um prompt **pré-preenchido e editável** + presets de estilo (rústico, close-up, top-down, fundo claro), para refinar o visual.
37. Como Owner, quero ver a imagem gerada e poder **gerar de novo** se não gostei, substituindo a anterior, para iterar até ficar bom.
38. Como Owner, quero que a imagem gerada seja guardada como qualquer foto (mesmo fluxo de storage), para o resto do app tratá-la igual.
39. Como Visitante, quero ver um selo discreto "✨ gerada por IA" nas imagens sintéticas no pool, para saber o que é foto real e o que é ilustração.
40. Como Usuário comum, quero um teto de **3 imagens geradas por dia**, para não queimar a conta de ninguém sem querer.
41. Como Curador, quero um teto maior (**5/dia** default), por confiança e uso.
42. Como Admin, quero geração **livre** (sem teto), para testar e administrar.
43. Como Owner que bateu o teto, quero um aviso amigável com **countdown** ("libera em 6h"), em vez de um erro seco.
44. Como Owner, quero que o teto seja uma **janela de 24h deslizante**, para o custo ter um teto duro e previsível.
45. Como Visitante (anônimo), quero **não** conseguir gerar imagem, porque geração custa e exige conta.
46. Como Owner, quero **não** conseguir gerar imagem numa receita que não é minha.
47. Como Owner, quero que a geração respeite o filtro de segurança do provedor (sem conteúdo impróprio), sem o app precisar de um scanner próprio.

### Imagem — moderação no pool

48. Como Usuário autenticado, quero **reportar** uma receita pública cuja imagem é ofensiva, reusando o report que já existe (mira a Receita).
49. Como Curador, quero **remover só a imagem** de uma receita pública sem derrubar a receita inteira, para punir a foto, não o conteúdo bom.
50. Como Curador, quero que remover a imagem exija um **motivo**, para a ação ser auditável (igual remover-do-pool).
51. Como Owner cuja imagem foi moderada, quero **continuar vendo a imagem no meu privado**, porque moderar é esconder do público, não apagar o que é meu.
52. Como Visitante, quero que uma imagem moderada **suma de toda parte pública** onde aparecia (a imagem é julgada por si), para a moderação ser consistente.
53. Como Admin, quero que a imagem moderada **continue contando** no teto de geração de quem a gerou, para não virar brecha de gaming.

### Split do admin

54. Como Curador, quero um link "Painel" na navegação quando estou logado com papel curador+, para achar a área administrativa sem decorar a URL.
55. Como Usuário comum/Visitante, quero **não** ver o link "Painel" nem conseguir acessar a rota, porque não é pra mim.
56. Como Admin/Curador, quero o admin quebrado em **rotas bookmarkáveis** (`/admin/config`, `/admin/users`, `/admin/moderation`, `/admin/translations`, `/admin/catalog`, `/admin/ai`), para ir direto ao que preciso.
57. Como Admin/Curador, quero uma navegação lateral/abas no layout do admin, para circular entre as seções.
58. Como Admin, quero que o gate de acesso seja aplicado **uma vez** no layout (fail-closed), para nenhuma sub-rota vazar por engano.
59. Como Curador, quero ver **só** as seções de Curadoria (moderação, traduções, catálogo) e não as de Governança (config, papéis), respeitando meu papel.
60. Como Admin, quero a seção **`/admin/ai`** para ligar/desligar a geração de imagem, escolher o modelo e ajustar os tetos por papel **sem mexer em variável de ambiente**.
61. Como Admin, quero que cada rota do admin **revalide o papel no servidor** (UI é só conveniência), para a segurança não depender de esconder link.

## Decisões de Implementação

**Fundação de storage**
- Provedor: **Vercel Blob** atrás de uma interface fina `ImageStore` (`store(bytes/file) → url`, `delete(url)`), registrada na **raiz de DI** (`src/server/deps.ts`), no mesmo padrão Real/Fake/Throwing de Embedder/Translator. Plano B documentado: Cloudinary (ADR-0010).
- `next/image` com `remotePatterns` apontando pro host do blob; redimensionamento no cliente antes do upload (limite ~4,5MB das functions Vercel).

**Imagem da receita (ADR-0016)**
- Nova tabela **`recipe_image`**: `id`, `blob_url`, `provenance` (`user_photo | ai_generated`), metadados de geração (prompt, modelo) quando IA, `created_by`, `created_at`, e flags de moderação `moderated_at`/`moderation_reason`/`moderated_by`.
- Nova coluna **`recipe.image_id`** (FK opcional → `recipe_image`), **many-versions → one-image**, com **contagem de referência** pra deleção de blob.
- **Carry-forward** ao editar/regenerar: herda `image_id`; classificador **determinístico** de "mudança visualmente relevante" (ingredientes/título/cozinha = grande → pergunta; porções/dificuldade/notas/descrição/restrições = pequena → silencioso). Usa o `derivedDiff` existente na edição; comparação de conjunto de ingredientes + título no regenerar.
- **Moderação**: ação de Curador "remover só a imagem" seta `recipe_image.moderated_at` (não apaga blob, não zera `image_id`). Gate de pool de imagem ganha `AND image.moderated_at IS NULL`. Eixo ortogonal a `recipe.moderation_removed_at`.

**Geração por IA (ADR-0017)**
- Novo seam de DI **`ImageGenerator`** (`generateDishImage(prompt) → Buffer`), Real/Fake/Throwing. Real chama **Nano Banana 2** (`gemini-3.1-flash-image`) por **REST puro com `fetch`** (sem SDK novo); devolve bytes → `ImageStore`.
- Endpoint: `POST /api/recipes/[id]/image/generate` (gate: Owner logado). Monta o prompt da Receita atual + preâmbulo de estilo; aceita prompt editado/preset opcional.
- **Config no admin** (estende `/api/admin/config`): `imageGen { enabled, model, dailyCapByRole: { usuario: 3, curador: 5, admin: null } }`. `null` = livre.
- **Teto**: conta linhas `recipe_image` com `provenance='ai_generated'` e `created_by=<user>` em **janela de 24h deslizante**; bloqueia + countdown ao estourar.

**Perfil**
- `users` ganha: `bio` (text, ~280), `links` (jsonb `[{ tipo, url }]`, ≤5), `handle` (text, **único, not null**). Avatar reusa só o **primitivo** `ImageStore`, gravando a URL em `users.image` (não passa por `recipe_image`).
- **Handle**: gerado do nome com desambiguação na criação da conta; editável; minúsculo; lista de reservadas barrada; troca quebra links antigos (sem redirect). **Migração de backfill** gera handle pros usuários existentes.
- Endpoints: `PATCH /api/me` (nome, avatar, bio, links), `GET /api/me` (dados do perfil); checagem de disponibilidade de handle; `GET /api/users/[handle]` (perfil público + receitas públicas, anon-readable).
- Rota pública `/u/[handle]`; **crédito de autor** (Autoria) no item de receita do pool, linkando pro perfil.

**Split do admin**
- `/admin/layout.tsx` aplica o gate único via `decideAdminAccess` (fail-closed, já correto); rotas filhas `/admin/{config,users,moderation,translations,catalog,ai}`, cada uma revalidando papel no servidor (`requireRole`). Governança (config/users) só admin; Curadoria (moderation/translations/catalog) curador+.
- Link condicional "Painel" no `site-header` para curador+ (papel já vem na sessão do Better Auth).

## Decisões de Teste

Um bom teste exercita **comportamento externo** (resposta HTTP, estado no banco, texto na tela), nunca detalhe de implementação. Aproveitamos os **seams já estabelecidos**:

- **Rotas (projeto `node`, Postgres real):** prior-art `test/integration/auth-gating.test.ts`, `roles.test.ts`, `recipe-owner-edit.test.ts`, `admin-config.test.ts`. Auth via `seedSessionHeaders({ email, role, deletedAt? })`; estado via `seedRecipe`/`seedTranslation`/`seedUser`; asserção consultando o banco com `getDb()`. Testar: gates (401 anon / 403 papel / 200 ok), persistência (linha em `recipe_image`, `recipe.image_id`, colunas novas de `users`), e o gate de pool de imagem moderada.
- **Chamadas externas isoladas por DI:** criar `ImageStore` e `ImageGenerator` no padrão Real/Fake/Throwing de `src/server/deps.ts` (espelhando `setClaudeClient`/`setEmbedder`). Testes injetam `FakeImageStore` (devolve URL canônica) e `FakeImageGenerator` (devolve bytes canônicos) — **nunca tocam Vercel Blob nem a API do Gemini**. Usar o padrão "Throwing/Exploding" pra provar que o seam **não** foi tocado quando a requisição deveria ser barrada antes (ex.: anon tentando gerar).
- **Lógica pura (sem I/O):** prior-art `test/domain/access.test.ts`, `test/unit/generation.test.ts`. Testar como funções puras: (a) o **classificador "mudança grande vs pequena"** do carry-forward; (b) a **contagem da janela de 24h** do teto; (c) **geração/validação de handle** (slug, desambiguação, reservadas, esquema de link).
- **Componentes (projeto `ui`, jsdom):** prior-art `test/ui/shell.test.tsx`, `test/ui/auth-slot.test.tsx`. Mockar `next/link` e `useSession()`. Testar: link "Painel" aparece só pra curador+; formulário de perfil valida links; botão "Gerar" desabilita com countdown ao bater o teto; selo "gerada por IA" renderiza em imagem sintética.
- DI resetada por `resetDeps()` e tabelas truncadas (`truncateAll`) antes de cada teste — tabelas novas entram no truncate automaticamente.

## Fora de Escopo

- **Rate-limiting geral / proteção contra abuso (DoS):** concern **transversal** (por usuário/IP, no middleware/edge), não um teto por feature. Vira **issue própria**, fora desta iniciativa. O upload de foto **não** ganha teto de negócio (custo desprezível).
- **Galeria / múltiplas imagens por receita:** uma imagem primária por Receita. Várias fotos (passos, ângulos) ficam deferidas.
- **Editor de imagem** (crop, filtros, ajuste) no app.
- **Scanner de NSFW próprio:** confiamos no filtro do provedor na geração e na moderação reativa no upload.
- **Avatar via entidade `recipe_image`:** avatar fica em `users.image` (URL), reusando só o primitivo de storage.
- **Redirect ao trocar handle** (links antigos quebram) e **proteções pesadas de squatting**; **claim obrigatório no signup** (nasce com default automático).
- **Moderação de imagem por-receita** (escolhemos esconder-em-toda-parte).
- **Toggle de perfil privado:** atribuição em receita pública já é decidida pelo domínio.
- **Cloudinary:** só plano B documentado, não construído agora.

## Notas

- **Provedor de imagem (fato verificado, jun/2026):** "nano banana" = modelo de imagem do Google. Sucessor atual **Nano Banana 2 = `gemini-3.1-flash-image`** (fev/2026, default até no Vertex). Chamável por **REST puro** (`generateContent`), devolve **bytes base64**, ~**$0,05/imagem**, latência de poucos segundos. REST-sem-SDK **sidestepa o cutoff de npm** do ambiente. Runner-up: OpenAI `gpt-image-1` (mesma forma, base64 direto).
- **Ordem de entrega sugerida:** (1) fundação `ImageStore` + Perfil/avatar; (2) upload de foto na receita; (3) `/admin/ai` + geração por IA (a config dos tetos mora no admin, então a seção `/admin/ai` precede ou acompanha a geração; pode-se shippar geração com defaults fixos e ligar a config logo depois); (4) split do admin completo. O split do admin é independente das imagens e pode andar em paralelo.
- **Dependências de schema:** `recipe_image` + `recipe.image_id` são pré-requisito de upload e geração. `users.handle` (not null) exige migração de backfill antes de expor o perfil público.
- Vocabulário do CONTEXT.md em tudo: **Imagem da receita**, **Handle**, **Owner/Autoria**, **Proveniência**, **Visibilidade**, **Curador**, **pool**, **Receita derivada**, **Briefing**.
