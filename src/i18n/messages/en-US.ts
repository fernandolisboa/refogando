/**
 * Catálogo de chrome em en-US (issue #4). Tipado como `Messages` (= typeof ptBR):
 * o compilador exige as MESMAS chaves do pt-BR; o teste de paridade T3 confirma em runtime.
 */
import type { Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { Messages } from './pt-BR'

export const enUS: Messages = {
  app: { name: 'Refogando', tagline: 'Cook up any idea' },
  nav: {
    // #277: the Discovery/home is now labeled "Explore" in the nav (a tab next to "Following").
    // Key stays `home` (links to `/`, and not-found reuses this "back home" value); only the LABEL changed.
    home: 'Explore',
    // #277: "Following" tab — feed of recipes from the cooks the viewer follows. Logged-in only.
    seguindo: 'Following',
    // #236: the old "Recipes" entry (feed index) merged into the home (Discovery IS the home);
    // key removed as orphaned.
    create: 'Create',
    painel: 'Dashboard',
    signIn: 'Sign in',
    signOut: 'Sign out',
    // Account menu (#267): avatar dropdown items. "Dashboard" (curator+) and "Sign out" also
    // live in this menu, reusing `painel`/`signOut` above (no duplication).
    verPerfilPublico: 'View my public profile',
    editarPerfil: 'Edit profile',
    // Mobile menu (#163): accessible labels for the hamburger trigger and the drawer title.
    abrirMenu: 'Open menu',
    fecharMenu: 'Close menu',
    menu: 'Menu',
    menuDescricao: 'Site navigation and account',
  },
  // Notifications inbox (#371, ADR-0028): bell in the chrome (logged-in only) + panel. Same FLAT-key
  // shape as pt-BR (the `Messages` type derives only 2 levels — no sub-objects); `renderNotification`
  // picks the key by type and interpolates `{name}` via `String.replace`.
  notifications: {
    ariaLabel: 'Notifications',
    tituloPainel: 'Notifications',
    vazio: 'No notifications yet',
    novoSeguidor: '{name} started following you',
    novoSeguidorAnon: 'Someone started following you',
    // N2 curation/moderation events (#373): impersonal, no actor, no free-text reason embedded.
    sugestaoCozinhaResolvida: 'Your cuisine suggestion was reviewed',
    receitaModerada: 'One of your recipes was removed from discovery by a moderator',
    imagemModerada: 'One of your images was moderated',
    contaRestringida: 'Your account was restricted (image generation is blocked)',
    // N3 review events (#374): {name} = reviewer name (actor variant only); {stars} = rendered rating.
    avaliacaoNaReceita: '{name} rated your recipe ({stars})',
    avaliacaoNaReceitaAnon: 'Your recipe received a rating ({stars})',
    avaliacaoModerada: 'Your review ({stars}) was removed by a moderator',
    generico: 'You have a new notification',
  },
  locale: { label: 'Language', ptBR: 'Portuguese (Brazil)', enUS: 'English (US)' },
  // Light/dark theme toggle (ADR-0018), in the header. `light`/`dark` name the action's
  // TARGET (a11y): the aria-label changes with the current theme ("Switch to light/dark theme").
  theme: {
    light: 'Switch to light theme',
    dark: 'Switch to dark theme',
  },
  system: {
    loading: 'Loading…',
    error: 'Something went wrong.',
    notFound: 'Not found.',
    retry: 'Try again',
  },
  // Aviso de restrição (#7): mesma substância traduzida (ADR-0001), não byte-idêntica.
  // Placeholders {restricao}/{alergeno} idênticos ao pt-BR (interpolação compartilhada).
  aviso: {
    contradicao: 'Marked {restricao}, but contains {alergeno} — declared, not verified.',
  },
  // Ciclo de vida da tradução (#23, AC3): mesma substância traduzida (ADR-0001, não
  // byte-idêntica). Renderizados na vista no requestLocale (aviso de stale + ver-original).
  traducao: {
    staleAviso: 'This translation may be out of date compared to the original.',
    verOriginal: 'View the original',
  },
  // Rótulo amigável por valor do enum RESTRICOES (#7), traduzido por locale.
  // `satisfies Record<Restricao, string>` trava drift do enum no site de definição.
  restricaoLabel: {
    sem_gluten: 'gluten-free',
    sem_lactose: 'lactose-free',
    vegano: 'vegan',
    vegetariano: 'vegetarian',
    sem_acucar: 'sugar-free',
    low_carb: 'low carb',
    sem_oleaginosas: 'nut-free',
    sem_frutos_do_mar: 'shellfish-free',
  } satisfies Record<Restricao, string>,
  // Tela de Busca (#56), mesma substância traduzida (ADR-0001, não byte-idêntica).
  busca: {
    // #5 (Direção C): Search IS the discovery home (ADR-0020). `titulo` is the page IDENTITY — it is the
    // `<h1>` (sr-only; the mock has no visible page title) AND the SEO `<title>` (generateMetadata). Hence
    // "Discover recipes" (not "Search recipes", which only described the box). The INPUT label moved to
    // `buscarLabel` so the `<h1>`/SEO title and the input's accessible name can differ.
    titulo: 'Discover recipes',
    // #5: sr-only label of the search <input> (the field's purpose, separate from the <h1>/SEO title).
    buscarLabel: 'Search recipes',
    placeholder: 'Search dishes, ingredients, styles…',
    buscar: 'Search',
    // #5: sr-only label of the × button that clears the term (the pill hides the native × of search inputs).
    limparBusca: 'Clear search',
    // #5: prefix of the "Results for «term»" echo in the toolbar (the term goes in a <strong> with curly
    // quotes in the component — not interpolated into the string).
    resultadosPara: 'Results for',
    dicaInicial: 'Start typing a dish, ingredient, or style you like — or use the filters.',
    // #116: signed-in users also search their OWN recipes (private ones included).
    dicaInicialLogado: 'Start typing a dish, ingredient, or style — we search your recipes and the community’s.',
    // #5 (Direção C): the honest EMPTY state. `vazioKicker` (uppercase label) + `vazioTitulo` (serif
    // headline) frame `semResultado` (body). `semResultado` was REPURPOSED to the mock's copy ("Search
    // doesn't create…") — it stays the empty state's anchor text (referenced by the tests).
    vazioKicker: 'No results',
    vazioTitulo: 'Nothing here — not in the catalog, not in the community.',
    semResultado: 'Search doesn’t create recipes. But you can take another path:',
    // #116/own-label: section of the viewer's OWN recipes (signed-in), shown FIRST. "Your recipe"
    // selo on the own item (search and feed), in place of "From the community".
    secaoMinhas: 'Yours',
    seloMinha: 'Your recipe',
    secaoCatalogo: 'Catalog',
    secaoComunidade: 'Community',
    seloCatalogo: 'From the catalog',
    seloComunidade: 'From the community',
    traducaoAutomatica: 'automatic translation',
    talvezQueira: 'Maybe you want',
    consultaLabel: 'You are searching for:',
    filtroCozinha: 'Cuisine',
    filtroCategoria: 'Category',
    filtroRestricao: 'Dietary restriction',
    // #5 (Direção C): label of the "Filters" trigger (mobile) that collapses the facet rail. On DESKTOP
    // the rail is permanent (left column); on MOBILE it becomes this disclosure button. `filtrosContagem`
    // shows the number of active facets (cuisine+category+restriction sum); {count} is interpolated in the
    // component via `.replace` (leaves of the type are string).
    filtros: 'Filters',
    filtrosContagem: 'Filters · {count}',
    // Authorship (#129): "by <name>" credit on a pool recipe item, linking /u/<handle>.
    // {name} interpolated in the component via `.replace` (leaves of the type are string).
    porAutor: 'by {name}',
    // "AI-generated" seal (#132, ADR-0017) — over ai_generated images on cards and detail.
    // The Claude Design prototype uses ✨ on this seal (RefoStage "Minhas criações"/Search).
    imagemSeloIa: '✨ AI-generated',
    // #5 (ADR-0019 amendment): "Generate with AI" DEMOTED from a permanent CTA to the EMPTY STATE (an
    // exit card). It does NOT auto-fire (Search never creates): it links to /create?q=<term> pre-filling
    // the free-text. Guests see the sign-in invite (reuses `minhasCriacoes.convidaEntrar*`). The
    // always-available create entry is the global header "Criar". `vazioGerar*` = the empty-state card.
    gerarComIa: 'Generate with AI',
    vazioGerarTitulo: 'Generate a recipe with AI',
    vazioGerarTexto: 'We create a recipe from your search.',
    // #5 (final prototype): 2nd card of the EMPTY state — "Search the web" (MANUAL trigger). The final
    // mock shows THIS card on empty (not the automatic "From the web" — auto-gate #164 now only fires
    // on shallow-NON-empty). The button label reuses `buscar`="Search".
    vazioWebTitulo: 'Search the web',
    vazioWebTexto: 'Look for this recipe on other sites.',
    // #164: SEPARATE section of web links (ADR-0019) — appears ONLY when our own collection came back
    // SHALLOW. These are EXTERNAL links, marked "from the web", NOT stored nor ranked (Search only finds).
    secaoDaWeb: 'From the web',
    daWebDescricao: "We didn't find this in our collection yet. These are external links — they open on the source site.",
    // #275: explicit second "search the web" trigger at the END of the results — fires the web by the
    // user's ACTION even with enough local results ("scrolled to the end and nothing fit"). Coexists
    // with the automatic one (#164). Reuses the SAME /api/discovery/web; degrades gracefully.
    webManualCta: "Didn't find it? Search the web",
    webManualBuscando: 'Searching…',
    webManualNada: 'Nothing found on the web right now.',
    // Provenance seal for a recipe IMPORTED from the web (#169, ADR-0019) — distinct from Catalog/
    // Community. Shows on the detail of an imported recipe (private, credited to the source).
    seloImportada: 'Imported from the web',
    // #169: import modal in Search. Clicking a "from the web" result opens a confirmation that the
    // recipe will be COPIED to the user's private profile (credited to the source, never republished).
    // {fonte} interpolated in the component via `.replace`. Guests see the sign-in invite.
    importarTitulo: 'Import this recipe',
    importarTexto: "We'll copy this recipe to your private profile, crediting the source ({fonte}). It stays yours alone — importing isn't republishing.",
    importarConfirmar: 'Import to my profile',
    importarVerNoSite: 'View on site',
    importarCancelar: 'Cancel',
    importarImportando: 'Importing…',
    importarErroNaoImportavel: "We couldn't import this recipe: the site doesn't publish the structured data we need.",
    // #272: the site's robots.txt forbids automated fetching — the way out is "View on site".
    importarErroRobotsBloqueado: "This site doesn't allow automated importing of its recipes. You can still open it on the source site.",
    // #272: per-domain rate limit — too many imports from the same site in a row.
    importarErroLimite: 'Too many imports from this site just now. Wait a moment and try again.',
    importarErroGenerico: "We couldn't import right now. Try again or open it on the source site.",
    importarConviteTitulo: 'Sign in to import',
    importarConviteTexto: 'Create an account or sign in to import recipes from the web to your profile.',
  },
  // Feed da Descoberta-home (#103/#236), mesma substância traduzida (ADR-0001). Reusa `busca.*`
  // para o chrome compartilhado; só os textos próprios do feed vivem aqui. `titulo`/`subtituloLogado`
  // saíram com a fusão (#236): o `<h1>` é o da Busca e o feed de repouso é sempre o pool público anônimo.
  feed: {
    // #5 (Direção C): VISIBLE serif headline for the repouso feed — gives the INDEXABLE home a real
    // heading (the `<h1>` is sr-only). Honest about the ordering (recency): the public pool, newest first.
    titulo: 'Community recipes',
    subtitulo: 'What the community is cooking up, newest first.',
    vazio: 'No recipes here yet.',
    carregarMais: 'Load more',
    fim: "You've reached the end.",
  },
  // FOLLOWING feed (#277, ADR-0024) — logged-in-only, non-indexable surface (separate from the anon
  // home, Modelo B). Reuses feed.carregarMais/feed.fim + system.loading/system.error for pagination.
  // The empty state is cause-NEUTRAL (fires for "follows nobody" AND "followees have no public
  // recipes"): the copy is true in both cases and bridges to discovery (AC4).
  seguindoFeed: {
    titulo: 'Following',
    subtitulo: 'Recipes from the cooks you follow, newest first.',
    precisaEntrar: 'Sign in to see recipes from the cooks you follow.',
    vazioTitulo: 'Nothing here yet',
    vazioCorpo: 'Follow cooks to see their recipes in your feed.',
    // CTA leads to Discovery (`/`), where the recommended-cooks rail lives (#278).
    vazioCta: 'Discover cooks',
  },
  // "Top cooks" rail (#278, ADR-0024 amended) — recommended by global popularity on the home, as a
  // right-hand column on wide screens, each card showing 1–3 of the cook's recipes.
  cozinheirosSugeridos: {
    titulo: 'Top cooks',
    receitaContagem: '{n} recipe',
    receitasContagem: '{n} recipes',
    seguir: 'Follow',
    seguindo: 'Following',
    erroSeguir: "Couldn't update. Try again.",
    // #308: link at the end of the rail → dedicated Discover cooks surface.
    verMais: 'See more',
  },
  // Dedicated Discover cooks surface (#308, `/cooks`) — search + cuisine filter + paginated list.
  descobrirCozinheiros: {
    titulo: 'Discover cooks',
    subtitulo: 'Find cooks to follow.',
    buscarLabel: 'Search cooks',
    buscarPlaceholder: 'Name or @handle',
    cozinhaLabel: 'Cuisine',
    vazioBusca: 'No cooks found.',
    vazioLista: 'No cooks to show yet.',
    carregando: 'Loading…',
  },
  // Cooks cluster in the merged Search (#279, ADR-0024) — floats above recipes by match strength.
  buscaCozinheiros: {
    titulo: 'Cooks',
    verTodos: 'See all',
    verMenos: 'See less',
  },
  // Receita DERIVADA (#17): mesma substância traduzida (ADR-0001, não byte-idêntica). Rótulos
  // do diff congelado + o Aviso de que editar uma receita que não é sua cria uma cópia (fork).
  derivada: {
    adicionado: 'Added',
    removido: 'Removed',
    quantidadeAlterada: 'Quantity changed',
    restricaoAlterada: 'Dietary restriction changed',
    copiaTitulo: 'Making a copy',
    copiaAviso: 'You’re editing a recipe that isn’t yours — we’ll make a copy for you.',
  },
  // #317 (ADR-0025): `cozinhaLabel` saiu do i18n — os rótulos de cozinha agora vêm da tabela
  // `vocabulary_term` (leitor #315), resolvidos por `domain/cozinha-label.ts`.
  // Rótulo amigável por valor do enum CATEGORIAS (#56), traduzido por locale.
  categoriaLabel: {
    entrada: 'Starter',
    prato_principal: 'Main course',
    sobremesa: 'Dessert',
    bebida: 'Drink',
    molho: 'Sauce',
    acompanhamento: 'Side',
    lanche: 'Snack',
    cafe_da_manha: 'Breakfast',
  } satisfies Record<Categoria, string>,
  // Rótulo amigável por valor do enum UNIDADES (#57), traduzido por locale.
  unidadeLabel: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    colher_de_sopa: 'tablespoon',
    colher_de_cha: 'teaspoon',
    xicara: 'cup',
    unidade: 'unit',
    dente: 'clove',
    fatia: 'slice',
    pitada: 'pinch',
    a_gosto: 'to taste',
    q_b: 'as needed',
  } satisfies Record<Unidade, string>,
  // Rótulo PLURAL por unidade (ADR-0012 Adendo 2): a unidade flexiona pela quantidade; o NOME
  // nunca. Conjunto fechado/regular; `g/kg/ml/l` invariáveis. `unidade`/`a_gosto`/`q_b` nunca
  // são lidos pelo caminho plural — presentes só para satisfazer o Record.
  unidadeLabelPlural: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    colher_de_sopa: 'tablespoons',
    colher_de_cha: 'teaspoons',
    xicara: 'cups',
    unidade: 'units',
    dente: 'cloves',
    fatia: 'slices',
    pitada: 'pinches',
    a_gosto: 'to taste',
    q_b: 'as needed',
  } satisfies Record<Unidade, string>,
  // Conector LOCALIZADO entre medida e nome ("200 g OF flour"). String (espelha pt-BR `unidadeConector`).
  unidadeConector: 'of',
  // Página de detalhe da Receita (#57), mesma substância traduzida (ADR-0001, não
  // byte-idêntica). Selos de proveniência REUSAM busca.seloCatalogo/seloComunidade.
  detalhe: {
    ingredientes: 'Ingredients',
    passos: 'Steps',
    notas: 'Notes',
    descricao: 'Description',
    porcoes: 'Servings',
    dificuldade: 'Difficulty',
    tempoAtivo: 'Active time',
    tempoTotal: 'Total time',
    cozinha: 'Cuisine',
    categoria: 'Category',
    restricoes: 'Restrictions',
    tags: 'Tags',
    avisoTitulo: 'Restriction notice',
    // #237 (AI-assisted catalog disclosure, SEO #187): accessible label of the editorial COURTESY block
    // ("in collaboration between curation and AI"). The displayed TEXT comes from admin config (editable);
    // here only the block's accessible name. NOT the mandatory provenance seal — it's an additional notice.
    catalogoAvisoRotulo: 'About this catalog',
    // Source attribution (#169, ADR-0019): on the detail of a recipe IMPORTED from the web,
    // "source: …" REPLACES the "by <User>" credit. {fonte} (site name or host) interpolated via
    // `.replace`; the text links the origin URL. `fonteVerNoSite` is the external link's a11y label.
    fonte: 'source: {fonte}',
    fonteVerNoSite: 'View on the source site',
    // #272 (LGPD, ADR-0019): the owner of an imported recipe with a human source name can REMOVE it;
    // the attribution then shows only the site (source_url stays). Inline confirmation (low-risk).
    removerNomeFonte: 'Remove the source name',
    removerNomeFonteAjuda: 'The attribution will then show only the source site (the link to the page stays). The name does not come back.',
    removerNomeFonteConfirma: 'Remove',
    removerNomeFonteCancela: 'Cancel',
    removerNomeFonteErro: "We couldn't remove it right now. Try again.",
    // Back link at the top of the detail (#57) → "/" (home IS search).
    voltar: 'Back',
    // Recipe image management (#130) — owner block.
    imagemTitulo: 'Dish photo',
    imagemDescricao: 'Add a photo of your recipe. It shows on the detail page and in search.',
    imagemRevisar: 'Your recipe changed a lot. Want to swap the photo to match the new version?',
    imagemAdicionar: 'Add photo',
    imagemTrocar: 'Change photo',
    imagemRemover: 'Remove photo',
    imagemEnviando: 'Uploading…',
    imagemTipoInvalido: 'Use a JPG, PNG, or WebP image.',
    imagemGrande: 'Image too large. Try a smaller one.',
    imagemErro: "We couldn't save the photo. Try again.",
    // AI generation (#132). {tempo} interpolated in the component via `.replace`.
    imagemGerar: '✨ Generate with AI',
    imagemGerarComPrompt: 'Generate with this prompt',
    imagemGerando: 'Generating…',
    imagemRefinar: 'Refine the prompt',
    imagemPromptRotulo: 'Image prompt',
    imagemPromptPlaceholder: 'Describe how you want the dish photo to look (optional).',
    // #223: label for the READ-ONLY base prompt (built from the recipe; the refinement is always added to it).
    imagemPromptBase: 'Base prompt (built from the recipe)',
    imagemGerarErro: "We couldn't generate the image. Try again.",
    // #134: generation turned off by the admin (UI hides the button; covers the toggle-off race).
    imagemGerarDesabilitada: 'AI image generation is currently disabled.',
    // #226 (ADR-0022 dec.3): the Curator blocked AI image generation for THIS user (confirmed abuse).
    // Proactive note (hides "Generate with AI"; photo upload still works) + a modal warning
    // (defense-in-depth on the block-mid-flight race). DISTINCT from `imagemGerarDesabilitada`
    // (admin global config) — this is the per-ACCOUNT restriction.
    imagemGerarBloqueadaNota:
      'AI image generation has been turned off for this account. You can still upload your own photos.',
    imagemGerarBloqueada:
      'AI image generation has been turned off for your account. You can still upload your own photos.',
    // 24h SLIDING window (not "today"/calendar day): window-neutral copy.
    imagemLimite: "You've hit the generation limit for now. Frees up in ~{tempo}.",
    // Image studio (#222, ADR-0022): preview modal + re-selectable gallery.
    imagemSeloIa: '✨ AI-generated',
    // #285 (image-to-image): edit from an existing gallery image (distinct badge + edit mode).
    imagemSeloIaEditada: '✨ AI-edited',
    imagemEditarDesta: 'Edit from this',
    imagemEditandoDesta: 'Editing from this image',
    imagemCancelarEdicao: 'Cancel edit',
    imagemEdicaoPlaceholder: 'Describe the change you want in this image.',
    imagemPreviewTitulo: 'Generate image with AI',
    imagemPreviewDescricao: 'Preview the generated image before using it. Generating another keeps the previous ones in the gallery.',
    imagemUsarEsta: 'Use this one',
    imagemGerarOutra: 'Generate another',
    // #265: primary modal CTA in the RESTING state (no preview yet). Distinct from `imagemGerar`
    // ("✨ Generate with AI", outer button) — opening does not generate; only the click does.
    imagemGerarAgora: 'Generate',
    imagemFechar: 'Close',
    imagemGaleria: 'Image gallery',
    imagemGaleriaVazia: 'No images yet. Generate one with AI or upload your own photo.',
    imagemSelecionar: 'Use this one',
    imagemSelecionada: 'In use',
    imagemApagar: 'Delete',
    // 409 in_use: the image is still a version's face — deselect it before deleting.
    imagemApagarEmUso: 'This image is in use by a version. Pick another one before deleting it.',
    // #225: moderation × gallery (ADR-0022). A moderated image (#133) stays in the owner's gallery
    // marked "removed"; it cannot become the public face.
    imagemRemovida: 'Removed by moderation',
    // 409 imagem_moderada: trying to select a moderated image as the face.
    imagemModeradaNaoSelecionavel: 'This image was removed by moderation and cannot be used as the cover. Pick another one.',
    // US21: the SELECTED face was moderated — the public sees a placeholder; nudge to pick another.
    imagemSelecionadaModerada: 'The selected image was removed by moderation; the public sees a placeholder. Pick another image as the cover.',
  },
  // Telas de autenticação (#55), mesma substância traduzida (ADR-0001, não byte-idêntica).
  // Reusa nav.signIn/signOut onde idêntico ao header; aqui só o contextual das telas.
  auth: {
    criarConta: 'Create account',
    nome: 'Name',
    email: 'Email',
    senha: 'Password',
    senhaDica: 'At least 8 characters',
    enviando: 'Submitting…',
    continuarComGoogle: 'Continue with Google',
    ou: 'or',
    jaTemConta: 'Already have an account?',
    semConta: 'New here?',
    erroCredencialInvalida: 'Wrong email or password.',
    erroEmailEmUso: 'This email is already registered.',
    erroSenhaCurta: 'Password must be at least 8 characters.',
    erroRede: 'Could not connect. Please try again.',
    erroGenerico: 'Could not complete. Please try again.',
  },
  // Tela CRIAR estruturada (#58), mesma substância traduzida (ADR-0001, não byte-idêntica).
  criar: {
    titulo: 'Create a recipe',
    descricao: 'Build a request by fields and the AI generates the recipe.',
    descricaoPromptAberto: 'Describe the recipe you want and the AI generates it for you.',
    modoLegenda: 'Creation mode',
    modoEstruturado: 'Structured',
    modoPromptAberto: 'Open prompt',
    textareaLabel: 'Your recipe idea',
    textareaPlaceholder:
      'e.g. a quick vegan chickpea curry, no chili, for 4 people.',
    erroTextoVazio: 'Write a bit more about the recipe you want (at least 10 characters).',
    erroTextoMuitoLongo: 'Your description is too long. Use at most 2000 characters.',
    precisaEntrar: 'Sign in to create recipes.',
    legendaIngredientes: 'Ingredients',
    ingrediente: 'Ingredient',
    adicionarIngrediente: 'Add ingredient',
    removerIngrediente: 'Remove ingredient',
    ingredientePlaceholder: 'e.g., onion',
    quantidade: 'Quantity',
    quantidadePlaceholder: 'e.g., 2',
    unidade: 'Unit',
    unidadeNenhuma: 'No unit',
    forca: 'Strength',
    forcaObrigatorio: 'Required',
    forcaPreferido: 'Preferred',
    cozinha: 'Cuisine',
    cozinhaNenhuma: 'Any cuisine',
    legendaRestricoes: 'Dietary restrictions',
    porcoes: 'Servings',
    dificuldade: 'Difficulty (1 to 5)',
    tempoAtivoMin: 'Active time (min)',
    tempoTotalMin: 'Total time (min)',
    tempoAtivoExcedeTotal: 'Active time cannot exceed the total — it will be adjusted on save.',
    observacoes: 'Notes',
    observacoesPlaceholder: 'e.g., no chili, well browned',
    gerar: 'Generate recipe',
    gerando: 'Generating recipe…',
    resultadoSucesso: 'Your recipe is ready.',
    resultadoDegradado: "We generated the recipe, but couldn't meet everything you asked for.",
    playfulTitulo: 'That one was a joke.',
    playfulNota:
      "The AI answered playfully. It's saved only in your private space and can't be published.",
    consultoria: 'The AI noted',
    resultadoImpossivel: "We couldn't create a recipe from this request.",
    erroCarregarReceita:
      "The recipe was created and is in your space, but we couldn't load it right now. Please try again.",
    tentarCarregarNovamente: 'Try loading again',
    tentarNovamente: 'Adjust and try again',
    criarOutra: 'Create another recipe',
    verReceita: 'View recipe',
    erroGeracao: "Couldn't generate the recipe. Please try again.",
    erroConexao: 'Could not connect. Please try again.',
    // #167: daily recipe generation cap reached (sliding 24h window). Window-neutral copy.
    erroLimiteGeracao: "You've reached your recipe generation limit for now. Please try again later.",
    erroBriefingVazio: 'Add at least one ingredient, cuisine, restriction, or note.',
    erroPorcoes: 'Servings must be between 1 and 50.',
    erroDificuldade: 'Difficulty must be between 1 and 5.',
    erroObservacoesLongas: 'The notes are too long.',
    erroIngrediente: 'Fill in the ingredient on the lines you started.',
    erroCampos: 'Check the fields you filled in.',
    // Smart ingredient entry (#112): the AI ORGANIZES the ingredients you wrote in natural
    // language into the structured rows. It does NOT invent or generate the recipe (Extraction
    // ≠ Generation).
    entradaInteligente: 'Write your ingredients your way',
    entradaPlaceholder: 'e.g., 2 onions, salt to taste, a bit of parsley, 200g of cheese',
    estruturar: 'Structure',
    estruturando: 'Structuring…',
    entradaDistincao:
      "The AI organizes the ingredients you wrote — it doesn't invent or generate the recipe.",
    erroEntradaVazia: 'Write a bit more about the ingredients (at least 10 characters).',
    erroEntradaLonga: 'Your list is too long. Use at most 500 characters.',
    erroEstruturacao: "Couldn't organize the ingredients right now. Please try again.",
    itemUnidadeDesconhecida: "We didn't recognize the unit — pick one from the list.",
    // OUTER mode toggle of the unified Create screen (#104): Form (structured + open prompt) ↔
    // Chat (focused conversation). `seletorModo` is the segmented control's label.
    modoFormulario: 'Form',
    modoConversa: 'Chat',
    seletorModo: 'How to create',
  },
  // "New recipe" drawer (#191, ADR-0021) — reorganizes AI creation into a right-side drawer
  // (over the Sheet). The small-caps kicker + step title give the dialog's accessible name; the
  // recipe-name `<h1>` still belongs to the inner components (heading seam, F1 cancelled). This
  // slice ships the method picker + the Open prompt path end-to-end.
  criarDrawer: {
    kicker: 'New recipe',
    fechar: 'Close',
    voltar: 'Back',
    descricaoAcessivel: 'Create a recipe with the help of AI.',
    // Per-step dialog title (becomes the SheetTitle / drawer accessible name).
    tituloPicker: 'How do you want to create?',
    tituloPrompt: 'Open prompt',
    tituloEstruturado: 'Structured form',
    tituloConversa: 'Chat',
    // Method picker (3 cards).
    pickerIntro:
      'How do you want to get to your recipe? You can build it by fields, describe it all at once, or chat.',
    metodoEstruturadoTitulo: 'Structured form',
    metodoEstruturadoDesc:
      'Build it by fields — ingredients, cuisine, restrictions. The AI fills in the rest.',
    metodoPromptTitulo: 'Open prompt',
    metodoPromptDesc: 'Describe the dish all at once and generate it right away. No back and forth.',
    metodoConversaTitulo: 'Chat',
    metodoConversaDesc: 'Chat with the AI until the recipe is just the way you want.',
    // Chat path (#194) — multi-turn chat + "Distill recipe" inside the drawer. The rest of the
    // labels (bubbles, send, result/error/drop, View recipe) REUSE `conversa.*`.
    conversaIntro:
      'Chat your way to the recipe. Whenever you like, ask to distill everything into a finished recipe.',
    destilarReceita: 'Distill recipe',
    // Placeholder for the old not-yet-shipped path (kept for compat). The Structured form is now
    // the real wizard (#193) and Chat is now functional (#194).
    emBreve: 'Coming soon',
    emBreveConversa: 'Chat mode is coming here soon.',
  },
  // Structured-form wizard inside the drawer (#193, ADR-0021) — 3 steps that build the Briefing.
  // Submission REUSES the `structured` path of POST /api/generations (same payload/Briefing) and
  // the spine's cap/error/focus states (#191). The header stepper shows progress; Back preserves
  // state. Result/error/View-recipe LABELS REUSE `criar.*` (same result pipeline).
  criarWizard: {
    // Stepper steps (index 0..2). Short names to fit the header.
    passoIngredientes: 'Ingredients',
    passoCozinha: 'Cuisine',
    passoDetalhes: 'Details',
    passoLabel: 'Step {n} of 3',
    // Footer.
    continuar: 'Continue',
    gerar: 'Generate recipe',
    // Step 1 — Ingredients.
    ingredientesTitulo: 'Ingredients',
    ingredientesIntro:
      'List them all at once or add them one by one — you can go back and adjust any item.',
    modoUmAUm: 'One by one',
    modoDeUmaVez: 'All at once',
    modoIngredientesLabel: 'How to enter ingredients',
    itemPosicao: 'Ingredient {atual} of {total}',
    itemAnterior: 'Previous ingredient',
    itemProximo: 'Next ingredient',
    irParaItem: 'Go to ingredient {n}',
    adicionarOutro: 'Add another',
    bulkLabel: 'List the ingredients',
    bulkPlaceholder:
      'One ingredient per line or separated by commas\ne.g., 2 cups of cornmeal, 1 onion, 200 g of guava paste',
    bulkDistincao:
      'One ingredient per line or separated by commas — the AI splits quantity, unit, and item.',
    // Step 2 — Cuisine + Restrictions.
    cozinhaTitulo: 'Cuisine',
    cozinhaIntro: 'Where does the seasoning come from? Optional.',
    // "Other" (#319): cuisine outside the vocabulary — becomes a suggestion for the Curator.
    cozinhaOutra: 'Other',
    cozinhaOutraLabel: 'Which cuisine?',
    cozinhaOutraPlaceholder: 'e.g., Georgian cuisine',
    restricoesTitulo: 'Dietary restrictions',
    restricoesIntro: 'Mark what the recipe must respect. Declared, not verified.',
    // Step 3 — Details.
    porcoesTitulo: 'Servings',
    porcoesMenos: 'Fewer servings',
    porcoesMais: 'More servings',
    dificuldadeTitulo: 'Difficulty',
    // Short label per difficulty level (1..5) — wizard chips.
    dificuldadeNiveis: ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'],
    observacoesTitulo: 'Notes',
    observacoesPlaceholder:
      'Anything else? e.g., no chili, freezes well, very creamy texture…',
  },
  conversa: {
    titulo: 'Chat with the AI',
    descricao:
      'Chat your way to the recipe. Whenever you like, ask to distill everything into a finished recipe.',
    precisaEntrar: 'Sign in to chat and create recipes.',
    voce: 'You',
    assistente: 'AI',
    inputLabel: 'Your message',
    inputPlaceholder: "e.g., I want a quick dinner with what's in my fridge…",
    enviar: 'Send',
    enviando: 'Sending…',
    pensando: 'The AI is replying…',
    destilando: 'Distilling the recipe…',
    conversaVazia: 'Start the conversation: describe what you want to cook.',
    resultadoSucesso: 'Recipe distilled from the conversation.',
    resultadoDegradado:
      "We distilled the recipe, but couldn't meet everything the conversation asked for.",
    playfulTitulo: 'That one was a joke.',
    playfulNota:
      "The AI answered playfully. It's saved only in your private space and can't be published.",
    consultoria: 'The AI noted',
    resultadoImpossivel: "We couldn't distill a recipe from this conversation.",
    erroCarregarReceita:
      "The recipe was created and is in your space, but we couldn't load it right now. Please try again.",
    tentarCarregarNovamente: 'Try loading again',
    erroGeracao: "We couldn't distill the recipe right now.",
    redestilar: 'Distill again',
    erroConflito: 'Another action raced with this conversation. Try sending again.',
    erroConexao: 'Could not connect. Please try again.',
    quedaTitulo: 'The connection dropped before finishing.',
    quedaNota: 'Your conversation is saved. You can resume and try again.',
    retomar: 'Resume conversation',
    retomarFalhou: 'This conversation was not found or has expired.',
    verReceita: 'View and publish recipe',
    novaConversa: 'New conversation',
    apagarTranscricao: 'Delete conversation',
    apagarTituloConfirma: 'Delete this conversation?',
    apagarAviso:
      "The conversation will be deleted permanently and can't be undone. The recipe already created stays saved.",
    apagarConfirmar: 'Delete permanently',
    apagarCancelar: 'Cancel',
    apagarErro: "We couldn't delete the conversation. Try again.",
    // FOCUSED view (#104): the history sits behind "View transcript" (read-only modal).
    verTranscricao: 'View transcript',
    transcricaoTitulo: 'Conversation transcript',
    // Label for the assistant bubble in the focused view (the latest exchange's concise reply).
    respostaIA: 'AI reply',
    // ROTATING input placeholders (cycle only while the field is empty and idle) — examples with
    // the Refogando home-cooking vibe. EXACTLY 8, same length as the pt-BR array (the recursive
    // parity check treats the array as a numeric-keyed object).
    placeholders: [
      'a shrimp bobó for 4',
      'a sugar-free dessert with banana',
      'a quick dinner with what I have in the fridge',
      'a vegetarian feijoada for the weekend',
      'a light gluten-free lunch for today',
      'a cornmeal cake with guava paste',
      'a fitness meal prep with chicken and sweet potato',
      'a hearty breakfast for someone who works out',
    ],
  },
  visibilidade: {
    titulo: 'Visibility',
    privadaBadge: 'Private',
    publicaBadge: 'Public',
    privadaDescricao: 'Only you can see this recipe.',
    publicaDescricao: 'This recipe is in the community pool.',
    publicar: 'Publish',
    despublicar: 'Unpublish',
    atualizando: 'Updating…',
    playfulBloqueio: "Playful recipes stay private and can't be published.",
    // ADR-0019/#168: web imports stay private (credited to the source, never republished).
    webImportedBloqueio: "Recipes imported from the web stay private and can't be published.",
    erroPlayful: "This playful recipe can't be published.",
    erroWebImported: "Recipes imported from the web can't be published.",
    erroNaoEncontrada: "We couldn't find this recipe.",
    erroGenerico: "We couldn't change the visibility. Try again.",
    // #195/ADR-0021 (decision 4): Visibility toggle INSIDE the edit modal — local draft (no server
    // call until Save). Content saves first; only then, if visibility changed, publishing commits
    // via a separate request.
    rascunhoLegenda: 'Visibility',
    rascunhoTornarPublica: 'Make public',
    rascunhoTornarPublicaAjuda: 'It appears in the community pool when you save.',
    rascunhoManterPrivada: 'Only you can see this recipe.',
    // PARTIAL Save failure: content saved, but publish/unpublish failed. The edit is NOT lost; only
    // the visibility didn't change.
    erroVisibilidadeParcial:
      "We saved your changes, but couldn't change the visibility. Try again.",
    // Status chip (non-clickable) on the detail — the owner sees the state at a glance.
    chipRotulo: 'Visibility',
  },
  // Edit IN-PLACE + delete your OWN recipe (#21). Same substance translated (ADR-0001, not
  // byte-identical). Confirm editing the public one (#277), delete with irreversibility warning
  // (#157), and the "link lost" label when a derivative's base was deleted (#289).
  edicaoPropria: {
    editarPublicaTitulo: 'Edit public recipe',
    editarPublicaAviso:
      "This recipe is public. Your changes will be visible to anyone who saved it or is viewing it in the community.",
    editarPublicaConfirmar: 'Save changes',
    editarPublicaCancelar: 'Cancel',
    apagarTitulo: 'Delete recipe',
    apagarAviso: "Deleting is permanent: the recipe is gone for good and can't be recovered.",
    apagarConfirmar: 'Delete forever',
    apagarCancelar: 'Cancel',
    apagando: 'Deleting…',
    apagarErro: "We couldn't delete the recipe. Try again.",
    vinculoPerdido: 'The original recipe was deleted — your version is still complete, just no longer linked to it.',
    // #192/ADR-0021: centered in-place edit modal (the detail page becomes read-only). The
    // "Edit" button opens the modal; the title/description/close come from the `SheetContent`.
    modalTitulo: 'Edit recipe',
    modalDescricao: 'Change your recipe’s content. The changes apply to this same recipe.',
    modalFechar: 'Close',
    // #196/ADR-0021: the SAME modal opens to DERIVE a recipe that isn't yours. Saving never
    // mutates the base — it creates a private copy of yours and takes you to it. No Visibility
    // toggle and no Delete (the base isn't yours); the copy notice reuses `derivada.copiaAviso`.
    modalDerivarTitulo: 'Create my version',
    modalDerivarDescricao: 'Edit the content. We’ll save it as your own private copy — the original recipe stays unchanged.',
  },
  // Regeneration: new immutable version by lineage (#20). Regenerating your own recipe creates a
  // NEW version from the same request — it never overwrites; previous versions stay saved. The
  // labels are UI #61 chrome (lineage/versions); `semFonte` is the 409 error when the recipe has
  // no recoverable source to regenerate from (catalog, edited by a person, or deleted conversation).
  versao: {
    novaVersao: 'New version',
    versaoAnterior: 'Previous version',
    versaoAtual: 'Current version',
    regenerar: 'Generate a new version',
    regenerando: 'Generating a new version…',
    semFonte: 'This recipe can’t be regenerated: the original request isn’t available.',
  },
  // My creations (#61), same substance translated (ADR-0001, not byte-identical). Lists the
  // owner's recipes (NEUTRAL visibility/lineage/origin badges), the owner-affordance labels on
  // the detail (edit/delete/regenerate/view versions/create my version), and the sign-in
  // invites for the Visitor (#22 descope: anon is read-only; any account action invites sign-in).
  minhasCriacoes: {
    titulo: 'My creations',
    subtitulo: 'Everything you’ve created, newest first.',
    vazio: "You haven't created any recipes yet.",
    criarPrimeira: 'Create my first recipe',
    // Dashed "start another" card in the grid (RefoStage "Minhas criações" prototype).
    comecarOutra: 'Want to start another?',
    criarReceita: 'Create recipe',
    precisaEntrar: 'Sign in to see your creations.',
    erro: "We couldn't load your creations. Try again.",
    semTitulo: 'Untitled recipe',
    seloPrivada: 'Private',
    seloPublica: 'Public',
    seloRemovida: 'Out of the pool',
    seloPlayful: 'Playful',
    seloDerivada: 'Derived',
    seloRegenerada: 'Regenerated',
    // #169/ADR-0019: recipe IMPORTED from the web (origin=web_imported) — marker in the creations list.
    seloImportada: 'Imported from the web',
    gerenciarTitulo: 'Manage recipe',
    editar: 'Edit',
    apagar: 'Delete',
    regenerar: 'Generate a new version',
    criarMinhaVersao: 'Create my version',
    diffTitulo: 'What changed from the original',
    convidaEntrarTitulo: 'Sign in to do this',
    convidaEntrarTexto: 'Create an account or sign in to create, save, and manage recipes.',
  },
  perfil: {
    titulo: 'Your profile',
    subtitulo: 'Edit how you appear to the community.',
    nome: 'Display name',
    email: 'Email',
    emailDica: 'Your email is used to sign in and cannot be changed here.',
    handle: 'Handle',
    // {handle} interpolated in the component via `.replace` (type leaves are strings).
    handleDica: 'The address of your public profile: /u/{handle}. Changing it breaks old links.',
    handlePlaceholder: 'your-handle',
    handleInvalido: 'Use 3 to 30 lowercase letters, numbers, and hyphens (no accents, spaces, or edge hyphens).',
    handleReservado: 'That handle is reserved. Pick another one.',
    handleEmUso: 'That handle is already taken. Pick another one.',
    bio: 'Bio',
    bioPlaceholder: 'Tell us a bit about yourself and what you like to cook.',
    bioContador: '{n}/280',
    // Social links (#127). Editor of up to 5 rows (type + url) on the profile.
    links: 'Links',
    linksDica: 'Add up to 5 links (social, website). Only http(s) addresses are accepted.',
    linkTipoRotulo: 'Link type',
    linkUrlRotulo: 'Link URL',
    linkUrlPlaceholder: 'https://…',
    linkAdicionar: 'Add link',
    linkRemover: 'Remove link',
    linkInvalido: 'Use a valid http(s) address (no javascript:, spaces, or unsafe schemes).',
    linkTipoInstagram: 'Instagram',
    linkTipoX: 'X',
    linkTipoGithub: 'GitHub',
    linkTipoYoutube: 'YouTube',
    linkTipoSite: 'Website',
    // Avatar (#126). {name} interpolated in the component via `.replace` (type leaves are strings).
    avatarAlt: 'Photo of {name}',
    avatarEnviar: 'Upload photo',
    avatarTrocar: 'Change photo',
    avatarRemover: 'Remove photo',
    avatarEnviando: 'Uploading…',
    avatarTipoInvalido: 'Use a JPG, PNG, or WebP image.',
    avatarGrande: 'Image too large. Try a smaller one.',
    avatarErro: "We couldn't save your photo. Try again.",
    salvar: 'Save',
    salvando: 'Saving…',
    salvo: 'Profile saved.',
    precisaEntrar: 'Sign in to edit your profile.',
    erro: "We couldn't save your profile. Try again.",
  },
  // PUBLIC profile (#129) — the `/u/<handle>` page an anonymous Visitor sees: name, avatar, bio,
  // links, and that person's PUBLIC recipes. Distinct from `perfil` (the owner's EDIT screen at
  // /me/profile). `receitasTitulo`/`semReceitas` label the recipes section.
  perfilPublico: {
    receitasTitulo: 'Recipes',
    // Back link at the top of the public profile (#129) → "/".
    voltar: 'Back',
    semReceitas: "This person hasn't published any recipes yet.",
    // Accessible avatar label (alt). {name} interpolated via `.replace` in the component.
    avatarAlt: 'Photo of {name}',
    // Accessible label for the social links block.
    linksLabel: 'Links',
    // Social (#274, ADR-0024) — Cook voice. Counters use the '{n}' placeholder (.replace in the
    // component); nudge mirrors `comunidade.convidaEntrarSalvar`.
    seguir: 'Follow',
    seguindo: 'Following',
    // Follower count has a singular ("1 follower"); "following" is invariant, one key suffices.
    seguidorContagem: '{n} follower',
    seguidoresContagem: '{n} followers',
    seguindoContagem: '{n} following',
    // Recipe counter on the Instagram-style stats line — comes from `recipes.length` (no extra query).
    // Has a singular ("1 recipe"), mirroring the follower counter.
    receitaContagem: '{n} recipe',
    receitasContagem: '{n} recipes',
    entrarParaSeguir: 'Sign in to follow',
    erroSeguir: "Couldn't complete. Try again.",
    seguidoresTitulo: 'Followers',
    seguindoTitulo: 'Following',
    // Full list (#307) — "see all" modal opened by the counters. Title reuses followers/following; the
    // description is the aria-describedby (#181). "Load more" paginates; empty/error states localized.
    listaDescricao: 'Full list of cooks.',
    carregarMais: 'Load more',
    // Page-1 loading state; X button label (≠ 'Back', which is navigation); the "load more" error is
    // INLINE (never wipes the already-loaded list) and separate from the page-1 error.
    listaCarregando: 'Loading…',
    listaFechar: 'Close',
    listaVazia: 'No one here yet.',
    listaErro: "Couldn't load the list. Try again.",
    listaErroMais: "Couldn't load more. Try again.",
  },
  comunidade: {
    titulo: 'Community',
    salvar: 'Save',
    salvo: 'Saved',
    ordenarPor: 'Sort the Community by',
    toggleRelevancia: 'Relevance',
    togglePopularidade: 'Popularity',
    convidaEntrarSalvar: 'Sign in to save',
    erroSalvar: 'Could not save. Try again.',
  },
  colecoes: {
    titulo: 'Saved',
    subtitulo: 'Your saved recipes, organized into collections.',
    todos: 'All',
    colecoes: 'Collections',
    novaColecao: 'New collection',
    nomeColecao: 'Collection name',
    criar: 'Create',
    renomear: 'Rename',
    apagar: 'Delete',
    salvarNome: 'Save',
    cancelar: 'Cancel',
    confirmarApagar: 'Delete this collection? The recipes stay saved.',
    adicionarAColecao: 'Add to collection',
    itemContagem: '{n} recipe',
    itensContagem: '{n} recipes',
    vazio: "You haven't saved any recipes yet.",
    vazioColecao: 'No recipes in this collection yet.',
    semColecoes: "You haven't created any collections yet.",
    erroNomeInvalido: 'Choose a name (up to 60 characters).',
    erroNomeDuplicado: 'You already have a collection with that name.',
    erroLimite: "You've reached the collection limit.",
    erro: 'Something went wrong. Try again.',
    erroCarregar: 'Could not load. Try again.',
    precisaEntrar: 'Sign in to see your saved recipes.',
  },
  avaliacoes: {
    titulo: 'Reviews',
    editar: 'Edit',
    apagar: 'Delete',
    enviar: 'Submit',
    salvando: 'Saving…',
    comentarioLabel: 'Comment (optional)',
    comentarioPlaceholder: 'Tell us how it turned out…',
    notaLabel: 'Your rating',
    estrela: '{n} star',
    estrelas: '{n} stars',
    media: '★ {media} · {n} reviews',
    mediaUma: '★ {media} · 1 review',
    semAvaliacoes: 'No reviews yet. Be the first to review.',
    convidaEntrar: 'Sign in to review',
    erroEnviar: 'Could not submit your review. Try again.',
    erroApagar: 'Could not delete your review. Try again.',
    // #366: the viewer's own review was MODERATED (removed by the Curator). Read-only state —
    // no stars/Edit/Delete (the delete is a server no-op; we don't offer the lying action).
    suaAvaliacaoRemovida: 'Your review was removed by a moderator.',
    // #366: report someone else's review (report→Curator). The author does NOT report their own; nobody
    // REMOVES (only the Curator, from the queue). On success ⇒ disabled "Reported" state.
    reportar: 'Report',
    reportado: 'Reported',
    motivoReport: 'Report reason',
    cancelarReport: 'Cancel',
    erroReport: 'Could not report. Try again.',
    // #365: dish PHOTO on a review (upload/camera, NO AI). Add/change/remove + type/size/upload errors;
    // `fotoAlt` is the alt text (content/proof, not decorative).
    adicionarFoto: 'Add photo',
    trocarFoto: 'Change photo',
    removerFoto: 'Remove photo',
    fotoTipoInvalido: 'Use a JPG, PNG or WebP image.',
    fotoGrande: 'Image too large. Try a smaller one.',
    erroFoto: 'Could not upload the photo. Try again.',
    fotoAlt: 'Photo of the dish',
  },
  admin: {
    titulo: 'Admin console',
    subtitulo: 'Configuration, roles, and curation.',
    acessoNegadoTitulo: 'Restricted area',
    acessoNegado: "You don't have permission to access this area.",
    voltarInicio: 'Back to home',
    configTitulo: 'Default generation model',
    modeloLabel: 'Model',
    modeloOpus: 'Claude Opus 4.8 (quality)',
    modeloSonnet: 'Claude Sonnet 4.6 (cost)',
    salvar: 'Save',
    salvando: 'Saving…',
    salvo: 'Configuration saved.',
    erroModelo: 'Invalid model.',
    papeisTitulo: 'User roles',
    // User search (#269): replaces "paste the UUID" with search by name/@handle/email/ID.
    buscaUsuarioLabel: 'Search user',
    buscaUsuarioPlaceholder: 'Name, @handle, email or ID',
    buscaUsuarioCarregando: 'Searching…',
    buscaUsuarioVazio: 'No users found.',
    buscaUsuarioContagem: '{n} result(s)',
    buscaUsuarioResultados: 'Search results',
    usuarioSelecionado: 'Selected',
    trocarUsuario: 'Change',
    papelLabel: 'New role',
    papelUsuario: 'User',
    papelCurador: 'Curator',
    papelAdmin: 'Administrator',
    aplicarPapel: 'Apply role',
    aplicandoPapel: 'Applying…',
    promovido: 'Role updated.',
    grupoPlataforma: 'Platform',
    grupoCuradoria: 'Curation',
    navAria: 'Console sections',
    navIa: 'AI',
    navPapeis: 'Roles',
    navModeracao: 'Moderation',
    navTraducoes: 'Translations',
    navCatalogo: 'Catalog',
    // ── #321: cuisine taxonomy CRUD (Governance, admin-only). CONTIGUOUS block to ease the merge
    //    with #319 (which also edits these i18n files). ──
    navVocabulario: 'Cuisines',
    vocabTitulo: 'Cuisine taxonomy',
    vocabDescricao:
      'Add, rename and deprecate cuisines. Deprecating removes a cuisine from new options but keeps what was already saved.',
    vocabSlugLabel: 'Slug (identifier, e.g. korean)',
    vocabRotuloPt: 'Label (pt-BR)',
    vocabRotuloEn: 'Label (en-US)',
    vocabAdicionar: 'Add cuisine',
    vocabAdicionando: 'Adding…',
    vocabSalvar: 'Save',
    vocabSalvando: 'Saving…',
    vocabEditar: 'Edit labels',
    vocabCancelar: 'Cancel',
    vocabDepreciar: 'Deprecate',
    vocabReativar: 'Reactivate',
    vocabStatusAtiva: 'Active',
    vocabStatusDepreciada: 'Deprecated',
    vocabSalvo: 'Changes saved.',
    vocabCarregando: 'Loading…',
    vocabErroCarregar: 'Could not load cuisines.',
    vocabTentarNovamente: 'Try again',
    vocabErroSlug: 'Invalid slug: use only lowercase letters, numbers and hyphens (e.g. korean).',
    vocabErroRotulos: 'Fill in both labels (pt-BR and en-US).',
    vocabErroSlugEmUso: 'A cuisine with that slug already exists.',
    vocabErroNaoEncontrado: 'Cuisine not found.',
    vocabErroInterno: 'Something went wrong. Try again.',
    // #268: the /admin/descoberta tab holds the SEARCH infra — web discovery + embeddings; generative AI
    // (recipe model + image generation + caps) moved to the "AI" tab (/admin/ia).
    navDescoberta: 'Discovery',
    // "Image generation" section (#134) — lives on the "AI" tab (/admin/ia); toggle, model, caps.
    aiTitulo: 'AI image generation',
    aiDescricao: 'Control recipe image generation: on/off, model and daily caps per role.',
    aiHabilitadaLabel: 'Image generation on',
    aiModeloLabel: 'Model',
    aiModeloNanoBanana: 'Nano Banana 2 (Gemini)',
    aiTetosLabel: 'Image caps per role (24h window)',
    // #167: per-role recipe generation cap (separate axis from the image cap).
    aiTetoReceitaLabel: 'Recipe generation caps per role (24h window)',
    aiTetoIlimitado: 'unlimited',
    aiTetoAjuda: 'Leave blank for unlimited. 0 blocks the role.',
    aiErroConfig: 'Invalid configuration. Review the caps and model.',
    // #164: web discovery (ADR-0019) — on/off + allowlist of domains. The allowlist is the SINGLE
    // source of truth for both web search and the import SSRF guard. One domain per line.
    webTitulo: 'Web discovery',
    webDescricao: 'When our collection is shallow, show external web links. Set the allowed domains (one per line).',
    webHabilitadaLabel: 'Web discovery on',
    webAllowlistLabel: 'Allowed domains',
    webAllowlistAjuda: 'One domain per line (e.g., tudogostoso.com.br). Empty blocks everything.',
    webErroConfig: 'Invalid configuration. Review the domains (one hostname per line, no http:// or path).',
    // #273: suggested domains (click-to-add) — a curation shortcut. Clicking only appends to the field
    // above; adding = vetting (it does not save or turn discovery on). Both groups show (allowlist is global).
    webSugeridosTitulo: 'Suggested domains',
    webSugeridosDescricao:
      'Shortcuts to fill the list. Clicking only appends the domain to the field above — it does not save or turn discovery on.',
    webSugeridosGrupoBrasil: 'Brazil',
    webSugeridosGrupoInternacional: 'International',
    webSugeridoAdicionarAria: 'Add {dominio} to the list',
    webSugeridoJaAdicionado: 'already in the list',
    webVetarLembrete:
      'Adding a domain = vetting it. Check the robots.txt and terms of use of the site first.',
    // #273: health probe — paste a sample recipe URL and check (a) schema.org/Recipe JSON-LD and (b) the
    // origin robots.txt, BEFORE vetting. Verdict by copy + state (no color alone — AA a11y).
    webProbeUrlLabel: 'Check a sample recipe',
    webProbePlaceholder: 'https://site.com/cake-recipe',
    webProbeChecar: 'Check',
    webProbeChecando: 'Checking…',
    webProbeJsonLdSim: 'Has a JSON-LD recipe (schema.org/Recipe).',
    webProbeJsonLdIdiomaNaoSuportado: 'Has a JSON-LD recipe, but in a language outside PT/EN.',
    webProbeJsonLdNao: 'No usable JSON-LD recipe.',
    webProbeRobotsPermite: 'robots.txt allows RefogandoBot on that path.',
    webProbeRobotsBloqueia: 'robots.txt blocks RefogandoBot on that path.',
    webProbeImportavel: 'Ready to import after you vet the domain.',
    webProbeNaoImportavel: 'This page cannot be imported yet.',
    webProbeNaoCarregou: 'Could not load the page. Check the URL.',
    webProbeErro: 'Could not check right now. Try again.',
    webProbeUrlInvalida: 'Invalid URL. Use a public http(s) site.',
    // #237: AI-assisted catalog disclosure (SEO #187) — on/off + editable text. Editorial COURTESY:
    // shows only on catalog recipes when on; NEVER replaces the mandatory AI-generation seals.
    catalogoAvisoTitulo: 'Catalog disclosure (AI-assisted)',
    catalogoAvisoDescricao:
      'Show an optional notice on catalog recipes stating they may be produced in collaboration between curation and AI. Does not replace the mandatory AI-generation seals.',
    catalogoAvisoHabilitadoLabel: 'Catalog disclosure on',
    catalogoAvisoTextoLabel: 'Disclosure text',
    catalogoAvisoTextoAjuda: 'Phrase shown on catalog recipes when the disclosure is on.',
    catalogoAvisoErroConfig: 'Invalid configuration. The disclosure text cannot be empty.',
    // Semantic-search embeddings backfill (#119) — batched, resumable recompute.
    backfillTitulo: 'Semantic-search embeddings',
    backfillDescricao:
      "Recompute search vectors for recipes that don't have them yet (created before the feature). Run until \"remaining: 0\".",
    backfillBtn: 'Recompute embeddings',
    backfillRodando: 'Recomputing…',
    backfillResultado: 'Recomputed: {recomputados} · remaining: {restantes}.',
    backfillResultadoParcial:
      'Recomputed: {recomputados} · remaining: {restantes}. The embedding service stopped (no key or rate limit). Run again later.',
    backfillErro: 'Could not recompute. Try again.',
    // External author (data subject B, no account) intake — #396/GAP-4. Removes the source NAME in bulk
    // by name/URL, without requiring the recipe to belong to the operator. Keeps the URL; irreversible.
    takedownTitulo: 'Remove attribution (author request)',
    takedownDescricao:
      "Handles an external site author who asked to have their name removed. Removes the source name from ALL imported recipes (including users' private ones) matching the name or URL. The source URL is kept (attribution then shows only the site). Run the preview before removing.",
    takedownNomeLabel: 'Displayed source name',
    takedownNomePlaceholder: 'e.g., Grandma’s Kitchen',
    takedownUrlLabel: 'Source URL',
    takedownUrlPlaceholder: 'https://site.com/recipe',
    takedownCaseIdLabel: 'DSAR ticket ID (optional)',
    takedownCaseIdPlaceholder: 'ticket uuid, if any',
    takedownPrevia: 'Preview',
    takedownPreviaRodando: 'Searching…',
    takedownRemover: 'Remove name',
    takedownRemovendo: 'Removing…',
    takedownPreviaResultado: 'Matched: {casaram} · with a name to remove: {removiveis}.',
    takedownNomesRemovidos: 'Names that will be removed',
    takedownRemovido: 'Name removed from {removiveis} recipe(s). URL preserved.',
    takedownNada: 'No recipe with a human name to remove matched the criteria.',
    takedownCriterioObrigatorio: 'Provide at least the source name OR URL.',
    takedownCaseIdInvalido: 'Invalid ticket ID (must be a uuid).',
    takedownErro: 'Could not complete. Try again.',
    // Escalation beyond the name (subject B) — #397/GAP-3. Unlink the whole URL or delete the import.
    // The POLICY of when to use it awaits legal sign-off (#276); the mechanism does not decide alone.
    escalonarTitulo: 'Escalate beyond the name (unlink URL / delete import)',
    escalonarAviso:
      'The POLICY of WHEN to escalate (unlink the URL or delete the recipe) awaits legal sign-off (#276). This mechanism does not decide on its own — use only under guidance. It reuses the name/URL entered above.',
    escalonarAcaoLabel: 'Action',
    escalonarAcaoUnlink: 'Unlink URL (clears URL and name)',
    escalonarAcaoDelete: 'Delete imported recipe (irreversible)',
    escalonarPrevia: 'Escalation preview',
    escalonarPreviaRodando: 'Searching…',
    escalonarPreviaResultado: '{casaram} imported recipe(s) matched the criteria.',
    escalonarUrlsAfetadas: 'URLs that will be removed',
    escalonarNomesAfetados: 'Names that will be removed',
    // Warning read BEFORE confirming the destructive action: selection is OR (union), not AND
    // (intersection), and the effect is irreversible. Filling name AND url drags in the union.
    escalonarUniaoAviso:
      'Warning: selection is by name OR URL (union) — filling both matches ALL recipes with that name PLUS all with that URL, not the intersection. Check the scope above; this action is IRREVERSIBLE.',
    escalonarConfirmUnlink: 'Confirm: unlink URL',
    escalonarConfirmDelete: 'Confirm: delete import',
    escalonarAplicando: 'Applying…',
    escalonarUnlinkOk: 'URL and name unlinked from {n} recipe(s).',
    escalonarDeleteOk: '{n} imported recipe(s) deleted.',
    escalonarNada: 'No imported recipe matched the criteria.',
    escalonarErro: 'Could not complete the escalation. Try again.',
    erroPapelInvalido: 'Invalid role.',
    erroNaoAplicado: 'Could not apply the role.',
    erroGenerico: 'Something went wrong. Try again.',
  },
  moderacao: {
    titulo: 'Moderation queue',
    receita: 'Recipe',
    origem: 'Origin',
    tipoResultado: 'Result type',
    motivoReport: 'Report reason',
    status: 'Status',
    statusPendente: 'Pending',
    origemCatalog: 'Catalog',
    origemAiChat: 'AI chat',
    origemAiStructured: 'Structured briefing',
    origemAiFreeText: 'Open prompt',
    origemUserEdited: 'Edited by a person',
    origemWebImported: 'Imported from the web',
    tipoSucesso: 'Success',
    tipoDegradado: 'Degraded',
    tipoPlayful: 'Playful',
    manter: 'Keep in pool',
    remover: 'Remove from pool',
    motivoRemocao: 'Reason for removal',
    motivoPlaceholder: 'Explain why this recipe leaves the pool',
    confirmarRemocao: 'Confirm removal',
    cancelar: 'Cancel',
    removendo: 'Removing…',
    // "Remove image only" (#133): hides the photo from the public WITHOUT removing the recipe from the pool.
    removerImagem: 'Remove image only',
    removendoImagem: 'Removing image…',
    filaVazia: 'No pending reports.',
    erroMotivo: 'Enter the reason for removal.',
    erroSemImagem: 'This recipe has no image to remove.',
    erroJaResolvido: 'This report has already been resolved.',
    erroGenerico: 'Could not process the report. Try again.',
    // #226 (ADR-0022 dec.3 / 1st hook of ADR-0007): the Curator blocks/unblocks AI image generation
    // for the AUTHOR of the reported recipe (confirmed abuse). Only shown when there's an owner
    // (Catalog → no action). Reason is REQUIRED to block (mirrors remove-from-pool).
    bloquearGeracao: "Block author's image generation",
    confirmarBloqueio: 'Confirm block',
    desbloquearGeracao: "Unblock author's image generation",
    bloqueandoGeracao: 'Blocking…',
    desbloqueandoGeracao: 'Unblocking…',
    motivoBloqueioGeracao: 'Reason for the block',
    motivoBloqueioPlaceholder: 'Explain why the author loses AI image generation',
    erroUsuarioNaoEncontrado: "Couldn't find this recipe's author.",
    // #366: card for a report about a REVIEW. The Curator removes the WHOLE review (rating+comment+
    // photo) — a logical removal — or KEEPS it (keep, the only dismissal). The owner has no action here.
    avaliacaoDe: 'Review author',
    avaliacaoNota: 'Rating',
    avaliacaoComentario: 'Comment',
    avaliacaoSemComentario: 'No comment',
    // #365: the reported PHOTO, shown to the Curator (gated route) to judge with visibility.
    avaliacaoFoto: 'Photo',
    avaliacaoFotoAlt: 'Review photo',
    removerAvaliacao: 'Remove review',
    removendoAvaliacao: 'Removing review…',
    erroSemAvaliacao: 'This report is not about a review.',
  },
  // #227 (ADR-0022 dec.3): PROACTIVE, NON-BLOCKING Curator queue — AI generations WITH the author's
  // refinement. The image stays public (default-open, ADR-0020); the Curator only monitors and can
  // REMOVE (moderate, hides it from the public) OR DISMISS (judged fine, keeps it public).
  revisaoImagens: {
    titulo: 'Images to review',
    descricao:
      "AI generations with the author's refinement. The image stays visible to the public — this queue is just for monitoring. Remove it (hides it from the public) or dismiss it (keeps it visible).",
    receita: 'Recipe',
    autor: 'Author',
    semReceita: 'No linked recipe',
    refinada: 'Generated with refinement',
    abrirReceita: 'Open recipe',
    remover: 'Remove',
    removendo: 'Removing…',
    confirmarRemocao: 'Confirm removal',
    motivoRemocao: 'Reason for removal',
    motivoPlaceholder: 'Explain why this image leaves the public view',
    dispensar: 'Dismiss',
    dispensando: 'Dismissing…',
    cancelar: 'Cancel',
    filaVazia: 'No images to review.',
    erroMotivo: 'Enter the reason for removal.',
    erroNaoEncontrada: 'This image is no longer in the queue.',
    erroGenerico: 'Could not process the image. Try again.',
  },
  // #320 (ADR-0025 Decision 5): the Curator's REACTIVE queue for cuisines SUGGESTED via the "Other"
  // flow (#319). This is the only Curator surface that shows the raw suggested slug. The Curator
  // approves (turns it into a facet, naming the labels and optionally fixing the canonical slug),
  // merges into an active cuisine, or rejects.
  filaCozinhas: {
    titulo: 'Suggested cuisines',
    descricao:
      'Cuisines proposed by users (the "Other" option). Approve to make it a facet, merge into an existing one, or reject.',
    cozinha: 'Suggested cuisine',
    receitas: 'Recipes',
    rotuloPtBr: 'Label (Portuguese)',
    rotuloEnUs: 'Label (English)',
    slugCanonico: 'Fix the slug (optional)',
    slugCanonicoPlaceholder: 'e.g. georgian',
    alvoMesclar: 'Merge into cuisine (slug)',
    alvoPlaceholder: 'e.g. italiana',
    aprovar: 'Approve',
    confirmarAprovacao: 'Confirm approval',
    aprovando: 'Approving…',
    mesclar: 'Merge',
    confirmarMesclagem: 'Confirm merge',
    mesclando: 'Merging…',
    rejeitar: 'Reject',
    rejeitando: 'Rejecting…',
    cancelar: 'Cancel',
    filaVazia: 'No suggested cuisines.',
    erroRotulos: 'Enter both labels (Portuguese and English).',
    erroSlugInvalido: 'Invalid slug. Use only lowercase letters, numbers and hyphens.',
    erroSlugEmUso: 'A cuisine with that slug already exists.',
    erroAlvoInvalido: 'Pick an existing active cuisine to merge into.',
    erroJaResolvido: 'This suggestion has already been resolved.',
    erroNaoEncontrado: 'This suggestion no longer exists.',
    erroGenerico: 'Could not process the suggestion. Try again.',
  },
  traducoesStale: {
    titulo: 'Outdated translations',
    receita: 'Recipe',
    idioma: 'Language',
    origem: 'Origin',
    provAutomaticaNaoRevisada: 'Automatic (not reviewed)',
    provAutomaticaRevisada: 'Automatic (reviewed)',
    provEscritaPorPessoa: 'Written by a person',
    marcarRevisada: 'Mark as reviewed',
    marcando: 'Marking…',
    listaVazia: 'No outdated translations.',
    erroGenerico: 'Could not mark as reviewed. Try again.',
  },
  curadoria: {
    titulo: 'Catalog curation',
    ingredientesTitulo: 'Recurring ingredients',
    aparicoes: 'Appearances',
    promover: 'Promote to canonical',
    promovendo: 'Promoting…',
    promocaoVazia: 'No recurring ingredients to promote.',
    erroSlugEmUso: 'This ingredient already exists.',
    erroGenerico: 'Could not promote. Try again.',
    // #266: right-side drawer trigger + X label (ADR-0021).
    criarReceitaBotao: 'New catalog recipe',
    criarReceitaFechar: 'Close',
    criarReceitaTitulo: 'Create catalog recipe',
    criarReceitaDescricao: 'Add a complete recipe to the editorial collection.',
    criarReceitaTituloCampo: 'Title',
    criarReceitaObrigatorio: '(required)',
    criarReceitaTituloPlaceholder: 'E.g., Feijoada',
    criarReceitaIdiomaOriginal: 'Original language',
    criarReceitaDescricaoCampo: 'Description',
    criarReceitaIngredientes: 'Ingredients',
    criarReceitaIngrediente: 'Ingredient',
    criarReceitaIngredientePlaceholder: 'E.g., black beans',
    criarReceitaQuantidade: 'Amount',
    criarReceitaQuantidadePlaceholder: 'E.g., 500',
    criarReceitaUnidade: 'Unit',
    criarReceitaUnidadeNenhuma: 'No unit',
    criarReceitaAdicionarIngrediente: 'Add ingredient',
    criarReceitaRemoverIngrediente: 'Remove',
    criarReceitaCozinha: 'Cuisine',
    criarReceitaCozinhaNenhuma: 'None',
    criarReceitaCategoria: 'Category',
    criarReceitaCategoriaNenhuma: 'None',
    criarReceitaRestricoes: 'Dietary restrictions',
    criarReceitaPorcoes: 'Servings',
    criarReceitaDificuldade: 'Difficulty (1 to 5)',
    criarReceitaPassos: 'Steps',
    criarReceitaPasso: 'Step',
    criarReceitaAdicionarPasso: 'Add step',
    criarReceitaRemoverPasso: 'Remove',
    criarReceitaNotas: 'Notes',
    criarReceitaEnviar: 'Create recipe',
    criarReceitaEnviando: 'Creating…',
    criarReceitaSucesso: 'Recipe added to the catalog.',
    criarReceitaErroTitulo: 'Enter the recipe title.',
    criarReceitaErroDados: 'Check the fields: a value is invalid.',
    criarReceitaErroConexao: 'Couldn’t connect. Try again.',
    criarReceitaErroGenerico: 'Couldn’t create the recipe. Try again.',
    // #238/ADR-0026: AI-drafted catalog recipe curation queue.
    filaTitulo: 'Recipes pending curation',
    filaVazia: 'No pending recipes.',
    filaAprovar: 'Approve',
    filaAprovando: 'Approving…',
    filaRejeitar: 'Reject',
    filaRejeitando: 'Rejecting…',
    filaRejeitarNota: 'Rejection reason (optional)',
    filaRejeitarConfirmar: 'Confirm rejection',
    filaRejeitarCancelar: 'Cancel',
    filaErro: 'Couldn’t complete. Try again.',
    filaCozinha: 'Cuisine',
    filaCategoria: 'Category',
    filaPorcoes: 'Servings',
    filaDificuldade: 'Difficulty',
    filaRejeitadasTitulo: 'Rejected',
    filaRejeitadasVazia: 'None rejected.',
    filaRestaurar: 'Restore to queue',
    filaRestaurando: 'Restoring…',
    filaVer: 'View recipe',
    filaOcultar: 'Hide',
    filaIngredientes: 'Ingredients',
    filaPreparo: 'Steps',
    filtroTodasCozinhas: 'All cuisines',
    filtroTodasCategorias: 'All categories',
    filtroBusca: 'Search by title…',
    filaVerMais: 'Show more',
    filaSemFiltro: 'No pending recipes match this filter.',
    filaContagem: 'pending',
    // #238 (amendment): edit-before-approve + catalog image.
    filaEditar: 'Edit',
    filaEditarSalvar: 'Save',
    filaEditarTitulo: 'Edit draft',
    filaEditarDescricao: 'Adjust the content before approving. Changes stay hidden until you approve.',
    filaImagem: 'Image',
    filaImagemOcultar: 'Hide image',
    filaImagemGerar: 'Generate image',
    filaImagemGerarOutra: 'Generate another',
    filaImagemSubir: 'Upload photo',
    filaImagemRemover: 'Remove photo',
    filaImagemSemFoto: 'No photo',
    filaImagemUsarEsta: 'Use this',
    filaImagemFaceAtual: 'Current photo',
    filaImagemApagar: 'Delete image',
    filaImagemErro: 'Could not update the image. Try again.',
    filaImagemTipoInvalido: 'Invalid format (use JPG, PNG, or WebP).',
    filaImagemGrande: 'Image too large (max 2 MB).',
  },
  // Privacy Policy (#398 / part of #276) — PUBLISHED (indexable, linked in the footer + sitemap). Keys are
  // FLAT within the section (the `Messages` type derives only 2 levels): string leaves or
  // `readonly string[]` (lists/tables by index). The placeholders were resolved with the real contacts
  // written DIRECTLY into these strings (this section is the single place to edit the DPO name/e-mail).
  // Published by the owner's decision; the legal sign-off is still pending in #276.
  privacidade: {
    metaTitulo: 'Privacy Policy — Refogando',
    titulo: 'Privacy Policy',

    parteATitulo: 'Part (a) — Privacy Policy',
    resumoTitulo: '30-second summary',
    resumoItens: [
      'Refogando is a bilingual (pt-BR / en-US) AI recipe app.',
      'We collect the minimum: what is needed for you to have an account and use the app and, when you import a recipe from an external site, the author/site name and the source link, solely to give credit.',
      'We do not sell your data. We share it only with service providers that make the app work (hosting, database, AI).',
      'You have rights (access, correction, deletion, etc. — Art. 18 of the LGPD). Contact our data protection officer: privacidade@refogando.com. We respond within 15 days.',
      'This text may change; we notify you when it does.',
    ],

    s1Titulo: '1. Who we are (identification of the controller) — Art. 9, III',
    s1Corpo: [
      'The data controller is Fernando Lisboa, an individual responsible for the Refogando app (https://refogando.com).',
      'Because Refogando is operated by an individual, there is no legal entity name or tax ID (CNPJ) associated; the official contact is the privacy e-mail indicated below.',
    ],

    s2Titulo: '2. Contact of the controller and the data protection officer (DPO) — Art. 9, IV; Art. 41',
    s2Itens: [
      'Data protection officer (DPO): Fernando Lisboa.',
      'Contact e-mail for privacy matters and exercising rights: privacidade@refogando.com.',
      'Response time: we answer data subject requests within 15 days (LGPD, Art. 19, II).',
    ],

    s3Titulo: '3. What we use your data for (specific purpose) — Art. 9, I; Art. 6, I',
    s3Intro:
      'We process personal data only for specific, informed purposes. Each activity follows the Data / Purpose / Legal basis / Retention pattern.',
    s3Nota:
      'The full inventory of account/usage data is still to be finalized with the team and validated; the table below is the skeleton of the confirmed processing activities. The Web Discovery feature is detailed in Part (b).',

    rotuloDados: 'Data',
    rotuloFinalidade: 'Purpose',
    rotuloBaseLegal: 'Legal basis',
    rotuloRetencao: 'Retention',

    s31Titulo: '3.1. User account and authentication',
    s31Valores: [
      'e-mail, display name/identifier (handle), login credentials and profile photo, bio, links and preferred language.',
      'create and maintain your account, authenticate access and enable use of the app.',
      'performance of a contract with the data subject — Art. 7, V of the LGPD.',
      'while the account exists; after deletion, we immediately anonymize the identifying data and erase the physical residue (such as images) after a retention period.',
    ],
    s32Titulo: '3.2. Content created in the app (recipes, collections, ratings)',
    s32Valores: [
      'recipes you create, save, rate and organize; language preferences; text content you write.',
      'deliver the app functionality (store and display your content, build collections, feed and search).',
      'performance of a contract — Art. 7, V.',
      'while the account exists or until you delete the content.',
    ],
    s33Titulo: '3.3. AI-generated images and AI-assisted content',
    s33Valores: [
      'prompts and images you generate; usage metadata (for cost/quota control).',
      'generate dish images and support recipe creation; enforce usage limits.',
      'performance of a contract — Art. 7, V; and legitimate interest for abuse prevention/cost control — Art. 7, IX.',
      'while the account exists or until you delete the content.',
    ],
    s34Titulo: '3.4. Attribution of recipes imported from the web ("Web Discovery")',
    s34Corpo:
      'Detailed in Part (b). In short: we keep the author/site name and source URL, solely to give credit. Legal basis: legitimate interest — Art. 7, IX (with data made manifestly public — Art. 7, §4 as an alternative ground).',

    s4Titulo: '4. How and for how long we process (means and duration) — Art. 9, II',
    s4Itens: [
      'How: data is processed by electronic means, on servers of contracted service providers (see item 5). We apply appropriate security measures (Art. 46), including access control by authentication and authorization by ownership.',
      'For how long: we keep each piece of data only for as long as necessary for the purpose that justifies it (item 3) or for a legal obligation. When the purpose ends, we erase or anonymize the data (Art. 15/16). Specific terms follow the purpose of each processing activity described in item 3.',
    ],

    s5Titulo: '5. Who we share with (shared use) — Art. 9, V',
    s5Intro:
      'We do not sell personal data. We share it with processors (service providers that process data on our behalf, under contract) strictly to operate the app:',
    s5Cabecalho: ['Provider', 'For what', 'Category'],
    s5Prestadores: ['Vercel', 'Neon', 'Google (Gemini)', 'Anthropic (Claude)', 'Brave Search'],
    s5ParaQue: [
      'App hosting',
      'Database',
      'Image generation and search embeddings',
      'Text generation/assistance',
      'External link search in "Web Discovery"',
    ],
    s5Categorias: [
      'Infrastructure processor',
      'Infrastructure processor',
      'AI processor',
      'AI processor',
      'Search processor',
    ],
    s5Nota: 'Purpose of sharing: exclusively the technical operation of the functions above; no partner receives data for its own marketing purposes.',
    s5Transferencia:
      'International transfer: some providers process data outside Brazil, with the safeguards for international data transfer provided for in the LGPD (Arts. 33 to 36).',

    s6Titulo: '6. Responsibilities of the processing agents — Art. 9, VI; Arts. 37–39',
    s6Itens: [
      'Fernando Lisboa acts as controller and is responsible for the decisions about the processing.',
      'The providers in item 5 act as processors, processing data according to our instructions and under contract.',
      'We keep a record of processing operations (Art. 37) and adopt security measures (Art. 46). In the event of a security incident with relevant risk, we notify the ANPD and the data subjects (Art. 48).',
    ],

    s7Titulo: '7. Your rights (data subject rights) — Art. 9, VII; Art. 18',
    s7Intro:
      'You, the data subject, have the rights granted by Art. 18 of the LGPD, upon request, among them:',
    s7Direitos: [
      'Confirmation that processing exists;',
      'Access to the data;',
      'Correction of incomplete, inaccurate or outdated data;',
      'Anonymization, blocking or deletion of unnecessary or excessive data, or data processed in noncompliance;',
      'Portability to another provider, upon request;',
      'Deletion of data processed with consent (except for the cases in Art. 16);',
      'Information about the entities with which we share data;',
      'Information about the possibility of not giving consent and the consequences;',
      'Withdrawal of consent;',
      'When processing is based on legitimate interest, the right to object and to request information (Art. 18, §2, and Art. 37).',
    ],
    s7ComoExercer:
      'How to exercise: use the Your Rights page (/seus-direitos) or write to privacidade@refogando.com. We respond within 15 days (Art. 19, II). You may also petition the National Data Protection Authority (ANPD).',

    s8Titulo: '8. Changes to this policy',
    s8Corpo:
      'We may update this policy. When there is a relevant change, we will notify you via the Your Rights page (/seus-direitos) and the e-mail privacidade@refogando.com, and record the version and date of each change.',

    parteBTitulo: 'Part (b) — "Web Discovery"',
    resumoBTitulo: 'Summary of this section',
    resumoBItens: [
      'When you import a recipe from an external site, we keep two things about the origin: the author/site name and the link (URL) — solely to credit the source.',
      'We do not copy the photo or the author text (an imported recipe is born without an image and without a description).',
      'An imported recipe is always private — you cannot publish or republish it.',
      'The personal data here is the name of the third-party recipe author — and you, the author, can request the removal of your name (the credit then shows only the site).',
    ],

    b1Titulo: 'b.1. What Web Discovery is',
    b1Corpo: [
      'Refogando can show, in search, some links to recipes from external sites (marked "from the web"), drawn from a closed list of domains we approve one by one (allowlist; search provider: Brave). If you click and confirm, the app imports that recipe into your private collection.',
    ],
    b1Itens: [
      'Search never creates or republishes third-party content. Linking ≠ importing; importing ≠ republishing.',
      'The allowlist is the single source of domains (managed by admin; with limits on domains queried and results per search).',
      'Technical guard-rails already implemented: respect for robots.txt (RFC 9309), an identified User-Agent (RefogandoBot/1.0), a courtesy rate-limit and search/import only on an explicit user action — never automatic background crawling.',
    ],

    b2Titulo: 'b.2. Who is the data subject here',
    b2Corpo:
      'The personal data processed in this feature is the name of the third-party recipe author/publisher — that is, the data subject is the author of the external recipe, not the app user. This distinction matters for exercising rights (item b.5).',

    b3Titulo: 'b.3. What data we collect, for what, on what basis and for how long',
    b3Rotulos: ['Data', 'What we do NOT collect', 'Purpose', 'Legal basis', 'Retention'],
    b3Valores: [
      'Only two attribution fields, stored solely on imported recipes: the human-readable author/site name and the public source URL. Every recipe that is not imported leaves these two fields empty.',
      'We do not copy the photo (an imported recipe is born without an image) or the author text / headnote. This keeps the third-party data surface to a minimum and avoids copying the expressive layer protected by copyright.',
      'Give credit to the source ("source: … (link)") — honoring the moral right of attribution (Law 9,610/98) — and send traffic back to the source site. Attribution is mandatory, not optional.',
      'Legitimate interest — LGPD Art. 7, IX. Alternative/complementary ground: data made manifestly public by the data subject (Art. 7, §4).',
      'While the imported recipe exists in the user’s private collection, or until the author requests removal of the name (item b.5), or until the user deletes the recipe. When the name is removed, the credit shows only the site (host) derived from the URL.',
    ],

    b4Titulo: 'b.4. Sharing in this feature',
    b4Corpo:
      'To find the external links, we query the Brave search provider (processor), sending the search term restricted to the allowlist domains. The import itself is a copy made at the user’s request, stored privately in their account — it is not republished or shared with third parties.',

    b5Titulo: 'b.5. Data subject rights (external recipe author) and how to exercise them — Art. 18',
    b5Intro:
      'If you are the author of a recipe that was imported into Refogando and want to remove your name from the attribution, you have that right (Art. 18, IV; and the right to object to processing based on legitimate interest, Art. 18, §2).',
    b5ComoFunciona: [
      'Removal clears only the author name; the source URL remains, because attribution is mandatory. After removal, the credit is downgraded to the site name (host) derived from the URL, and the "view on site" link remains.',
      'Removal only takes effect when there is in fact a human name distinct from the host; otherwise it is a no-op.',
      'Removal is not reversible to the original name — which is appropriate for the right to removal.',
    ],
    b5Contato:
      'Officer contact for this purpose: Fernando Lisboa — privacidade@refogando.com — response within 15 days. You can also use the public form on the Your Rights page (/seus-direitos).',

    todoRotulo: 'field to be filled in',
    rodapeVersaoRotulo: 'Version',
    rodapeVersao: 'v1',
    rodapeDataRotulo: 'Date',
    rodapeData: '2026-07-03',
    rodapeStatusRotulo: 'Status',
    rodapeStatus: 'Published — legal review in progress',
  },

  // "Your rights" page + public intake form (#399, GAP-2; part of #276). PUBLISHED: indexable, linked in
  // the footer and sitemap; the channel (e-mail + form) already exists and is functional.
  seusDireitos: {
    metaTitulo: 'Your rights / Privacy — Refogando',
    titulo: 'Your rights',
    intro:
      'You have rights over your personal data (LGPD, Art. 18): confirmation, access, correction, deletion, objection and others. This page explains how to exercise them, and you can open a request via the form below. We respond within 15 days (Art. 19, II).',

    titularATitulo: 'You have a Refogando account',
    titularACorpo:
      'If you are an app user, many of your rights are handled directly in your account (profile, recipes, collections). For anything not yet self-service, use the form below or the privacy email — always within the 15-day deadline.',
    titularBTitulo: 'You are the author of a recipe imported from the web',
    titularBCorpo:
      'If a recipe of yours was imported from an external site into Refogando, we keep only your name (credit) and the source link — never the photo or the authorial text. You may request removal of your name (the credit then shows only the site) or full removal. You do NOT need an account: use the form below.',

    fluxoTitulo: 'How a request works',
    fluxoPassos: [
      'You send the request via the form (or the privacy email), identifying the content (source link and/or displayed name) and what you want.',
      'We open a case and record the date of receipt — that is when the 15-day deadline starts to run (Art. 19, II).',
      'We confirm your identity as simply as possible (usually correspondence with the contact already tied to the source). We do not require documents as a condition (Art. 6º, III).',
      'We carry out the request and reply within the deadline, stating what was done — or, in case of a justified refusal, the reason.',
    ],
    prazoNota: 'Response time: up to 15 calendar days from receipt (LGPD, Art. 19, II).',
    naoExigimosDocumentos:
      'We collect only the minimum needed to locate the content and handle the request. We do not require documents or additional personal data as a condition (Art. 6º, III — necessity).',

    canalTitulo: 'Contact channel',
    canalCorpo:
      'Data protection officer (DPO): Fernando Lisboa. Email for privacy and exercising your rights: privacidade@refogando.com.',

    formTitulo: 'Open a request',
    formIntro:
      'Fill in your request below. Provide the source link and/or the displayed name so we can locate the content, and describe what you want.',
    formTipoRotulo: 'Request type',
    formTipoNameRemoval: 'Remove my name from the credit (keeping the link)',
    formTipoFullRemoval: 'Fully remove the imported recipe',
    formTipoOther: 'Another request about my data',
    formUrlRotulo: 'Source link (URL)',
    formUrlPlaceholder: 'https://source-site.com/recipe',
    formNomeRotulo: 'Name shown in the credit',
    formNomePlaceholder: 'e.g., Grandma’s Kitchen',
    formIdentificacaoDica: 'Provide at least one: the source link OR the displayed name.',
    formPedidoRotulo: 'Your request',
    formPedidoPlaceholder: 'Describe what you want (e.g., remove my name from the credit of this recipe).',
    formContatoRotulo: 'Email for our reply (optional)',
    formContatoPlaceholder: 'you@email.com',
    formContatoDica: 'Optional. If provided, we use it only to reply to this request.',
    formEnviar: 'Send request',
    formEnviando: 'Sending…',
    formSucessoTitulo: 'Request received',
    formSucessoCorpo:
      'We have received your request and recorded the date of receipt. We will reply within 15 days. Please keep the case number below.',
    formProtocoloRotulo: 'Case number',
    erroPedido: 'Please describe your request to continue.',
    erroIdentificacao: 'Provide at least one: the source link or the displayed name.',
    erroEnvio: 'We could not send your request right now. Please try again shortly.',

    todoRotulo: 'field to be filled in',
    rodapeVersaoRotulo: 'Version',
    rodapeVersao: 'v1',
    rodapeDataRotulo: 'Date',
    rodapeData: '2026-07-03',
    rodapeStatusRotulo: 'Status',
    rodapeStatus: 'Published — legal review in progress',
  },
} as const
