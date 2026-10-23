# ADR-0052 — Crédito público na Receita derivada

Status: aceito (2026-10-23)

Issue #610 (follow-up do ADR-0051, risco (i)). Decisão de produto do Fernando (2026-10-23): mostrar "baseada na receita de @x", com link, na derivada publicada; cada pessoa decide se quer ser creditada; e quem foi copiado pode retirar o nome de uma derivada específica. Migração 0084. Política v3.5 e Termos v1.4.

## Contexto

- "Criar minha versão" e "Clonar" (ADR-0045) copiam o texto de uma receita pública de outra pessoa (ou do catálogo) para uma derivada do leitor, que ele pode publicar. A derivada guarda `parent_recipe_id` e `lineage_kind='edited'`, mas a página pública só mostrava "por <dono da derivada>".
- A Lei 9.610/98 (arts. 24, II, 27 e 108) faz do direito de ter o nome indicado um direito moral inalienável; os Termos v1 licenciam as cópias, mas não podem dispensar o crédito. O ADR-0051 registrou isso como risco aceito e baixo (modo de fazer e lista de ingredientes não são obra protegida, art. 8º, I; descrição e notas podem ser) e nomeou a incoerência: a importação da web sempre credita a fonte (ADR-0019), a cópia interna não.
- O mesmo direito inclui não ser nomeado (obra anônima ou sob pseudônimo, arts. 24, I e II, e 52): quem não quer o vínculo com uma cópia pode preferir sair.

## Decisão

1. **A linha.** Na página da derivada, logo abaixo do "por …": "Baseada na receita <título> de @handle" (título → a base, @ → `/u/<handle>`); base de catálogo: "Baseada na receita <título> do catálogo". Credita o pai **imediato** (D2 copiada de D1, copiada de O, credita D1): é de quem a pessoa copiou o texto.
2. **Quando aparece** (`decideDerivedCredit`, `src/domain/derived-credit.ts`, puro). Todas valem: a receita é derivada com a base ligada (apagar a base zera a FK); o dono da base não retirou o nome desta derivada; a base é leitura pública (`eligibleForPublicRead`) e não importada da web; com dono, o dono não é o da derivada, a conta passa no `publicAccountFilter` (o mesmo do perfil `/u/<handle>`, então conta eliminada ou desativada não é creditada e o link nunca leva a um 404) e `users.credit_on_derivatives` está ligado. Senão a página não mostra nada (nem "baseada em outra receita": a forma mais simples, e não sugere um vínculo que a pessoa desfez).
3. **Título e link.** O título segue `resolveName` (original primário; "Original (Tradução)" só com tradução confiável). O link usa o slug da base no locale da página; sem slug nesse locale, o uuid, como os cards da Busca (a página 308a para o slug ou serve a pública pelo caminho do dono).
4. **Leitura.** `loadDerivedCredit` (`src/server/recipe/derived-credit.ts`): só consulta quando a receita é derivada; uma query (pai + dono + traduções original e do locale + slug). Chamado na página pública por slug (sem cookie, a rota segue cacheável) e em `loadRecipeDetailView` (caminho do dono e `GET /api/recipes/[id]`). A vista ganha `basedOn` (público).
5. **Opt-out por pessoa.** `users.credit_on_derivatives` (default `true`), em Editar perfil → "Crédito nas cópias" (`GET/PUT /api/me/derivative-credit`, caixa que salva na hora; rota própria porque o `PATCH /api/me` exige o formulário inteiro). Vale para todas as derivadas, inclusive as antigas, na hora.
6. **Retirar de uma derivada.** `recipe.credit_removed_at` na derivada. Só o dono da BASE grava (`PUT /api/recipes/[id]/credit { exibir }`): a autorização é pela linhagem (derivada `edited`, pai com `owner_id` = sessão, derivada de leitura pública); todo o resto, inclusive o dono da derivada (o crédito não é dele para tirar), é 404 leak-safe. Retirar de novo mantém a primeira data; mostrar zera. A coluna não guarda quem retirou (é sempre o dono do pai), então não entra no `CONTENT_GUARDS` do expurgo de cadastros.
7. **Onde o dono da base vê o controle.** Na área de gestão da própria derivada. O servidor decide pela sessão (`creditoDoAutor` na vista, só com `viewerId`, como `viewerSaved`): a área já busca `GET /api/recipes/[id]` para todo logado no caminho público, e o controle só aparece quando a resposta o traz (o cliente nunca compara o @). Aparece com o nome na página ("Retirar meu nome") ou depois de retirado ("Mostrar meu nome de novo"); com o crédito fora da página por outro motivo (base privada, opt-out global) não há o que retirar e não aparece. Sem lista das derivadas em Editar perfil: o desfazer fica na página onde a pessoa retirou.
8. **Dados do titular.** A preferência entra no export (`account.creditOnDerivatives`). A eliminação não precisa de passo novo: a conta eliminada deixa de passar no `publicAccountFilter`.

## Por que vale na publicação, sem o aviso de 15 dias

O critério do ADR-0051 é "mudança contra a pessoa pede aviso; a favor ou só de redação, não". Até aqui a favor sempre foi *menos* tratamento; esta mostra o @ de quem já tem conta nas cópias, por padrão. Ainda conta como a favor:

- é o direito moral do autor (Lei 9.610, art. 24, II), que a plataforma deveria cumprir desde a v1 (o ADR-0051 o registrou como risco);
- o dado exposto já é público (nome e @ aparecem na receita original e no perfil), e o link leva à receita que a própria pessoa publicou;
- a saída é imediata e sem custo: desligar em Editar perfil, ou retirar de uma cópia na página dela;
- não toca consentimento (base: execução do contrato, Termos item 5; política item 3.1).

Por isso a Política v3.5 e os Termos v1.4 ganham versão e data próprias (`DATA_POLITICA_V3_5`, `DATA_TERMOS_V1_4`), sem trocar `AVISO_LEGAL_VERSAO`.

## Consequências

- O risco (i) do ADR-0051 fica resolvido; a incoerência com a importação da web some.
- A página pública de uma derivada paga uma query a mais (só as derivadas). Se a página da receita ganhar ISR (ADR-0020, "A passo 2"), a base virar privada, o dono desligar o crédito ou retirar o nome teriam de invalidar as derivadas.
- O JSON-LD não ganhou `isBasedOn` (fica para quando a página tiver ISR, se fizer sentido para SEO).
- Cards da Busca e do feed não mostram o crédito; só a página.
