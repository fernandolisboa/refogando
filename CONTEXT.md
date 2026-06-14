# Refogando

Domínio de um app de receitas com IA, bilíngue pt-BR/en-US desde o início. Três modos de uso — buscar, criar conversando, criar estruturada — operam sobre um único núcleo de domínio. Este glossário é a linguagem ubíqua do projeto.

## Language

**Receita**:
A especificação completa e canônica de um prato — título, ingredientes (com quantidade e unidade), passos de preparo, porções, dificuldade, cozinha e restrições atendidas. É _um_ prato, idêntico em qualquer locale: o locale muda só a língua de apresentação, nunca a substância. O que distingue uma receita de catálogo de uma gerada por IA é a sua proveniência, não a sua estrutura.
_Avoid_: Prato, Dish, RecipeCard, Card, CatalogRecipe, AiRecipe; "receita em pt" e "receita em en" como entidades distintas.

**Locale**:
Identificador de idioma+região (pt-BR, en-US) que seleciona o conteúdo traduzido e a formatação. Cidadão de primeira classe — o app é bilíngue desde o início. É a chave de _apresentação_, não de identidade: a mesma Receita existe em todos os locales.
_Avoid_: Língua, Idioma (como chave de identidade), Region, Country.

**Tradução de receita** (conteúdo traduzível):
Os campos da Receita que variam por locale — título, descrição, textos de passo, notas. É o _mesmo prato_ expresso noutra língua: uma receita original do Texas continua a mesma receita quando buscada no Brasil, traduzida, nunca trocada por um prato diferente. Campos invariantes (quantidades, porções, dificuldade, referências de ingrediente) não são conteúdo traduzível. O **corpo** (descrição, passos) é sempre traduzido por completo no locale do usuário, com tradução automática sinalizada quando não revisada.
_Avoid_: bifurcar o prato por locale; "versão pt" e "versão en" como receitas diferentes; traduzir um prato para um prato distinto.

**Nome da receita** (título):
O nome do prato. O **original é primário** e sempre exibido; quando existe uma tradução localizada confiável, ela aparece **entre parênteses** (`Texas Chili (chili do Texas)`). Tradução automática só como último recurso, nunca disfarçada de nome oficial.
_Avoid_: substituir o nome original pela tradução; exibir tradução automática crua como nome canônico.

**Proveniência** (origem da receita):
Enum **imutável** que registra como a receita passou a existir: `catalog` (curada/editorial), `ai_chat`, `ai_structured` (gerada por IA) ou `user_edited` (derivada de uma edição do usuário). Dirige o selo de confiança e acompanha a receita em toda superfície — a diferenciação "do catálogo" vs "gerada por IA" é de primeira classe e sempre visível. Não muda quando a receita é salva ou publicada.
_Avoid_: isAiGenerated (boolean); RecipeType; "receita do sistema" vs "do usuário"; confundir com Visibilidade ou com publicação.

**Visibilidade**:
Eixo separado da Proveniência que controla quem enxerga a receita: **privada** por padrão; **pública** quando o **próprio usuário autoriza** (sem curadoria obrigatória). Receita pública entra no pool da comunidade, recebe votos e é mostrada a outros por popularidade, com atribuição a quem publicou. Distinta do catálogo curado, que é editorial — uma receita de usuário nunca vira `origin=catalog`.
_Avoid_: confundir com Proveniência (o "como"); "publicar" como sinônimo de "salvar".

**Restrição alimentar**:
Condição que a receita deve atender ou excluir por dieta, alergia ou intolerância (sem glúten, vegano, sem lactose). É **contrato de adequação**, não tag descritiva. Numa receita de IA, "atende" é **afirmação da IA, não garantia verificada**.
_Avoid_: Dieta (mais amplo); Preferência; Tag; tratar como fato verificado.

**Aviso de restrição**:
Aviso leve e honesto numa receita: restrições declaradas (por usuário ou IA) aparecem como **"declarado, não verificado"**, e quando o nosso dado acidentalmente flagra uma contradição óbvia (farinha de trigo em "sem glúten") mostramos um alerta amigável. **Não** suprime receita, **não** bloqueia, **não** trava — a responsabilidade final é do usuário, e o app deixa isso claro com um aviso, não com burocracia.
_Avoid_: Alerta de restrição (use **Aviso**); tratar como verificação/garantia; gating; "selo verificado"; transformar o app num sistema de conformidade.

