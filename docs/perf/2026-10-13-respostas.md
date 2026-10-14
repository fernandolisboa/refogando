# Respostas sobre o item 1 e os achados A a J (2026-10-13)

Levantado no código depois do merge do #569. Duas correções ao relatório original vão marcadas como **Correção**.

Contexto que pesa em quase tudo: o banco restaurado tinha **239 receitas, ~480 embeddings e 1.887 itens** (`docs/incidents/2026-09-09-…md:70`). Vários achados são "lineares no catálogo": hoje custam milissegundos e só doem com dezenas de milhares de receitas.

---

## 1. Rate limit do `get-session`

**Risco real de isentar: praticamente nenhum.**

- O `get-session` só lê. O token tem 32 caracteres aleatórios (~2^190) e o cookie é assinado com HMAC (`BETTER_AUTH_SECRET`). Um token forjado cai na checagem de assinatura antes de qualquer query. Força bruta por essa rota não existe, então o limite não protege nada ali.
- Contra flood, o limite ajuda pouco. Cada chamada paga 3 queries de rate limit (uma escrita) para proteger uma rota que custa 0 queries para visitante sem cookie e 2 para quem está logado. Sob ataque, o limite **aumenta** a carga no banco.
- Tem um bug que o limite causa hoje: usuários atrás do mesmo IP (CGNAT de operadora, rede de empresa) dividem o balde de 100/min. Um 429 faz o `AuthSlot` mostrar "Entrar" para quem está logado (`auth-slot.tsx:95`). E cada volta à aba gasta 4 desse balde (ver J).
- Continuam limitados: sign-in, sign-up, reset e verificação (as regras do #449 ficam intactas).
- Proteção de flood de verdade é na borda (regra de rate limit no Vercel Firewall), não no Postgres.

**Recomendo:** `'/get-session': false` em `customRules`, junto com a correção do J, num PR pequeno. Resultado: cada navegação passa de ~5 queries (1 escrita) para 2 (0 para visitante).

---

## A. Cache de páginas e o tema

**Dá, sim.** O tema é o principal bloqueio, e o resto se resolve com cache por tag.

1. **Tema:** o cookie continua, mas quem lê é um script inline no `<head>`, antes da pintura (como o next-themes), que põe `.dark`/`.light` no `<html>`. O layout para de chamar `cookies()`. A CSP atual já permite. O risco é um flash de tema se o script falhar, coberto por um default `light` no HTML.
2. **Leituras de banco do layout** (vocabulário de cozinhas e `app_config`): `unstable_cache` com tags (`vocab:cozinha`, `app-config`), invalidadas nas rotas de admin e curadoria que escrevem nelas (são poucas e já mapeadas).
3. **O que destrava:** `/privacidade`, `/seus-direitos` e `/guia` viram estáticas. O detalhe público da receita já evita ler sessão (o estado do visitante vem pelo client) e pode virar ISR por slug.
4. **Bloqueios que sobram:** a home lê `searchParams` no `generateMetadata`, o perfil faz fetch HTTPS da própria API (resolvido pelo D) e o proxy manda `Vary: Accept-Language` (racha o cache da CDN à toa, já que o idioma está na URL).

**Recomendo:** fazer depois do D. Primeiro PR: tema mais as leituras do layout (sem migração). Depois, ISR do detalhe público.

---

## B. HNSW nos semelhantes e na busca semântica

**"Podem", não "vão".** Mas meu pushback é outro: **hoje não há ganho para trocar.**

- Com ~480 vetores, a varredura exata custa poucos milissegundos, e o planner provavelmente escolheria seq scan mesmo com o índice disponível. Com `ef_search` 40 sobre 480 linhas, o recall do HNSW fica perto de 100%, então os 4 semelhantes quase nunca mudariam.
- O custo está na reescrita, que mexe em semântica:
  - o `DISTINCT ON` prefere o embedding no idioma pedido;
  - a busca usa o cosseno como desempate de **todo** resultado preciso, não só do top-k;
  - os tetos são por seção (catálogo × comunidade).
  
  Isso é bastante teste para mudar (27 testes na busca semântica, 10 nos semelhantes).
- Concordo com o princípio: mudar pouco o resultado é aceitável se o ganho for grande. O ganho só aparece na casa de 10–20 mil receitas.

**Recomendo:** não fazer agora. Medir o tempo da query nos logs e voltar quando passar de algo como 50 ms.

---

## C. Full-text e trigram sem usar os GIN

**Concordo, e é mais barato do que eu disse.** A maior parte nem precisa de migração e é **exatamente equivalente**:

- **Títulos (full-text):** a função `recipe_ts_config` só devolve dois valores (`portuguese`/`english`). Separar a condição em dois ramos com tsquery constante dá o mesmo resultado e usa o GIN.
- **Trigram:** trocar `similarity(...) >= 0.3` pelo operador `%` com `pg_trgm.similarity_threshold = 0.3` dá o mesmo resultado e usa o GIN (hoje o `OR` com a função derruba até o ramo do ILIKE).
- **Bug encontrado:** `%` e `_` digitados pelo usuário viram curinga no ILIKE (o comentário em `search.ts:212` diz o contrário). Vai junto.
- **Ingrediente (texto cru):** aqui precisa de migração: uma coluna de idioma/config em `recipe_ingredient`, um `tsvector` gerado e um GIN. É a mesma tabela do E, então as duas viram **uma migração só**.

**Recomendo:** PR com os títulos, o trigram e o bug do curinga, sem migração. A parte de ingrediente vai junto com o E.

---

## D. Fetch HTTPS da própria API

Combinado, vai no próximo PR. De quebra, ele destrava o perfil para o A.

---

## E. Despensa ("o que dá pra fazer")

**Correção:** a normalização roda em SQL, não em JS. Fora isso, o achado vale.

- **É novo** (#560, 2026-09-28; ajustado no #568) e **não está com problema hoje**: com 239 receitas são milissegundos. O próprio ADR-0038 mediu ~0,6 s num catálogo sintético de 4.000 receitas e já apontava esta correção.
- **A migração é pequena:**
  - uma coluna gerada `raw_text_norm` em `recipe_ingredient` e outra `nome_norm` em `ingredient_translation`. A função `immutable_unaccent` já existe, então dá para reproduzir a normalização exata em coluna gerada;
  - opcionalmente, um `text[]` de palavras com GIN, para filtrar antes de tokenizar.
- **A parte chata** é o nome traduzido, que vem do jsonb de `recipe_translation`. Coluna gerada não alcança outra tabela, então ele seria preenchido na escrita, e há ~6 caminhos que escrevem itens.

**Recomendo:** junto com o ingrediente do C, numa migração, sem pressa.

---

## F. Popularidade

**Tem meio-termo, sim.** Das três agregações, só a da **receita da semana** roda em toda visita à home (e só quando não há escolha do curador).

- Cachear só ela por 10 minutos, por idioma, invalidando por tag quando o admin salva a config (assim a escolha do curador aparece na hora).
- `sort=popularidade` e cozinheiros recomendados continuam ao vivo: são por usuário, e só rodam quando alguém pede.
- Números 10 minutos atrasados são invisíveis para quem olha a home.

**Recomendo:** fazer, num PR pequeno sem migração.

---

## G. Gaveta "Criar"

É ela mesma, a que abre pela direita.

- **Correção:** os "340 KB" eram fonte. Compilada, a gaveta é um chunk de **55 KB bruto / 14 KB gzip**, ~9% do JS de uma página como `/privacidade`. O ganho existe, mas é modesto.
- **Por que não entrou:** seria o primeiro chunk lazy do app. Depois de um deploy, uma aba antiga que clicar em "Criar" pode não achar o chunk, e o `AppUpdateGuard` recarrega a página em vez de abrir a gaveta.
- **Correção completa:**
  - `next/dynamic`;
  - pré-carregar no hover, no foco ou no ocioso;
  - se o carregamento falhar, navegar para `/create`.
- **Largura hoje:** tela cheia até 384 px no celular, e **448 px** (`sm:max-w-md`) do tablet para cima. Proposta: `sm:max-w-lg` (512 px) ou `md:max-w-xl` (576 px).

**Recomendo:** baixa prioridade. Fazer junto com a largura, num PR de UI.

---

## H. Listas sem LIMIT (minhas receitas, salvos, perfil)

O feed, o "seguindo" e os cozinheiros já têm scroll infinito (cursor por `created_at, id`). As três listas pessoais trazem tudo.

1. **Agora, sem mudar nada na tela:** parar de trazer `passos`, `descricao` e `notas` de todas as traduções. As telas só usam o título.
2. **Paginar vale a pena, mas tem três amarras:**
   - o seletor do Cardápio filtra o acervo inteiro no client;
   - "minhas receitas" ordena por `updated_at`, que muda a cada edição (o cursor precisa de cuidado);
   - o perfil conta receitas pelo tamanho da lista.

**Recomendo:** o passo 1 entra no PR do D. O passo 2 quando alguém tiver acervo grande, com endpoint próprio para o seletor do Cardápio.

---

## I. Imagens

**É verdade, e aqui o ganho é grande.** O feed serve um PNG de ~1,5 MB (ADR-0022) para um thumb de 128–144 px: dezenas de vezes mais bytes que o necessário, e o pior caso é o celular em 4G rolando o feed.

Duas formas:

| | Redimensionar no upload (sharp) | Na hora (`next/image`) |
|---|---|---|
| Como | Gera WebP ~1280 px (detalhe) + ~400 px (thumb) e guarda os dois no Blob | A Vercel redimensiona sob demanda e cacheia |
| Imagens antigas | Script de backfill | Funciona sem backfill |
| Custo recorrente | Zero (só o storage) | Cota de otimização de imagem do plano da Vercel |
| Migração | Uma coluna `thumb_url` em `recipe_image` | Nenhuma |

- **Recomendo redimensionar no upload.** O sharp já é dependência (as fotos de avaliação já passam por ele). Há um ponto único que cobre a geração por IA (`generateAndStoreGalleryImage`), mais 2 de upload. O custo é previsível.
- O original PNG fica guardado para a edição imagem-a-imagem do Gemini.
- O `<img>` ganha `srcset`, então cada tela escolhe o tamanho.

---

## J. ADR-0028 e a volta à aba

**O que o ADR diz:**
- é o ADR das notificações: caixa in-app buscada ao carregar a página e **ao focar a aba**;
- trata a "atualização graciosa": o papel desatualizado se resolve refazendo a sessão ao focar a aba ou navegar.

O ADR está certo, e serve para isso.

- **Correção:** o ADR **não** pede chamada dupla. O "intencional" está num comentário do código (`auth-slot.tsx:69-71`) e num teste, não no ADR. Eu disse errado no relatório.
- **Achado novo:** o client do better-auth **já** refaz a sessão no `visibilitychange` por padrão. Então hoje, quando alguém logado volta à aba, saem **4 `get-session` + 2 `/api/notifications`**: ~6 requests e ~20 queries.

**Recomendo:**
- manter o ADR;
- corrigir a implementação para **um** refetch por volta à aba, tanto da sessão quanto das notificações (6 → 2 requests);
- emendar o ADR com uma linha ("uma busca por volta à aba") e marcá-lo como implementado (ele ainda diz "Não implementado").

Vai no PR do item 1.

---

## Ordem proposta

1. **Próximo PR (sem migração):** D, H passo 1 (colunas enxutas). Já estou começando.
2. **PR de requests de auth:** item 1 + J (depende do seu ok no item 1).
3. **PR de busca:** C sem migração + bug do curinga; F (cache da receita da semana).
4. **PR de cache das páginas:** A.
5. **Migração 1:** C (ingrediente) + E. **Migração 2:** I (thumbs).
6. **PR de UI:** G + largura da gaveta.
7. **Em espera, até o catálogo crescer:** B e H passo 2.

**Status (2026-10-14): concluída.** Os passos 1 a 6 foram entregues (#570 a #575 e o PR do handoff 70). O A entrou sem o ISR do detalhe público, que fica como decisão à parte; o 7 segue em espera. Detalhe em `2026-10-13-auditoria.md` §9.