**Voto / Popularidade**:
Sinal da comunidade que **ordena** receitas públicas e alimenta a descoberta social. **Não tem autoridade sobre segurança**: votos ordenam descoberta, mas não convertem um Aviso de restrição ("declarado, não verificado") em garantia, nem promovem ao catálogo curado.
_Avoid_: confundir popularidade com confiabilidade ou com verificação; "curtir" como aprovação de segurança.

**Sessão de criação**:
Agregado de um episódio de criação com a IA, com `mode` (`conversation | structured`), que produz a Receita gerada. Um conceito, dois modos — não dois conceitos soltos. Aponta para a receita resultante por referência fraca: a sessão aponta pra receita, **nunca o contrário**.
_Avoid_: Conversa (quando significar o agregado); Geração (quando significar a sessão); Wizard; Request.

**Modo conversa** (chat):
Modo da Sessão de criação stateful e multi-turno: o usuário descreve em linguagem natural e itera com a IA por mensagens até emergir uma receita. Transcript persistido e **retomável**; o usuário pode apagá-lo sem apagar a receita.
_Avoid_: Chat (genérico); Conversação livre; Thread.

**Modo estruturado**:
Modo da Sessão de criação que é função quase pura: o usuário monta uma especificação por campos (ingredientes, restrições, porções, dificuldade, cozinha) e a IA gera sob medida. Guarda o que foi pedido (Briefing de geração), sem mensagens.
_Avoid_: Formulário; Wizard; Filtro (é input de geração, não de busca).

**Cozinha** (cuisine):
Tradição gastronômica de origem geográfica/cultural (italiana, japonesa, baiana), vocabulário controlado referenciado pela Receita. Um dos eixos em que o "perfil culinário" se concretiza. Ortogonal a Categoria.
_Avoid_: Kitchen; Culinária (quando significar Perfil); Categoria; Estilo.

**Categoria** (curso):
Papel da receita na refeição (entrada, prato principal, sobremesa, bebida, molho), vocabulário controlado ortogonal a Cozinha. Restrita a curso/papel — nunca um balde genérico.
_Avoid_: Tipo de receita; Tipo (genérico); Classe; Perfil; Cozinha.

**Tag** (atributo):
Rótulo descritivo solto e multivalorado (N:M com Receita) que captura qualidades que não são Cozinha nem Categoria (rápida, leve, conforto, sem forno). Onde boa parte do "perfil culinário" aterrissa no dado.
_Avoid_: Categoria; Label genérico; Keyword.

**Perfil culinário**:
**Lente de descoberta/UX da busca** que traduz intenção difusa ("algo asiático e leve") em facetas concretas: Cozinha + Categoria + Tag. **Não é coluna nem entidade** — é o guarda-chuva de UX que atravessa os eixos.
_Avoid_: Estilo; Gênero culinário; tabela "perfil" que mistura tudo; tratar como dimensão própria.

**Briefing de geração** (especificação de criação):
Conjunto estruturado de parâmetros que o usuário dá à IA para gerar uma receita (ingredientes — com **força** obrigatório/preferido —, restrições, porções, dificuldade, cozinha, observações). É o que foi **pedido** (intenção, autoritativa sobre o obrigatório), distinto dos atributos da Receita **entregue**. A IA pode **aconselhar** ("não combina"), mas quem decide é o usuário — exceto onde colide com segurança (Aviso de restrição). Guardado como proveniência da geração.
_Avoid_: Query; Filtro; Prompt (cru); Pedido; confundir o pedido com o entregue.

**Vocabulário culinário**:
Kernel de enums compartilhado (cozinha, dificuldade, restrição, porções) usado tanto pela Busca (como filtros) quanto pela criação estruturada (como constraints). Mesma taxonomia, **semântica oposta**: filtrar o existente vs. gerar o novo.
_Avoid_: tags (vago); filtros (só vale pra busca).

**Busca / Consulta**:
Busca = o ato de **encontrar** receitas existentes por nome, ingrediente ou perfil. Consulta = o conjunto de parâmetros (termo + facetas resolvidas). Opera sobre o que já existe — **nunca cria**; no máximo ranqueia/interpreta.
_Avoid_: Filtro (para a ação completa); Pesquisa (usar Busca); Find.

**Reputação do autor / shadow-ban** (parado):
Direção registrada para o futuro, **não construída**: se abuso real aparecer, autores que reincidem em declarações erradas após correção de admin podem ter receitas públicas suprimidas. Fora de escopo enquanto o app se mantém leve (ver ADR-0007).
_Avoid_: tratar como subsistema do MVP; aplicar por contagem de avisos.

**Busca híbrida** (com busca semântica):
A busca combina a camada **precisa** (full-text por idioma, ingrediente canônico, facetas) com a camada **semântica** (embeddings/pgvector) num só ranking. A semântica capta a intenção difusa ("algo reconfortante e sem lactose") que palavra-chave não pega; a precisa garante o match exato de nome/ingrediente. Nunca puramente vetorial.
_Avoid_: "busca por vetor" como sinônimo do todo; tratar semântica e FTS como buscas separadas.

**Receita de zoeira** (lúdica):
Resposta de humor da IA a um pedido claramente brincalhão ou absurdo ("bolo sem ingredientes") — a IA entra na brincadeira em vez de recusar secamente. É personalidade de produto, não erro. Pode ser salva no privado, mas **não é publicável** no pool da comunidade.
_Avoid_: tratar como erro/falha; deixar entrar no catálogo ou na comunidade; confundir com geração degradada (que é uma receita real).

**Comentário consultivo**:
Texto da IA que acompanha uma geração ("troquei manteiga por azeite porque você pediu vegano") — conselho ou explicação, **fora** do objeto Receita. A IA aconselha; o usuário decide.
_Avoid_: embutir no objeto Receita; tratar como parte do conteúdo da receita.

**Refogando** (marca):
Nome do produto/app — gerúndio de "refogar" (dourar alho e cebola, onde a comida brasileira começa). É **marca/branding, fora do domínio**: nunca criar entidade, status ou tag "refogar/refogado". "Refogar" pode aparecer como texto livre dentro de um Passo de preparo; nada além disso.
_Avoid_: Refogar/Refogado como entidade, status ou tag; "Refogando" como termo técnico.

**Usuário e papéis**:
A pessoa por trás de uma conta, com um papel: **Visitante** (anônimo — busca, gera efêmero, compartilha por texto), **Usuário** (padrão — salva, publica, vota, favorita), **Curador** (revisa receitas reportadas/com aviso e cura o catálogo; não mexe em config), **Admin** (tudo + config). Salvar/publicar exigem conta.
_Avoid_: Conta (como sinônimo da pessoa); "author" string única; Moderador (use Curador).

**Owner / Autoria**:
Dois papéis sobre uma Receita. **Owner** = quem controla a linha (`owner_id`, NULL para catálogo/sistema). **Autoria** = quem é creditado na exibição/atribuição. Distintos da Proveniência (o "como surgiu").
_Avoid_: misturar humano, IA e curadoria num campo só; assumir Owner == Autor sempre.

**Ingrediente** (canônico):
Insumo reutilizável e **language-neutral** (id estável), nome/aliases traduzidos pela tabela de tradução, com dado de alérgeno **opcional**. Base da busca por ingrediente cross-locale. Distinto da ocorrência numa receita.
_Avoid_: Insumo; Item (sozinho); tratar como texto livre.

**Item de receita**:
A ocorrência de um Ingrediente numa Receita: quantidade numérica + unidade + nota + `raw_text`, com FK **opcional** pro canônico (resolvida best-effort). Quantidade e unidade são invariantes (não traduzíveis).
_Avoid_: lista como texto solto sem quantidade estruturada; quantidade como string.

**Receita derivada**:
Cópia de uma Receita criada quando o usuário edita uma que não é sua (catálogo ou de outro): `origin=user_edited`, ponteiro pra base + diff do que mudou (ADR-0005). A base nunca é mutada.
_Avoid_: editar/mutar a base compartilhada; "versão" (que é regeneração de IA).

**Embedding**:
Vetor (pgvector) por linha de tradução que habilita a camada **semântica** da busca híbrida (ADR-0008). Re-gerado quando a tradução muda.
_Avoid_: tratar como a busca inteira; confundir com FTS.
