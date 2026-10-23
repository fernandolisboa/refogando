/**
 * Catálogo de chrome em en-US (issue #4). Tipado como `Messages` (= typeof ptBR):
 * o compilador exige as MESMAS chaves do pt-BR; o teste de paridade T3 confirma em runtime.
 */
import type { Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { NivelChef } from '@/domain/briefing'
import type { ImageSceneRegistro } from '@/domain/image-scene'
import type { ModerationCategory } from '@/domain/moderation-category'
import type { Messages } from './pt-BR'
// Relative import (a value, not a type): the E2E imports the catalogs outside the Next bundler.
import {
  DATA_POLITICA_V3_2,
  DATA_POLITICA_V3_3,
  DATA_POLITICA_V3_4,
  DATA_POLITICA_V3_5,
  DATA_POLITICA_V3_6,
  DATA_PUBLICACAO_TERMOS_V1,
  DATA_TERMOS_V1_1,
  DATA_TERMOS_V1_2,
  DATA_TERMOS_V1_3,
  DATA_TERMOS_V1_4,
} from '../../domain/legal-notice'

export const enUS: Messages = {
  app: { name: 'Refogando', tagline: 'Cook up any idea' },
  // #451: aria-label suffix for the footer social links (only the suffix is translated; the network
  // brand name is not).
  footer: { abreEmNovaAba: 'opens in a new tab' },
  nav: {
    // #277/ADR-0043: label of the "Explore" SECTION (the home itself is the "Discover" tab). Key stays
    // `home` (the section links to `/`, and not-found reuses this "back home" value); only the LABEL changed.
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
    // #461 (a11y): skip-link (first tab stop, hidden until focused) that bypasses the repeated header.
    pularParaConteudo: 'Skip to content',
    cardapio: 'Meal plan',
    despensa: 'Pantry',
    secoesAria: 'Sections',
    minhasReceitas: 'My recipes',
    planejar: 'Planner',
    descobrir: 'Discover',
    cozinheiros: 'Cooks',
    criacoes: 'Creations',
    comoUsar: 'How to use',
  },
  // Notifications inbox (#371, ADR-0028): bell in the chrome (logged-in only) + panel. Same FLAT-key
  // shape as pt-BR (the `Messages` type derives only 2 levels — no sub-objects); `renderNotification`
  // picks the key by type and interpolates `{name}` via `String.replace`.
  notifications: {
    ariaLabel: 'Notifications',
    // #461 (a11y): when there are unread items, the bell label announces the count (the badge is
    // visual-only, `aria-hidden`). `{n}` interpolated at render; singular/plural like other counters.
    ariaLabelUmaNaoLida: 'Notifications (1 unread)',
    ariaLabelNaoLidas: 'Notifications ({n} unread)',
    tituloPainel: 'Notifications',
    vazio: 'No notifications yet',
    novoSeguidor: '{name} started following you',
    novoSeguidorAnon: 'Someone started following you',
    // N2 curation/moderation events (#373): impersonal, no actor, no free-text reason embedded (the reason
    // category is appended via `comMotivo`, #609).
    sugestaoCozinhaResolvida: 'Your cuisine suggestion was reviewed',
    receitaModerada: 'One of your recipes was removed from discovery by a moderator',
    imagemModerada: 'One of your images was moderated',
    contaRestringida: 'Your account was restricted (image generation is blocked)',
    // N3 review events (#374): {name} = reviewer name (actor variant only); {stars} = rendered rating.
    avaliacaoNaReceita: '{name} rated your recipe ({stars})',
    avaliacaoNaReceitaAnon: 'Your recipe received a rating ({stars})',
    avaliacaoModerada: 'Your review ({stars}) was removed by a moderator',
    // #609: the closed-list reason category after the takedown text ({texto} = the type's sentence; {motivo} = the
    // label from `categoriaModeracaoDono`). Never the curator's free text nor who decided.
    comMotivo: '{texto}. Reason: {motivo}.',
    // #609: sibling link of a takedown item (Terms, item 8) — opens an email to the privacy channel. "Reconsider", as
    // in the Terms: "review" is the rating a cook writes in this app.
    pedirNovaAnalise: 'Ask us to reconsider',
    pedirNovaAnaliseAria: 'Ask us to reconsider by email: {texto}',
    novaAnaliseAssunto: 'Request for reconsideration of a takedown',
    novaAnaliseAssuntoReceita: 'Request for reconsideration: recipe {id}',
    novaAnaliseAssuntoAvaliacao: 'Request for reconsideration: review on recipe {id}',
    novaAnaliseAssuntoImagem: 'Request for reconsideration: image of recipe {id}',
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
  // Skill level (#421, ADR-0029 dec.2): shared label between the generation wizard and the Profile.
  // WHO the recipe is written for — distinct from the dish's Difficulty (now AI-estimated on output).
  nivelChefLabel: {
    iniciante: 'Beginner',
    intermediario: 'Intermediate',
    avancado: 'Advanced',
  } satisfies Record<NivelChef, string>,
  // #609: takedown reason category (closed list), in two forms: for the OWNER, after "Reason:" in the notification
  // (lower case, no Terms items); for the CURATOR, in the moderation and image review queues, with the Terms items.
  categoriaModeracaoDono: {
    direitos_autorais: 'copyright',
    pessoa_real: 'image or personal data of a real person',
    conteudo_ofensivo: 'offensive, discriminatory, harassing or hateful content',
    spam: 'spam, advertising or scam',
    conteudo_ilegal: 'illegal content',
    outro: 'another rule of the Terms of Use',
  } satisfies Record<ModerationCategory, string>,
  categoriaModeracaoLabel: {
    direitos_autorais: 'Copyright (Terms, items 4, 5 and 7)',
    pessoa_real: 'Image or personal data of a real person (items 4 and 7)',
    conteudo_ofensivo: 'Offensive, discriminatory, harassing or hateful (items 4 and 7)',
    spam: 'Spam, advertising or scam (item 7)',
    conteudo_ilegal: 'Illegal content (items 7 and 8)',
    outro: 'Another rule of the Terms',
  } satisfies Record<ModerationCategory, string>,
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
    // "AI-generated text" seal (#597) on the detail of a Recipe whose text came from AI (`textAiGenerated`).
    textoSeloIa: '✨ AI-generated text',
    // #5 (ADR-0019 amendment): "Generate with AI" DEMOTED from a permanent CTA to the EMPTY STATE (an
    // exit card). It does NOT auto-fire (Search never creates): it links to /create?q=<term> pre-filling
    // the free-text. Guests see the sign-in invite (reuses `minhasCriacoes.convidaEntrar*`). The
    // always-available create entry is the global header "Criar". `vazioGerar*` = the empty-state card.
    gerarComIa: 'Generate with AI',
    vazioGerarTitulo: 'Generate a recipe with AI',
    vazioGerarTexto: 'We create a recipe from your search.',
    digiteMaisLetras: 'Type a few more letters to generate a recipe with AI.',
    gerarAtalhoLead: 'Not quite right?',
    gerarAtalho: 'Generate “{termo}” with AI',
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
    // Visitor: web discovery needs an account (the route returns empty for anonymous), so the "Search
    // the web" triggers become a sign-in prompt — `webEntrarBotao` on the empty card and `webEntrarCta`
    // at the end of the results. Both return to the search after login.
    webEntrarBotao: 'Sign in to search',
    webEntrarCta: "Didn't find it? Sign in to search the web",
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
  // #457: "Recipe of the week" editorial slot — above the resting feed on the home. Chosen by the
  // Curator or, absent a choice, the most popular of the approved catalog (mechanical fallback).
  // The item itself reuses `RecipeResultItem` (same card as the feed) + `busca.selo*`/`porAutor`/etc.
  receitaDaSemana: {
    titulo: 'Recipe of the week',
    subtitulo: 'A catalog highlight, chosen by the curators.',
  },
  // Home banner for signed-out visitors (#472): one line per load, picked by the home on the server.
  faixaHome: {
    titulos: ['What are you in the mood for?', 'Got half a chicken and some leftover rice?', 'From craving to plate.'],
    textos: [
      "Tell us what's in your kitchen and out comes a recipe.",
      'Refogando turns it into dinner.',
      'Tell us what you want to eat and Refogando puts the recipe together.',
    ],
    botoes: ['Get started', 'Create account', 'Try it'],
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
    passosReordenados: 'Steps reordered',
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
  // ADR-0044: label for each image scene register (modal picker).
  cenarioLabel: {
    caseiro: 'Home table',
    rustico_tradicional: 'Rustic and traditional',
    bistro: 'Bistro',
    alta_gastronomia: 'Fine dining',
    comida_de_rua: 'Street food',
    boteco: 'Bar snacks',
    cafe_padaria: 'Café and bakery',
    festa: 'Party',
    ao_ar_livre: 'Outdoors',
    estudio: 'Studio',
  } satisfies Record<ImageSceneRegistro, string>,
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
    receitasSemelhantes: 'Similar recipes',
    compartilhar: 'Share',
    linkCopiado: 'Link copied!',
    compartilharErro: 'Could not copy the link. Please try again.',
    modoCozinha: 'Cook mode',
    modoCozinhaFechar: 'Exit cook mode',
    modoCozinhaPassoDe: 'Step {atual} of {total}',
    modoCozinhaAnterior: 'Previous step',
    modoCozinhaProximo: 'Next step',
    modoCozinhaConcluir: 'Mark step as done',
    modoCozinhaIniciarTimer: 'Start {tempo} timer',
    modoCozinhaPararTimer: 'Stop timer',
    modoCozinhaTempoEsgotado: "Time's up!",
    porcoes: 'Servings',
    porcoesDiminuir: 'Decrease servings',
    porcoesAumentar: 'Increase servings',
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
    // ADR-0044: scene picker in the modal. "Automatic" = the art director picks from the recipe.
    imagemCenarioRotulo: 'Scene',
    imagemCenarioAutomatico: 'Automatic (from the recipe)',
    // {cenario}, {acao} and {selo} interpolated in the component via `.replace`. Accessible name of the
    // split button's arrow (announces the current scene) and the button label with a chosen scene.
    imagemCenarioEscolher: 'Choose the scene, now: {cenario}',
    imagemGerarNoCenario: '{acao} · {cenario}',
    // Preview badge with the scene the server used.
    imagemSeloComCenario: '{selo} · Scene: {cenario}',
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
    vantagens: [
      "Turn an idea, or whatever's left in the fridge, into a recipe.",
      'Keep the recipes you love and make your own version of them.',
      'Plan the week and head out with the shopping list ready.',
    ],
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
    // Forgot password (#469). The confirmation is NEUTRAL on purpose: it never says whether the email has an account.
    esqueciSenha: 'Forgot your password?',
    redefinirTitulo: 'Reset password',
    redefinirDescricao: "Enter your account's email and we'll send you a link to create a new password.",
    enviarLink: 'Send link',
    linkEnviado:
      'If an account exists for this email, we sent a link to reset the password. Check your inbox and spam folder.',
    voltarEntrar: 'Back to sign in',
    novaSenhaTitulo: 'Create a new password',
    novaSenha: 'New password',
    salvarSenha: 'Save new password',
    senhaRedefinida: 'Password changed. Sign in with your new password.',
    erroLinkInvalido: 'This link has expired or was already used. Request a new one.',
    pedirNovoLink: 'Request a new link',
    erroMuitasTentativas: 'Too many attempts. Wait a minute and try again.',
    // Password reset transactional email (#469). `{nome}` interpolated on the server.
    emailResetAssunto: 'Reset your Refogando password',
    emailResetSaudacao: 'Hi {nome},',
    emailResetCorpo:
      'We received a request to reset the password for your Refogando account. Use the link below to create a new password. It is valid for 1 hour and can only be used once.',
    emailResetBotao: 'Create a new password',
    emailResetIgnorar: "If this wasn't you, ignore this email. Your current password still works.",
    // Account closure email for a serious violation of the Terms (#606, Terms item 8). Sent after the team erases
    // the account in the Console. `{nome}` interpolated on the server; the button leads to the Terms.
    emailEncerradaAssunto: 'Your Refogando account was closed',
    emailEncerradaSaudacao: 'Hi {nome},',
    emailEncerradaCorpo:
      'We closed your Refogando account for a serious violation of the Terms of Use (item 8). The account was erased: your identification data was anonymized and your private content was deleted. The public recipes and reviews that remain in the app show without your name.',
    emailEncerradaBotao: 'Read the Terms of Use',
    emailEncerradaRevisao:
      'If you think this was a mistake, you can ask for an explanation or contest the decision by writing to privacidade@refogando.com.',
    // Email confirmation (#470). Sign-up does NOT sign in: the screen asks to open the link. The copy is the
    // same whether or not the email has an account (no enumeration) — hence the "already have an account" note.
    confirmeEmailTitulo: 'Check your email',
    confirmeEmailCorpo:
      'We sent a confirmation link to {email}. Open the link to activate your account and sign in. Check your spam folder too.',
    confirmeEmailJaTemConta:
      'If this email already has an account, you can sign in or reset your password — and check your inbox.',
    reenviarEmail: 'Resend email',
    // Neutral on purpose: the server answers the same whether or not an account exists (and the public resend
    // sends the "finish signing up" link, not the confirmation one — see #470 B1 in auth.ts).
    confirmacaoReenviada:
      "If there's an unconfirmed account with this email, we sent a link to finish signing up. Check your inbox and spam folder.",
    // Resend with an open session (the lib refuses with 400): account already confirmed, or another account's email.
    emailJaConfirmado: 'This email is already confirmed.',
    erroOutraConta: "You're signed in with another account. Sign out of it to resend the link.",
    // Refused sign-in (#470 F1): the 401 is the SAME for a wrong password and an unconfirmed account.
    dicaConfirmarEmail: 'Just created your account? Confirm your email with the link we sent before signing in.',
    emailConfirmado: 'Email confirmed. Sign in to continue.',
    verificarErroTitulo: 'Invalid confirmation link',
    verificarErroDescricao: 'This link has expired or was already used. Enter your email to get a new one.',
    // Email confirmation transactional email (#470). `{nome}` interpolated on the server.
    emailVerificarAssunto: 'Confirm your email for Refogando',
    emailVerificarSaudacao: 'Hi {nome},',
    emailVerificarCorpo:
      "You're almost ready to start cooking with Refogando. Use the link below to confirm your email and sign in to your account. It is valid for 24 hours.",
    emailVerificarBotao: 'Confirm email',
    emailVerificarIgnorar: "If you didn't create this account, ignore this email.",
    // "Finish signing up" (#470 B1): public resend for an unconfirmed account — a PASSWORD link (1h, single use).
    emailConcluirAssunto: 'Finish creating your Refogando account',
    emailConcluirSaudacao: 'Hi {nome},',
    emailConcluirCorpo:
      'We received a request to finish creating your Refogando account. To activate it, create your password with the link below — that is your password from now on. The link is valid for 1 hour and can only be used once.',
    emailConcluirBotao: 'Create password and activate account',
    emailConcluirIgnorar: "If this wasn't you, ignore this email. No account is activated without this link.",
    // Age and Terms notice on sign-up (ADR-0051; #595 created the line), on the form and on Google. `{termos}`
    // becomes the `termos.nome` link; `{privacidade}`, the `privacidade.titulo` link. No checkbox.
    privacidadeCadastro:
      'By creating an account, you confirm you are 16 or older and agree to the {termos}. The {privacidade} explains how we handle your data.',
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
    // #423 (ADR-0029 dec.6): "generate 2, the user chooses". Opt-in in structured mode (only when the
    // admin turns the feature on) + the screen to choose between the 2 versions.
    variar2Label: 'Generate 2 versions for me to choose from',
    variar2Ajuda: 'The AI creates two different versions; you pick your favorite.',
    variacaoTitulo: 'Choose a version',
    variacaoIntro:
      'We generated two versions. Choose the one you prefer — the other stays in your space.',
    variacaoColuna: 'Version {n}',
    variacaoEscolher: 'Choose this one',
    variacaoCorpoIndisponivel:
      "We couldn't load this version right now, but it's saved in your space.",
    erroLimiteVariacao:
      "You don't have room to generate 2 versions right now. Try a single version or come back later.",
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
    // Skill level (#421, ADR-0029 dec.2): WHO the recipe is written for (detail/tone of the text).
    // Replaces the old Difficulty-as-input; the dish's difficulty is now AI-estimated.
    nivelTitulo: 'Skill level',
    nivelIntro: 'Who the recipe is written for — how much detail and what tone. The dish difficulty is estimated by the AI.',
    // Chip that reverts to the Profile default (no override for this generation).
    nivelPadrao: 'Use my default',
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
    // ADR-0045: one-click faithful copy, next to "Create my version".
    clonar: 'Clone',
    clonarDica: 'Makes your own copy, same as the original, without editing first',
    clonarErro: 'Couldn’t clone this recipe. Try again.',
    // #588: anti-abuse cap on Derive/Clone (rolling 24h, shared by both). {tempo} interpolated in the component.
    derivarLimite: "You've hit the recipe copy limit for now. Frees up in ~{tempo}.",
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
    // Default skill level (#421, ADR-0029 dec.2): default for the generation axis, overridable per
    // generation. The empty option clears the default (no preference = neutral axis).
    nivelPadrao: 'Default skill level',
    nivelPadraoDica: 'Used as the default when generating recipes — you can change it per generation.',
    nivelPadraoNenhum: 'No preference',
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
  // Dietary restrictions SAVED on the profile (ADR-0041): the /me/profile section and the hints that the
  // default came from there, on the surfaces that apply it (creation, menu suggestion, search).
  restricoesPerfil: {
    titulo: 'Dietary restrictions',
    descricao:
      'Mark what you usually need to stick to. They come pre-selected when you create a recipe, ask for a menu suggestion or search — and you can change them each time.',
    privado: 'Only you can see this. It does not appear on your public profile.',
    aviso: 'Recipes declare the restrictions they meet; this is not verified. If you have an allergy, check the ingredients.',
    legenda: 'Your restrictions',
    consentimento:
      'By saving, you allow Refogando to keep these restrictions only to pre-select your requests and to send them to the AI (Anthropic) when you generate with them selected. The app runs in Brazil and the AI in the United States. Clear them all and save to delete.',
    // Notice of the 2026-10-23 change (LGPD art. 8, §6), only for people whose saved restrictions carry an older
    // version of the text (including from before 2026-10-22, when the text did not mention the United States yet).
    avisoMudanca:
      'We updated the Privacy Policy on October 23, 2026: the app now runs in Brazil, and the AI (Anthropic) remains in the United States; it only receives your saved restrictions when you generate with them selected. Save again to dismiss this notice; if you do not agree, clear them all and save to delete them.',
    avisoMudancaFechar: 'Got it',
    salvar: 'Save restrictions',
    salvando: 'Saving…',
    salvo: 'Restrictions saved.',
    erro: 'Could not save your restrictions. Please try again.',
    erroCarregar: 'Could not load your restrictions.',
    vemDoPerfil: 'Pre-selected from your profile.',
    editarNoPerfil: 'Edit in profile',
    considerarLegenda: 'Consider your restrictions',
    considerarDica: 'From your profile. Tap one to leave it out of this request.',
    buscaAviso: 'Showing only recipes that declare: {lista} (from your profile).',
    buscaMostrarTudo: 'Show all',
  },
  // #610 (ADR-0052): credit on a derived Recipe. The title and the @ are links, so the sentence comes in pieces.
  creditoCopias: {
    baseadaEm: 'Based on',
    de: 'by',
    doCatalogo: 'from the catalog',
    seuNome: 'This is a copy of one of your recipes, and your name shows on it.',
    retirar: 'Remove my name',
    retirado: 'You removed your name from this copy of your recipe.',
    mostrarDeNovo: 'Show my name again',
    salvando: 'Saving…',
    erro: "Couldn't save. Try again.",
    perfilTitulo: 'Credit on copies',
    perfilDescricao:
      'When someone publishes a copy of one of your recipes ("Create my version" or "Clone"), its page shows "Based on … by @you", linking to yours while yours stays published. To remove your name from a single copy, use "Remove my name" on its page.',
    perfilToggle: 'Show my name on copies of my recipes',
    perfilSalvo: 'Preference saved.',
    perfilErroCarregar: "Couldn't load this preference.",
  },
  denunciaReceita: {
    reportar: 'Report',
    motivo: 'Reason for the report',
    dica: 'Tell us what is wrong: illegal or offensive content, copying without permission, spam or another problem. Moderators review every report.',
    enviar: 'Send report',
    enviando: 'Sending…',
    cancelar: 'Cancel',
    enviada: 'Report sent. Moderators will review it.',
    erro: 'Could not send the report. Try again.',
    erroLimite: 'You have reached the report limit for now. Try again later.',
    erroIndisponivel: 'This recipe is no longer available. It may have been taken down already.',
    erroSessao: 'Your session has expired. Sign in again to report.',
  },
  // "Your data" on /me/profile (#595; LGPD Art. 18, II and V; deletion: arts. 15, III and 16 (18, VI for the
  // saved restrictions)): download the account export and delete the account from the UI. The delete dialog says
  // what is erased and what stays without the person's name (what `eraseOwnAccount` does); `excluida` is the
  // home notice after deletion, and `erroSessao` also shows in the notice after the reload.
  seusDados: {
    titulo: 'Your data',
    descricao: 'Download a copy of what Refogando keeps about you, or delete your account.',
    baixar: 'Download my data',
    baixando: 'Preparing the file…',
    baixarDica:
      'A JSON file with your profile, recipes, images, reviews, reports, saves, collections, shopping lists, meal plan, pantry, who you follow, notifications, sign-ins, sign-in methods, usage records and creation history.',
    // The browser only started saving: whoever is about to delete the account checks the file first.
    baixado: 'Download started. Make sure the file was saved before deleting your account.',
    erroBaixar: "We couldn't download your data. Try again.",
    erroBaixarSessao: 'Your session expired. Sign in again to download your data.',
    excluir: 'Delete my account',
    excluirDica: "Erases what is only yours and removes your name from what you published. This can't be undone.",
    saibaMais: 'Learn more:',
    dialogoTitulo: 'Delete your account?',
    dialogoDescricao:
      "Deletion is permanent: the account can't be recovered. You'll be signed out on every device and won't be able to sign in with it again.",
    apagadoTitulo: 'What gets deleted',
    apagadoItens: [
      'Your profile: name, @username, email, photo, bio, links, language, default skill level and dietary restrictions.',
      'Your private recipes.',
      'Your creation history: your requests and conversations with the AI.',
      'Your saves, collections, shopping lists, meal plan and pantry.',
      'Who you follow, who follows you and your notifications.',
      'Your password, Google sign-in and every open session.',
    ],
    mantidoTitulo: 'What stays, without your name',
    mantidoItens: [
      'Recipes you published and reviews you wrote stay on Refogando, but without your name: other people saved, reviewed or planned meals with them.',
      'Your review photos are deleted 180 days later.',
      'Reports you filed stay with moderation, without your name.',
      'AI usage records (date, model, tokens and cost, without the text of your requests) stay on the anonymized account and are deleted 24 months after they were created; ingredient extraction records, 30 days after.',
      'A record that you asked for deletion (date and counts, none of your data) is kept for 5 years as proof that we handled the request.',
    ],
    // `{link}` becomes the "My recipes" link (the header section label), where the person deletes a recipe of theirs.
    apagarPublicadas: 'Want a published recipe gone? Delete it in {link} before deleting your account.',
    baixarAntes: 'Want to keep a copy? Download your data before deleting.',
    entendo: "I understand that deletion is permanent and can't be undone.",
    cancelar: 'Cancel',
    // ≠ `excluir` (the trigger that opens the dialog): the final button is never confused with it.
    confirmar: 'Delete permanently',
    excluindo: 'Deleting…',
    fechar: 'Close',
    erroExcluir: "We couldn't delete your account. Try again.",
    erroSessao: 'Your session expired. Sign in again to delete your account.',
    reautenticar: 'For your security, sign in again to delete your account.',
    reautenticarLink: 'Sign in again',
    excluida: 'Your account was deleted.',
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
  listaDeCompras: {
    // ADR-0038 dec.6: copia os marcados para a Despensa (não apaga nada da Lista).
    guardarNaDespensa: 'Add checked items to pantry',
    guardadosNaDespensa: 'Added {n} items to your pantry.',
    guardadoNaDespensaSingular: 'Added 1 item to your pantry.',
    guardadosJaNaDespensa: 'The checked items were already in the pantry.',
    nadaMarcadoParaDespensa: 'No checked items to add to your pantry.',
    erroDespensaCheia: 'Your pantry is full. Remove some items from it first.',
    abrirDespensa: 'Open pantry',
    // Multi-seleção (fatia E, #530).
    selecionarReceita: 'Select {nome}',
    selecionadaSingular: '{n} recipe selected',
    selecionadasPlural: '{n} recipes selected',
    cancelarSelecao: 'Cancel selection',
    escolherLista: 'Choose list',
    novaLista: '+ New list',
    nomeNovaLista: 'New list name',
    confirmarAdicionar: 'Add to list',
    adicionando: 'Adding…',
    sucessoSingular: '{n} recipe added to the list.',
    sucessoPlural: '{n} recipes added to the list.',
    algumasNaoAdicionadas: 'Some recipes could not be added.',
    erroCarregarListas: 'Could not load your lists. Try again.',
    erroNomeInvalido: 'Choose a name for the list (up to 60 characters).',
    erroNomeDuplicado: 'You already have a list with that name.',
    erroLimiteListas: "You've reached the list limit.",
    erroAdicionar: 'Could not add the recipes. Try again.',
    // Check-off persistente (fatia D, #529).
    titulo: 'Shopping list',
    itemMarcarAria: 'Mark {nome} as bought',
    itemDesmarcarAria: 'Unmark {nome}',
    removerMarcados: 'Remove checked',
    limparLista: 'Clear list',
    confirmarRemoverMarcados: 'Remove the checked items? This cannot be undone.',
    confirmarLimparLista: 'Clear the whole list? All items will be deleted — this cannot be undone.',
    vazia: 'Your list is empty.',
    precisaEntrar: 'Sign in to see your shopping list.',
    // Adicionar UMA Receita do detalhe, com porções-alvo (fatia B, #527).
    adicionar: 'Add to shopping list',
    adicionarALista: 'Add to shopping list',
    adicionarBotao: 'Add',
    adicionado: 'Added',
    criarEAdicionar: 'Create and add',
    semListas: "You don't have any shopping lists yet.",
    avisoSemPorcoes: 'This recipe has no servings set — added at its original quantity.',
    convidaEntrarAdicionar: 'Sign in to add to your shopping list.',
    // Edição à mão (fatia C, #528, dec.5) — item avulso + editar quantidade + remover linha.
    nomeItem: 'Item',
    nomeItemPlaceholder: 'E.g.: napkins',
    quantidade: 'Quantity',
    quantidadePlaceholder: 'E.g.: 2',
    unidade: 'Unit',
    unidadeNenhuma: 'No unit',
    editarQuantidade: 'Edit quantity',
    salvar: 'Save',
    cancelar: 'Cancel',
    remover: 'Remove',
    confirmarRemover: 'Remove this item from the list?',
    erroItemNomeInvalido: 'Choose a name for the item (up to 200 characters).',
    erroQuantidadeInvalida: 'Invalid quantity — use a number greater than zero.',
    erroUnidadeInvalida: 'Invalid unit.',
    // Comum às fatias.
    erro: 'Something went wrong. Try again.',
    indiceTitulo: 'Shopping lists',
    itemContagem: '1 item',
    itensContagem: '{n} items',
    vazioIndice: 'You don’t have any shopping lists yet. Add ingredients from a recipe or build a list from your meal plan.',
    criarLista: 'Create list',
    apagarLista: 'Delete {nome}',
    confirmarApagarLista: 'Delete the list “{nome}”? Its items will be lost.',
    todasAsListas: 'All lists',
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
    titulo: 'Console',
    subtitulo: 'Refogando administration',
    acessoNegadoTitulo: 'Restricted area',
    acessoNegado: "You don't have permission to access this area.",
    voltarInicio: 'Back to home',
    // ADR-0034: model + effort + thinking PER text AI task (config-section.tsx).
    configTitulo: 'Text AI models',
    configDescricao:
      'Each task has its own model and settings, stored per model. Saving runs a test call to confirm Anthropic accepts the combination.',
    tarefaGeracaoTitulo: 'Recipe generation',
    tarefaGeracaoDescricao:
      'New recipes, variations, and the chef conversation.',
    tarefaTraducaoTitulo: 'Translation',
    tarefaTraducaoDescricao:
      'Recipe translation between pt-BR and en-US. A faithful task: thinking off by default where the model allows it.',
    tarefaExtracaoTitulo: 'Ingredient extraction',
    tarefaExtracaoDescricao:
      'Reads the ingredient list the user pasted. Thinking off by default where the model allows it.',
    tarefaCardapioTitulo: 'Menu suggestion',
    tarefaCardapioDescricao:
      "Fills the week in the meal planner by picking recipes from the user's collection and the community. Low effort by default.",
    tarefaCenarioTitulo: 'Image scene',
    tarefaCenarioDescricao:
      'The art director reads the recipe and picks the photo scene before each generated image. Low effort and thinking off by default where the model allows it.',
    modeloLabel: 'Model',
    modeloForaDaLista: 'in use, no longer listed',
    salvar: 'Save',
    salvando: 'Saving…',
    salvo: 'Configuration saved.',
    erroModelo: 'Invalid model.',
    esforcoLabel: 'Effort',
    esforcoLow: 'Low',
    esforcoMedium: 'Medium',
    esforcoHigh: 'High',
    esforcoXhigh: 'Very high',
    esforcoMax: 'Max',
    thinkingLabel: 'Thinking',
    padraoDoModelo: 'Model default',
    thinkingAdaptativo: 'On (adaptive)',
    thinkingDesligado: 'Off',
    thinkingMinimo: 'Minimal (between_tools)',
    iaAutoAtualizarLabel: 'Move to the new version of the family on its own (after a test call)',
    iaTarefaErroConfig: 'Invalid setting.',
    erroAjusteNaoSuportado: "This model doesn't offer that setting.",
    erroAjusteRecusado: 'Anthropic rejected this setting for this model.',
    // ── Users list ("Users" tab, admin-only): presets, table and details drawer. ──
    usuariosAtalhosAria: 'Filter presets',
    usuariosPresetTodos: 'All',
    usuariosPresetNovos: 'New (7 days)',
    usuariosPresetSemPapel: 'No role',
    usuariosPresetEquipe: 'Staff',
    usuariosPresetPendentes: 'Pending signup',
    usuariosPresetPro: 'Pro',
    usuariosPresetDesativadas: 'Deactivated',
    usuariosBuscaLabel: 'Search users',
    usuariosBuscaPlaceholder: 'Name, @handle, email or ID',
    usuariosOrdenarLabel: 'Sort',
    usuariosOrdemRecentes: 'Newest',
    usuariosOrdemAntigos: 'Oldest',
    usuariosOrdemAcesso: 'Last seen',
    usuariosOrdemNome: 'Name',
    usuariosTotalUm: '1 account',
    usuariosTotal: '{n} accounts',
    usuariosTabelaAria: 'User list',
    usuariosColUsuario: 'User',
    usuariosColEmail: 'Email',
    usuariosColPapelPlano: 'Role / plan',
    usuariosColReceitas: 'Recipes',
    usuariosColCadastro: 'Signed up',
    usuariosColAcesso: 'Last seen',
    usuariosStatusAtiva: 'Email confirmed',
    usuariosStatusNaoConfirmada: 'Email not confirmed',
    usuariosStatusPendente: 'Pending signup',
    usuariosStatusPendenteExpira: 'Pending signup · expires in {h} h',
    usuariosStatusDesativada: 'Account deactivated',
    usuariosStatusEliminada: 'Account erased',
    usuariosSemSessao: 'No session',
    usuariosCarregando: 'Loading…',
    usuariosVazio: 'No accounts match this filter.',
    usuariosErroCarregar: "Couldn't load the list.",
    usuariosTentarDeNovo: 'Try again',
    usuariosPaginacao: 'Showing {de}–{ate} of {total}',
    usuariosAnterior: 'Previous',
    usuariosProxima: 'Next',
    usuariosAbrirDetalhes: 'View details for {nome}',
    usuariosVoce: 'you',
    usuariosDetalheSituacao: 'Status',
    usuariosDetalheEmail: 'Email',
    usuariosDetalheCadastro: 'Signed up',
    usuariosDetalheAcesso: 'Last seen',
    usuariosDetalheReceitas: 'Recipes',
    usuariosDetalheReceitasValor: '{n} ({p} public)',
    usuariosDetalhePlano: 'Plan',
    usuariosDetalheIdioma: 'Language',
    usuariosDetalheImagem: 'Image generation',
    usuariosImagemLiberada: 'Allowed',
    usuariosImagemBloqueada: 'Blocked by moderation',
    usuariosDetalheId: 'ID',
    usuariosCopiarId: 'Copy ID',
    usuariosIdCopiado: 'ID copied',
    usuariosVerPerfil: 'View public profile',
    usuariosDetalheDesativadaEm: 'Deactivated on',
    usuariosPapelLegenda: 'Role',
    usuariosPapelAtual: 'current',
    usuariosPapelDescUsuario: 'Creates, saves and publishes their own recipes.',
    usuariosPapelDescCurador: 'Also moderates and looks after translations and the Catalog.',
    usuariosPapelDescAdmin: 'Full Console access, including AI, plan and roles.',
    usuariosPapelProprio: "You can't change your own role. Ask another admin.",
    usuariosPapelContaInativa: "Account deactivated: the role can't change.",
    // ── Erase account by the team (#606, ADR-0051 P1/P3): drawer section and confirmation dialog. ──
    usuariosEliminarTitulo: 'Erase account',
    usuariosEliminarDescricao:
      'For the account of someone under 16 or closed for a serious violation of the Terms. People who want to leave erase their own account in Your data.',
    usuariosEliminarBotao: 'Erase account',
    usuariosEliminarTravaPropria: "You can't erase your own account here. Use Edit profile → Your data.",
    usuariosEliminarTravaAdmin: 'Administrator account: change the role before erasing.',
    usuariosEliminarDialogoTitulo: "Erase {nome}'s account",
    usuariosEliminarDialogoDescricao:
      "The identification data is anonymized and the private content is deleted now. This can't be undone.",
    usuariosEliminarMotivoLegenda: 'Reason',
    usuariosEliminarMotivoMenor: 'Under 16',
    usuariosEliminarMotivoMenorAjuda:
      "Before: we wrote to the account's email asking for the age, and it wasn't confirmed within 7 days (Terms, item 2).",
    usuariosEliminarMotivoViolacao: 'Serious or repeated violation of the Terms',
    usuariosEliminarMotivoViolacaoAjuda:
      'Before: we told the person by email, with the reason, and, except for illegal content, waited 15 days for them to download their data (Terms, item 8).',
    usuariosEliminarRemoverPublico: "The person's public recipes and reviews are removed too.",
    usuariosEliminarRemoverPublicoAjuda:
      'The license given by someone under 16 is void (Brazilian Civil Code, arts. 3 and 166, I), and the Terms promise to erase what the account published.',
    usuariosEliminarAvisar: 'Tell the person by email that the account was closed',
    usuariosEliminarAvisarAjuda: 'Uncheck only if there is a legal impediment.',
    usuariosEliminarConfirmarLabel: "To confirm, type the account's @: {handle}",
    usuariosEliminarCancelar: 'Cancel',
    usuariosEliminarConfirmar: 'Erase permanently',
    usuariosEliminarEliminando: 'Erasing…',
    usuariosEliminarFeito: 'Account erased.',
    usuariosEliminarEmailNaoEnviado: "The notice email didn't go out. Tell the person from privacidade@refogando.com.",
    usuariosEliminarReautenticar: 'For security, sign in again before erasing an account.',
    usuariosEliminarReautenticarLink: 'Sign in again',
    usuariosEliminarErroInativa: 'This account is already deactivated or erased.',
    usuariosEliminarErroConfirmacao: "The @ you typed doesn't match the account's.",
    usuariosEliminarErroNaoEncontrada: 'Account not found.',
    usuariosEliminarErro: "Couldn't erase the account. Try again.",
    papelUsuario: 'User',
    papelCurador: 'Curator',
    papelAdmin: 'Administrator',
    aplicarPapel: 'Apply role',
    aplicandoPapel: 'Applying…',
    promovido: 'Role updated.',
    grupoPlataforma: 'Platform',
    grupoCuradoria: 'Curation',
    grupoPessoas: 'People',
    navAria: 'Console sections',
    navIa: 'AI',
    navUsuarios: 'Users',
    abrirSecoes: 'Open Console sections',
    fechar: 'Close',
    descUsuarios: 'Every Refogando account. Filter with the presets, search by name, @handle, email or ID, and change the role in the details drawer.',
    descPlano: 'Pro plan ceilings and granting the plan to an account by hand.',
    descIa: 'Models and settings for each AI task, image generation and cost.',
    descDescoberta: 'Web search, embeddings, batch re-translation, attribution and takedown requests.',
    descComparador: 'Compare the output of two prompts or models side by side.',
    descVocabulario: 'Cuisines, per-cuisine visual notes and the house vocabulary.',
    descSite: 'Social links and other public site settings.',
    descModeracao: 'Reports, reviews and suggested cuisines awaiting a decision.',
    descTraducoes: 'Translations that are stale or diverge from the original.',
    descCatalogo: 'Catalog drafts, curation, Recipe of the week and the AI notice.',
    // ── Billing phase 2 (#466): "Plan" tab (Governance, admin-only). CONTIGUOUS block. ──
    navPlano: 'Plan',
    // Part 1: edit the `pro` ceilings table (proCaps) across the three dimensions, per role.
    planoProCapsTitulo: 'Pro plan ceilings',
    planoProCapsDescricao:
      'Higher daily ceilings for Pro users, by dimension and role. With the Pro table off (empty), everyone — Pro included — gets today’s free-plan ceiling.',
    // Concierge notice: makes it EXPLICIT that none of this charges anyone.
    planoConciergeAviso:
      'This charges nothing. Automatic billing isn’t live yet — granting Pro is a manual unlock for early users.',
    planoProAtivarLabel: 'Turn on the Pro ceilings table',
    planoProAtivarAjuda:
      'Off = no Pro table: everyone gets today’s free-plan ceiling (nothing changes). On = Pro users switch to the ceilings below.',
    planoProReceitaLabel: 'Pro recipe-generation ceilings per role (24h window)',
    planoProImagemLabel: 'Pro image-generation ceilings per role (24h window)',
    planoProExtracaoLabel: 'Pro ingredient-extraction ceilings per role (24h window)',
    planoErroConfig: 'Invalid configuration. Check the ceilings (whole number ≥ 0, or empty for unlimited).',
    // Part 2: grant/revoke a user’s plan (manual concierge).
    planoConcederTitulo: 'Grant a plan to a user',
    planoConcederDescricao:
      'Enter the @handle or email and pick the plan. Granting Pro is a manual unlock (concierge): it charges nothing — automatic billing isn’t live yet.',
    planoIdentificadorLabel: 'User (@handle or email)',
    planoIdentificadorPlaceholder: '@handle or email',
    planoBotaoPro: 'Grant Pro',
    planoBotaoFree: 'Revert to free',
    planoAplicando: 'Applying…',
    planoPlanoFree: 'free',
    planoPlanoPro: 'Pro',
    planoSucesso: '{user} is now on the {plano} plan.',
    planoErroNaoEncontrado: 'User not found. Check the @handle or email.',
    planoErroPlanoInvalido: 'Invalid plan.',
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
    // #422: curated voice note per cuisine (instructs the AI to cook authentically; no deploy).
    vocabNotaVoz: 'Voice note (optional)',
    vocabNotaVozPlaceholder:
      'How the AI should cook in this tradition: typical techniques, ingredients and seasonings. Leave blank to use only the generic instruction.',
    // ADR-0044: curated visual note per cuisine (goes into the dish IMAGE prompt; no deploy).
    vocabNotaVisual: 'Image visual note (optional)',
    vocabNotaVisualPlaceholder:
      'Typical tableware, plating and surface for this cuisine, used in the generated photo. E.g.: clay pot and wooden spoon, earthy tones.',
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
    vocabErroNotaLonga: 'The note is too long. Shorten it and try again.',
    // #268: the /admin/descoberta tab holds the SEARCH infra — web discovery + embeddings; generative AI
    // (recipe model + image generation + caps) moved to the "AI" tab (/admin/ia).
    navDescoberta: 'Discovery',
    // ── #425 (ADR-0029 dec.7): before/after prompt comparator (Governance, admin-only). ──
    navComparador: 'Comparator',
    comparadorTitulo: 'Prompt comparator (before/after)',
    comparadorDescricao:
      'Quality gate: runs fixed briefings through the old prompt (frozen) vs. the new one (live) and shows the recipe side by side. Nothing is saved.',
    comparadorRodar: 'Run comparison',
    comparadorRodando: 'Running…',
    comparadorGerarImagem: 'Generate image (slower)',
    comparadorVelho: 'Old',
    comparadorNovo: 'New',
    comparadorSystemPrompt: 'System prompt',
    comparadorIngredientes: 'Ingredients',
    comparadorPassos: 'Steps',
    comparadorSemReceita: 'No recipe delivered.',
    comparadorErro: 'Failed to run this comparison.',
    comparadorImagemAlt: 'Generated dish image',
    comparadorOutcomeSuccess: 'success',
    comparadorOutcomeDegraded: 'degraded',
    comparadorOutcomePlayful: 'playful',
    comparadorOutcomeImpossible: 'impossible',
    comparadorOutcomeInvalid: 'invalid',
    // ── #451: "Site" tab (Governance, admin-only) — social links in the footer, editable without deploy. ──
    navSite: 'Site',
    redesTitulo: 'Social links (footer)',
    redesDescricao:
      'Links shown in the site footer. Add the account and turn it on when it exists. Empty = footer with no links.',
    redesPlataformaLabel: 'Network',
    redesUrlLabel: 'URL (https://…)',
    redesRotuloLabel: 'Label (optional)',
    redesLigadoLabel: 'Show in footer',
    redesAdicionar: 'Add network',
    redesRemover: 'Remove',
    redesSalvar: 'Save',
    redesSalvando: 'Saving…',
    redesSalvo: 'Changes saved.',
    redesErro: 'Could not save. Check the URLs (http/https only) and avoid repeated platforms.',
    redesCarregando: 'Loading…',
    redesVazio: 'No networks added yet.',
    // "Image generation" section (#134) — lives on the "AI" tab (/admin/ia); toggle, model, caps.
    aiTitulo: 'AI image generation',
    aiDescricao: 'Control recipe image generation: on/off, model and daily caps per role.',
    aiHabilitadaLabel: 'Image generation on',
    aiCenarioDiretorLabel: 'Art director picks the scene',
    aiCenarioDiretorAjuda:
      'Before each image, a short AI call reads the recipe and picks the photo scene (home table, fine dining, street food…). When off, the scene comes from simple rules by category and cuisine. The model is set in the "Image scene" task.',
    aiModeloLabel: 'Model',
    aiModeloNanoBanana: 'Nano Banana 2 (Gemini)',
    aiTetosLabel: 'Image caps per role (24h window)',
    // #167: per-role recipe generation cap (separate axis from the image cap).
    aiTetoReceitaLabel: 'Recipe generation caps per role (24h window)',
    aiTetoIlimitado: 'unlimited',
    aiTetoAjuda: 'Leave blank for unlimited. 0 blocks the role.',
    aiErroConfig: 'Invalid configuration. Review the caps and model.',
    // #423 (ADR-0029 dec.6): generation variation ("generate 2, the user chooses") — on/off + the
    // divergence axis (poles + how to diverge), editable without a deploy.
    aiVariacaoLabel: 'Generation variation (generate 2, user chooses)',
    aiVariacaoAjuda:
      'A single call generates two divergent versions; the user chooses. Costs about 2× tokens — keep it opt-in.',
    aiVariacaoHabilitadaLabel: 'Offer "Generate 2 versions" when creating',
    aiVariacaoPoloA: 'Pole A',
    aiVariacaoPoloB: 'Pole B',
    aiVariacaoInstrucao: 'How to diverge',
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
    // #457: "Recipe of the week" — editorial home slot. The Curator searches by title (restricted
    // to the approved catalog) and picks one; with no pick, the home falls back to the automatic
    // Popularity highlight.
    receitaSemanaTitulo: 'Recipe of the week',
    receitaSemanaDescricao:
      "Pick a catalog recipe to feature on the home this week. With no pick, the home automatically shows the catalog's most popular recipe.",
    receitaSemanaAtualLabel: 'Current pick',
    receitaSemanaAtualVazio: 'None — the home is using the automatic popularity highlight.',
    receitaSemanaLimpar: 'Clear pick',
    receitaSemanaLimpando: 'Clearing…',
    receitaSemanaBuscaLabel: 'Search catalog recipe',
    receitaSemanaBuscaPlaceholder: 'Recipe title',
    receitaSemanaBuscaCarregando: 'Searching…',
    receitaSemanaBuscaVazio: 'No catalog recipe found with that title.',
    receitaSemanaBuscaContagem: '{n} result(s)',
    receitaSemanaBuscaResultados: 'Search results',
    receitaSemanaSelecionada: 'Selected',
    receitaSemanaTrocar: 'Change',
    receitaSemanaSalvo: 'Recipe of the week updated.',
    receitaSemanaErroReceita: 'That recipe is not (or is no longer) part of the approved catalog.',
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
    // Outdated translations re-translation (#499, ADR-0031) — resumable batch, same UX as the
    // embedding backfill.
    retranslateTitulo: 'Re-translate outdated',
    retranslateDescricao:
      'Re-translates derived translations whose original changed or whose translator improved — only the ones nobody hand-edited since the last automatic translation. Run until "remaining: 0".',
    retranslateBtn: 'Re-translate outdated',
    retranslateRodando: 'Re-translating…',
    retranslateResultado: 'Re-translated: {retraduzidas} · skipped: {puladas} · remaining: {restantes}.',
    retranslateErro: 'Could not re-translate. Try again.',
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
    // The criteria for when to use it are in the internal opinion of 2026-10-22 (§2, item 2); the mechanism does not decide alone.
    escalonarTitulo: 'Escalate beyond the name (unlink URL / delete import)',
    escalonarAviso:
      'When to escalate (internal opinion of 2026-10-22, §2): unlink the URL if it identifies the person or if the person objects to the processing as a whole; delete the import if the request comes from the site owner or the rights holder (the domain also goes into the denylist, in code). In all other cases, remove only the name. It reuses the name/URL entered above.',
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
    // SLA panel for OPEN takedown/DSAR tickets (#412/GAP-7). Read-only; the route filters resolved
    // ones (fulfilled/rejected). Ordered by urgency: highest alert level at the top.
    slaTitulo: 'Takedown request SLA (open)',
    slaDescricao:
      'Takedown/DSAR tickets whose 15-day deadline is STILL running (resolved ones drop off). The most urgent — highest alert level — show up first. Monitoring only; handling and escalation live in the sections above.',
    slaVazio: 'No open takedown requests.',
    slaTipoLabel: 'Request type',
    slaFonteLabel: 'Source',
    slaUrlLabel: 'Source URL',
    slaMensagemLabel: 'Request',
    slaRecebidoLabel: 'Received on',
    slaMarcarAtendido: 'Mark as fulfilled',
    slaRecusar: 'Reject',
    slaMotivoLabel: 'Reason for rejecting',
    slaConfirmarRecusa: 'Confirm rejection',
    slaCancelar: 'Cancel',
    slaEncerrarErro: "Couldn't close the request. Try again.",
    slaSemFonte: '(no name or URL)',
    slaIdadeDias: '{dias} day(s) ago',
    slaTipoNameRemoval: 'Name removal',
    slaTipoFullRemoval: 'Full removal',
    slaTipoOther: 'Other',
    slaNivelNone: 'On track',
    slaNivelYellow: 'Deadline approaching',
    slaNivelRed: 'Escalate to the controller',
    slaNivelOverdue: 'Overdue',
    // AI cost panel (#465) — aggregates the text (#463) and image (#224) ledgers.
    custoTitulo: 'AI cost',
    custoDescricao:
      'How much AI generation cost over the last {dias} days — text (recipes) and image. Only what was actually measured is summed; generations without cost telemetry are left out. Visibility into margin and usage only; nothing here changes the app.',
    custoJanela: 'Last {dias} days',
    custoTotalTexto: 'Text',
    custoTotalImagem: 'Image',
    custoTotalGeral: 'Total',
    custoDiaTitulo: 'Cost per day',
    custoDiaData: 'Day',
    custoDiaVazio: 'No measured cost in the window.',
    custoUsuariosTitulo: 'Top spenders by user',
    custoUsuarioCol: 'User',
    custoUsuariosVazio: 'No user with measured cost in the window.',
    custoDesfechoTitulo: 'Text cost by outcome',
    custoDesfechoDescricao:
      'Of the text-generation spend that produced a Recipe, how much became a Recipe someone saved or rated. Saved and rated overlap (a Recipe can be both).',
    custoDesfechoTotal: 'Generated (with Recipe)',
    custoDesfechoSalvos: 'Saved',
    custoDesfechoAvaliados: 'Rated',
    custoContagem: '{n} generation(s)',
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
    motivoRemocao: 'Reason details (not shown in the notification; the owner can see them in their data export)',
    // #609: closed-list reason category (`categoriaModeracaoLabel`); the owner sees it in the notification.
    categoriaRemocao: 'Reason shown to the owner',
    categoriaPlaceholder: 'Choose a reason',
    categoriaAjuda:
      'The owner sees this reason in the notification, with a link to ask us to reconsider. The details below are not shown in the notification, but the owner can see them in their data export: do not write data about other people there (for example, who reported it).',
    erroCategoria: 'Choose the reason shown to the owner.',
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
  // refinement, only the photo of a published recipe (#599). The image stays public (default-open, ADR-0020);
  // the Curator only monitors and can REMOVE (moderate, hides it from the public) OR DISMISS (judged fine, keeps
  // it public).
  revisaoImagens: {
    titulo: 'Images to review',
    descricao:
      "AI generations with the author's refinement that became the photo of a published recipe. The image stays visible to the public — this queue is just for monitoring. Remove it (hides it from the public) or dismiss it (keeps it visible).",
    receita: 'Recipe',
    autor: 'Author',
    semReceita: 'No linked recipe',
    refinada: 'Generated with refinement',
    abrirReceita: 'Open recipe',
    remover: 'Remove',
    removendo: 'Removing…',
    confirmarRemocao: 'Confirm removal',
    motivoRemocao: 'Reason details (not shown in the notification; the owner can see them in their data export)',
    // #609: closed-list reason category (`categoriaModeracaoLabel`); the owner sees it in the notification.
    categoriaRemocao: 'Reason shown to the owner',
    categoriaPlaceholder: 'Choose a reason',
    categoriaAjuda:
      'The owner sees this reason in the notification, with a link to ask us to reconsider. The details below are not shown in the notification, but the owner can see them in their data export: do not write data about other people there (for example, who reported it).',
    erroCategoria: 'Choose the reason shown to the owner.',
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
    // #498 (ADR-0031 companion iii): translated ingredient name editing.
    editarNomes: 'Edit ingredient names',
    fecharNomes: 'Close',
    carregandoIngredientes: 'Loading ingredients…',
    erroCarregarIngredientes: 'Could not load the ingredients.',
    semIngredientesNomeados: 'No named ingredients in this recipe.',
    nomeIngredienteLabel: 'Ingredient name',
    salvarNomes: 'Save',
    salvando: 'Saving…',
    nomesSalvos: 'Names saved.',
    erroSalvarNomes: 'Could not save the names. Try again.',
  },
  // Curator list — stale-and-diverged (#500, ADR-0031 dec.6): the source changed and the
  // content already diverged from the last machine translation (hand-edited) or is legacy
  // with no proof of untouched-ness. Reuses provenance/name-editor labels from `traducoesStale`.
  traducoesDivergentes: {
    titulo: 'Translations needing re-review',
    descricao:
      'The source changed and the content already diverges from the last machine translation — fix it by hand.',
    receita: 'Recipe',
    idioma: 'Language',
    origem: 'Origin',
    listaVazia: 'No translations need re-review.',
    motivo: 'Reason',
    motivoDivergente: 'Content edited by hand',
    motivoFalhaTraducao: 'Machine translation failed repeatedly',
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
  // `readonly string[]` (lists/tables by index). The real contacts are written DIRECTLY into these strings
  // (this section is the single place to edit the privacy channel).
  // Reviewed in the internal opinion of 2026-10-22 (`docs/legal/parecer-interno-2026-10-22.md`), which closed #276.
  // Changed collected data, purpose, provider, retention or logs? The SAME PR updates this section (new line in
  // `s10Historico` + footer) and `docs/legal/registro-de-operacoes.md` (CLAUDE.md, "Privacidade").
  privacidade: {
    metaTitulo: 'Privacy Policy — Refogando',
    titulo: 'Privacy Policy',

    parteATitulo: 'Part (a) — Privacy Policy',
    resumoTitulo: '30-second summary',
    resumoItens: [
      'Refogando is an AI recipe app.',
      'We collect the minimum: what is needed for you to have an account and use the app and, when you import a recipe from an external site, the author/site name and the source link, solely to give credit.',
      'We do not sell your data or use advertising. We share it only with providers that make the app work (hosting, database, AI, email), most of them in the United States.',
      'You have rights (access, correction, deletion, etc. — Art. 18 of the LGPD). You can download your data and delete your account in Edit profile → Your data; for anything else, write to privacidade@refogando.com. We respond within 15 days.',
      'This text may change: every version is recorded in the "Changes to this policy" section and, if a change alters something you authorized with your consent, we notify you prominently.',
    ],

    s1Titulo: '1. Who we are (identification of the controller) — Art. 9, III',
    s1Corpo: [
      'The data controller is Fernando Lisboa, an individual responsible for the Refogando app (https://www.refogando.com).',
      'Because Refogando is operated by an individual, there is no legal entity name or tax ID (CNPJ) associated; the official contact is the privacy e-mail indicated below.',
    ],

    s2Titulo: '2. Contact of the controller — Art. 9, IV; Art. 41',
    s2Itens: [
      'Privacy and data subject rights channel: privacidade@refogando.com, handled directly by the controller.',
      'Refogando is a small-scale processing agent and, as allowed by ANPD Resolution CD/ANPD No. 2/2022 (art. 11), has not appointed a data protection officer (DPO); this channel serves that function.',
      'Response time: we answer data subject requests within 15 calendar days (LGPD, Art. 19, II).',
    ],

    s3Titulo: '3. What we use your data for (specific purpose) — Art. 9, I; Art. 6, I',
    s3Intro:
      'We process personal data only for specific, informed purposes. Each activity follows the Data / Purpose / Legal basis / Retention pattern.',
    s3Nota:
      'The export (Edit profile → Your data) includes what items 3.1 to 3.6 describe that is linked to your account, except credentials (the password hash and the Google sign-in tokens, which are left out for security) and the list of who follows you (only the count is included, because following is someone else’s choice). Web Discovery is detailed in Part (b).',

    rotuloDados: 'Data',
    rotuloFinalidade: 'Purpose',
    rotuloBaseLegal: 'Legal basis',
    rotuloRetencao: 'Retention',

    s31Titulo: '3.1. User account and authentication',
    s31Valores: [
      'email, display name/identifier (handle), password (stored only as a hash), profile photo, bio, links, preferred language and default skill level; and whether you want your name on the copies other people publish of your recipes. If you sign in with Google, we receive your name, email and photo from Google, and we store the tokens for that sign-in.',
      'create and maintain your account, authenticate access and enable use of the app. Your name, @, photo, bio and links are on a public page (/u/your-@) that anyone can see, even without an account, and that search engines may index; it also shows who you follow and who follows you. Your name and @ also appear on the recipes you publish, on the ratings you write, in the cook search and in the notifications other people get when you follow them or rate one of their recipes. When someone publishes a copy of one of your recipes ("Create my version" or "Clone"), its page shows "Based on … by @you", linking to yours while yours stays published (it is your right as the author to be named, Brazilian Law 9,610/98, art. 24, II); you can turn this off in Edit profile or remove your name from a copy on its page. Your email, dietary restrictions and private content never appear.',
      'performance of a contract with the data subject (the Terms of Use) — Art. 7, V of the LGPD.',
      'while the account exists. If you delete your account, we immediately anonymize the identifying data and erase your password, your Google sign-in and all sessions. An email-and-password sign-up that is not confirmed is erased after 48 hours; to block abusive resends, we keep for 90 days only a code derived from the email, which cannot be used to recover it.',
    ],
    s32Titulo: '3.2. Content created in the app (recipes, collections, ratings, Meal plan, shopping lists and Pantry)',
    s32Valores: [
      'recipes you create, save, rate and organize; the photos you upload (we remove their metadata, such as location, on upload); text content you write; your Meal plan (the meals planned for each day, with servings and the free-text notes you write, such as "eating out"); your shopping lists (list name and items, with quantity, unit, source recipe and the bought check mark); and your Pantry (the names of the items you say you have at home and, if you edit it, your list of basics).',
      'deliver the app functionality (store and display your content, build collections, feed and search, plan meals, build shopping lists and show what you can cook with what you have at home). For search, the title, description and ingredients of each recipe, private ones included, go to Google (Gemini), which returns a search vector; for translation, the recipe goes to Anthropic.',
      'performance of a contract — Art. 7, V.',
      'while the account exists or until you delete the content. If you delete your account, we immediately erase everything that is only yours: private recipes, saved recipes, collections, shopping lists, Meal plan, Pantry, who you follow and who follows you, and notifications. The recipes you published and the ratings you wrote stay on Refogando without your name, because other people saved, rated or planned with them; rating photos are erased 180 days later. If you want a public recipe gone, delete it before deleting your account.',
    ],
    s33Titulo: '3.3. AI creation, images and translation',
    s33Valores: [
      'what you ask the AI for: the free text, the creation form (with the restrictions checked in the request) and the conversation; image requests and refinements and, when you ask to edit a photo, the photo itself; your request to the Menu suggestion (meals, servings and an optional free-text note), sent with the title and classification of the candidate recipes and not stored by us; usage records (date and, where applicable, model, tokens and cost, without the content); and hand-written ingredients that are not in the vocabulary: the ones that recur go, without your name, into a list the curators use to expand the vocabulary; and new cuisines you type under "Other", which go, without your name, into a curators’ queue and, if approved, become an option for everyone.',
      'generate recipes and dish images, choose the scene of the photo, translate recipes between Portuguese and English, extract ingredients from a text, suggest a menu from existing recipes, review images generated with a style request or edited by AI once they become the photo of a published recipe, expand the ingredient and cuisine vocabulary and enforce usage and cost limits.',
      'performance of a contract — Art. 7, V; and legitimate interest for abuse prevention/cost control, for the curators’ review of images and for expanding the vocabulary — Art. 7, IX.',
      'text requests and conversations are kept while the account exists (you can delete the conversation of each creation) and are erased if you delete your account; image requests are not stored, only the generated image. A menu suggestion is only stored as a planned meal if you accept it. Usage records are erased after 24 months (ingredient-extraction records, after 30 days); if you delete your account before that, they remain until then with nothing that identifies you.',
    ],
    s34Titulo: '3.4. Attribution of recipes imported from the web ("Web Discovery")',
    s34Corpo:
      'Detailed in Part (b). In short: we keep the author/site name and source URL, solely to give credit. Legal basis: legitimate interest — Art. 7, IX —, with a documented balancing test (the fact that the author published the name themselves weighs in favor).',
    s35Titulo: '3.5. Saved dietary restrictions',
    s35Valores: [
      'the dietary restrictions you save on your profile (e.g. vegan, gluten-free, no seafood), chosen from a fixed list — no free text. This is sensitive personal data (LGPD Art. 5, II): it may reveal health or religious belief. Only you can see it: it does not appear on your public profile. Along with them we keep the date and the version of the text you consented to, as proof of consent (Art. 8, §2).',
      'a single one: pre-checking your own requests — recipe creation, menu suggestion and search —, always with a notice and changeable on each request. They reach the AI provider (Anthropic, in the United States) only within a request in which you keep them checked.',
      'specific and highlighted consent — Art. 11, I —, given when you save (the text sits next to the button and states that the app runs in Brazil and the AI in the United States, Art. 33, VIII) and revocable at any time by unchecking them all and saving.',
      'until you uncheck them or delete your account (the date and version of the consent go with them); they are included in your data export and erased when the account is deleted.',
    ],
    s36Titulo: '3.6. Account security and abuse prevention',
    s36Valores: [
      'the IP address and browser (user agent) of each sign-in session; the IP address in the attempt limits of the account routes (such as sign-in, sign-up and password), erased within 2 hours after the last attempt, and, in memory only, to limit the pace of the Your Rights form and of Web Discovery; the reports you make about recipes or ratings; moderation decisions about your content or your account (for example, an image hidden from the public or a block on image generation), with the reason; and, if the team closes your account (the account of someone under 16 or a serious violation of the Terms of Use), a record of that decision: the reason, from a closed list, the date, whether your public recipes and reviews were removed and whether we tried to tell you by email.',
      'protect your account, prevent abuse and excessive use of paid resources, and moderate public content.',
      'legitimate interest — Art. 7, IX (with a recorded legitimate interest assessment); for the record of an account closure, the regular exercise of rights — Art. 7, VI.',
      'a session lasts 7 days, renewed as you use the app, and is erased within 1 day after it expires, together with its IP address and browser; the IP address in attempt limits, within 2 hours after the last attempt; reports are kept while the reported content exists; moderation decisions, while the account or the content exists (if you delete your account, they remain with nothing that identifies you); the record of an account closure by the team, for 5 years, for our defense in any legal proceeding, linked only to the already anonymized account and with no other data about you.',
    ],
    s37Titulo: '3.7. Technical logs',
    s37Valores: [
      'when something goes wrong, we log the shape of the page (without the full address or what was searched), the request method, the type of error and a technical code; if the error happened in your browser, also a short message of up to 160 characters in which emails, usernames, identifiers, addresses, tokens and long numbers are masked. Your browser sends this report without cookies; the sender’s IP address is used only in memory, to limit the number of reports, and is not stored. The log lines we write do not include IP addresses, cookies, your account identifier or the content of your recipes. On an unexpected server error, the platform (Next.js) also logs the technical message and the error trace, which in rare cases may include a piece of the data being processed. Vercel, which hosts the app, logs on its own the IP address, the browser and the address of each page requested (which may include a search term).',
      'find and fix errors and keep the app secure.',
      'legitimate interest — Art. 7, IX.',
      'they do not go into our database: they stay in Vercel’s logs for up to 30 days and are erased by Vercel.',
    ],
    s38Titulo: '3.8. Data subject requests (Your rights form)',
    s38Valores: [
      'the type of request, the link or name you provide, your message, the language and, if you wish, an email for our reply; and an audit record of each request (dates, type, the channel, the reason for a refusal and, when something is removed, only a code that proves the removal, never the data itself).',
      'handle your request and prove that we handled it.',
      'compliance with a legal obligation — Art. 7, II (Arts. 18 and 19) — and, for the audit record and keeping the emails as proof, the regular exercise of rights — Art. 7, VI.',
      'the request is erased 12 months after it is closed; the audit record, after 5 years; the emails exchanged through the privacy channel are kept for up to 5 years, as proof that we handled the request.',
    ],
    s39Titulo: '3.9. Search',
    s39Valores: [
      'the term you type in search, with or without an account.',
      'find recipes: the term is turned into a search vector by Google (Gemini) and, if you are signed in and Web Discovery is on, sent to Brave restricted to the approved sites.',
      'performance of a contract for account holders; legitimate interest — Art. 7, IX — for visitors.',
      'we do not store the term (see 3.7 on the hosting logs).',
    ],

    s4Titulo: '4. How and for how long we process (means and duration) — Art. 9, II',
    s4Itens: [
      'How: data is processed by electronic means, on servers of contracted service providers (item 5). We apply appropriate security measures (Art. 46): access only with authentication, passwords stored as hashes, connections always encrypted (HTTPS), removal of metadata from uploaded photos, and each piece of private content is shown only to its owner, with one exception: the out-of-vocabulary ingredients that recur and the new cuisines you type under "Other" reach the curators without your name (item 3.3). When the photo of a published recipe is an image generated with a style request of yours or edited by AI, it goes into a review queue for the curators, who see the image, the recipe title, your name and your @; the other images in the gallery and those of private recipes stay out of the queue. Images live at public addresses that are not listed and are hard to guess.',
      'For how long: we keep each piece of data only for as long as necessary for the purpose that justifies it or for a legal obligation. When the purpose ends, we erase or anonymize the data (Arts. 15, 16 and 12). The retention period of each processing activity is in item 3. We make a backup of the database every week and keep the three most recent: whatever is erased or anonymized leaves them within 4 weeks. Temporary copies of the database used to test changes are deleted when the test ends.',
    ],

    s5Titulo: '5. Who we share with (shared use) — Art. 9, V',
    s5Intro:
      'We do not sell personal data. We share data only with the providers below, strictly to operate the app. Almost all of them are processors (they process data on our behalf, under contract); for Google sign-in, Google is an independent provider of your Google account (item 6):',
    s5Cabecalho: ['Provider', 'For what', 'Category'],
    s5Prestadores: [
      'Vercel',
      'Neon',
      'Google (Gemini)',
      'Anthropic (Claude)',
      'Brave Search',
      'Resend',
      'Proton',
      'Google (sign-in)',
    ],
    s5ParaQue: [
      'App hosting and image storage (in São Paulo), technical logs',
      'Database (in São Paulo)',
      'Image generation and editing (including the photo you ask to edit) and search vectors',
      'Recipe generation and conversation, ingredient extraction, Menu suggestion, translation and choice of the photo scene',
      'External link search in "Web Discovery"',
      'Transactional email (sign-up confirmation, password reset, account closure notice, privacy alerts)',
      'Mailbox of the privacy channel',
      '"Continue with Google" (optional) and display of your Google photo on your profile',
    ],
    s5Categorias: [
      'Infrastructure processor',
      'Infrastructure processor',
      'AI processor',
      'AI processor',
      'Search processor',
      'Infrastructure processor',
      'Infrastructure processor',
      'Sign-in provider',
    ],
    s5Nota:
      'Purpose of sharing: exclusively the technical operation of the functions above; no partner receives data for its own marketing purposes. If you use Google sign-in, your Google photo is loaded from Google’s servers, which receive the IP address of whoever sees your photo on Refogando (profile, cook search and list, follower lists and notifications).',
    s5Transferencia:
      'International transfer: the app’s functions run on Vercel in São Paulo, where the database (Neon) and the images also are; Vercel and Neon are United States companies, and their support and technical logs (item 3.7) may be handled there. Anthropic, Google, Brave and Resend process data in the United States, and the mailbox is in Switzerland (Proton). We rely on Art. 33, IX of the LGPD: the transfer is necessary to perform the service you request (Art. 7, V) or to handle data subject requests (Art. 7, II). With Google (Gemini), the ANPD standard contractual clauses that Google incorporates into its contract also apply (Art. 33, II, "b"). Saved dietary restrictions only go to the United States, to the AI, with your specific consent (Art. 33, VIII). No AI provider may use your content to train models.',

    s6Titulo: '6. Responsibilities of the processing agents — Art. 9, VI; Arts. 37–39',
    s6Itens: [
      'Fernando Lisboa acts as controller and is responsible for the decisions about the processing.',
      'The providers in item 5 act as processors, processing data according to our instructions and under contract; for Google sign-in, Google acts as an independent provider of your Google account.',
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
      'Review of decisions made solely by automated processing that affect your interests (Art. 20) — apart from automatic limits that are the same for everyone (daily AI quotas, attempt limits, removal of unconfirmed sign-ups), Refogando does not make that kind of decision; you can ask for a review through the privacy channel.',
    ],
    s7ComoExercer:
      'How to exercise: download a copy of your data or delete your account in Edit profile → Your data; for anything else, use the Your Rights page (/seus-direitos) or write to privacidade@refogando.com. We respond within 15 calendar days (Art. 19, II), free of charge. You may also petition the National Data Protection Authority (ANPD).',

    // Section 8 (v3): Name / For what / Duration table, rows by index (s8Nomes[i], s8ParaQue[i], s8Duracoes[i]).
    s8Titulo: '8. Cookies and browser storage',
    s8Intro:
      'We use only cookies and storage that are strictly necessary for the app to work. There are no advertising, analytics or third-party cookies; that is why we do not ask for consent for them (ANPD cookie guide).',
    s8Cabecalho: ['Name', 'For what', 'Duration'],
    s8Nomes: [
      'Session cookie',
      'locale',
      'theme',
      'Temporary Google sign-in cookies',
      'localStorage',
      'sessionStorage',
    ],
    s8ParaQue: [
      'keep you signed in securely',
      'remember the language you chose',
      'remember the light or dark theme',
      'protect Google sign-in against fraud',
      'remember the last tab, the welcome tour, the Menu suggestion servings and whether you have already seen the notice about changes to the Terms and the Policy',
      'avoid repeated error reports and back-to-back reloads after an update, remember the search’s "Show all" and hold for a few seconds, until the next page, the request to replay the tour and the account-deletion notice',
    ],
    s8Duracoes: [
      'until the session expires',
      '1 year',
      '1 year',
      'minutes',
      'the last tab, until you sign out; the rest, until you clear your browser data',
      'until you close the tab',
    ],

    // Section 9 (v3.1, ADR-0051): minimum age of 16. The Terms of Use say the same (item 2).
    s9Titulo: '9. Children and teenagers',
    s9Corpo:
      'Refogando is intended for people aged 16 or older and is not directed at children. Teenagers aged 16 and 17 may have an account; for them, as for everyone, new recipes start out private, there is no advertising, profiling or location tracking, dietary restrictions are only saved with consent, and we process their data in their best interest (LGPD, Art. 14). The public profile and ratings are visible to everyone, as for any account (item 3.1). If we learn that an account belongs to someone under 16, we email the account and, if the age is not confirmed, we delete the account and what it published.',

    s10Titulo: '10. Changes to this policy',
    s10Corpo:
      'We may update this policy. Each version is recorded below, with its date and what changed. If a change alters something you authorized with your consent, we notify you prominently where you gave it, and you can withdraw it there.',
    // One line per published version (newest last); the footer repeats the latest. The v3.1 date comes from
    // `DATA_PUBLICACAO_TERMOS_V1` (`src/domain/legal-notice.ts`), the same as the Terms.
    s10Historico: [
      'v1 — 2026-07-03: first published version.',
      'v2 — 2026-10-13: Meal plan, shopping lists, Pantry and saved dietary restrictions.',
      'v3 — 2026-10-23: full internal review: account deletion and retention periods, Google sign-in, public profile, search and image review by the curators, security and technical logs, backups, cookies, international transfer (saved restrictions processed in the United States), data subject requests and privacy channel.',
      `v3.1 — ${DATA_PUBLICACAO_TERMOS_V1}: minimum age of 16 (section 9), the Terms of Use as the account contract (item 3.1) and the browser remembering the change notice (item 8).`,
      `v3.2 — ${DATA_POLITICA_V3_2}: the curators review only the photo of published recipes; the other images in the gallery and those of private recipes stay out of the queue (item 3.3 and section 4).`,
      `v3.3 — ${DATA_POLITICA_V3_3}: we keep the date and the version of the text you consented to for your saved restrictions, as proof of consent (item 3.5); the notice about changes to your restrictions is no longer kept in the browser and shows until you save again (section 8).`,
      `v3.4 — ${DATA_POLITICA_V3_4}: when the team closes an account, we keep a record of the decision for 5 years (reason, date, whether public content was removed and whether we tried to tell the person by email), with no other personal data (item 3.6); the account closure notice by email joins what Resend sends (item 5).`,
      `v3.5 — ${DATA_POLITICA_V3_5}: a copy someone else publishes of one of your recipes shows "Based on … by @you", with a link; you can turn this off in Edit profile or remove your name from a copy, and we keep that choice (item 3.1).`,
      `v3.6 — ${DATA_POLITICA_V3_6}: the app’s functions now run in São Paulo, next to the database; the AI remains in the United States, and the consent text for saved restrictions says so (item 3.5 and section 6).`,
    ],

    parteBTitulo: 'Part (b) — "Web Discovery"',
    resumoBTitulo: 'Summary of this section',
    resumoBItens: [
      'When you import a recipe from an external site, we keep two things about the origin: the author/site name and the link (URL) — solely to credit the source.',
      'We do not copy the photo or the introductory text (an imported recipe is born without an image and without a description); the method comes as the site published it.',
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
      'We do not copy the photo (an imported recipe is born without an image) or the introductory text (headnote): from the recipe, we bring only the title, the ingredients and the method, the latter with the text as the site published it. The copy stays private, credited and cannot be published.',
      'Give credit to the source ("source: … (link)") — honoring the moral right of attribution (Law 9,610/98) — and send traffic back to the source site. Attribution is mandatory, not optional.',
      'Legitimate interest — LGPD Art. 7, IX —, with a documented balancing test (Art. 10). The fact that the author published the name with the recipe themselves weighs in favor in the balancing (Art. 7, §§3 and 4).',
      'While the imported recipe exists in the user’s private collection, or until the author requests removal of the name (item b.5), or until the user deletes the recipe. When the name is removed, the credit shows only the site (host) derived from the URL.',
    ],

    b4Titulo: 'b.4. Sharing in this feature',
    b4Corpo:
      'To find the external links, we query the Brave search provider (processor), sending the search term restricted to the allowlist domains. The import itself is a copy made at the user’s request, stored privately in their account — it is not republished or shared with third parties.',

    b5Titulo: 'b.5. Data subject rights (external recipe author) and how to exercise them — Art. 18',
    b5Intro:
      'If you are the author of a recipe that was imported into Refogando and want to remove your name from the attribution, you have that right (Art. 18, IV; and the right to object to processing based on legitimate interest, Art. 18, §2).',
    b5ComoFunciona: [
      'Standard removal clears only the name; the source URL remains, because crediting the source is mandatory, and the credit then shows the site name (host) derived from the URL. If the URL itself identifies you (for example, your name in the blog address) or if you object to the processing as a whole, we also unlink the URL.',
      'If you own the site or the rights to the content and do not want copies on Refogando, we delete the recipes imported from your site and remove it from the list of approved sites.',
      'Removal is not reversible to the original name — which is appropriate for the right to removal.',
    ],
    b5Contato:
      'Contact for this purpose: privacidade@refogando.com — response within 15 days. You can also use the public form on the Your Rights page (/seus-direitos).',

    todoRotulo: 'field to be filled in',
    rodapeVersaoRotulo: 'Version',
    rodapeVersao: 'v3.6',
    rodapeDataRotulo: 'Date',
    rodapeData: DATA_POLITICA_V3_6,
    rodapeStatusRotulo: 'Status',
    rodapeStatus: 'Published — internal review completed on 2026-10-22',
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
      'If you are an app user, you download your data and delete your account in Edit profile → Your data, and you correct your profile, recipes, collections, Meal plan, shopping lists and Pantry directly in your account. For anything not self-service, write to privacidade@refogando.com — always within the 15-day deadline.',
    titularBTitulo: 'You are the author of a recipe imported from the web',
    titularBCorpo:
      'If a recipe of yours was imported from an external site into Refogando, the only things we keep about you are your name (credit) and the source link; of the recipe itself, only the title, the ingredients and the method as the site published it, in a private copy that cannot be published — never the photo or the introductory text. You may request removal of your name (the credit then shows only the site), removal of the link as well or, if you own the site, removal of the copies. You do NOT need an account: use the form below.',

    fluxoTitulo: 'How a request works',
    fluxoPassos: [
      'You send the request via the form (or the privacy email), identifying the content (source link and/or displayed name) and what you want.',
      'We open a case and record the date of receipt — that is when the 15-day deadline starts to run (Art. 19, II).',
      'We confirm your identity as simply as possible (usually correspondence with the contact already tied to the source). We do not require documents as a condition (Art. 6, III).',
      'We carry out the request and reply within the deadline, stating what was done — or, in case of a justified refusal, the reason.',
    ],
    prazoNota: 'Response time: up to 15 calendar days from receipt (LGPD, Art. 19, II).',
    naoExigimosDocumentos:
      'We collect only the minimum needed to locate the content and handle the request. We do not require documents or additional personal data as a condition (Art. 6, III — necessity).',

    canalTitulo: 'Contact channel',
    canalCorpo:
      'Privacy and data subject rights channel: privacidade@refogando.com, handled by the controller, Fernando Lisboa. As a small-scale processing agent, Refogando has not appointed a data protection officer (CD/ANPD Resolution No. 2/2022, art. 11).',

    formTitulo: 'Open a request',
    formIntro:
      'Fill in your request below. Provide the source link and/or the displayed name so we can locate the content, and describe what you want.',
    formTipoRotulo: 'Request type',
    formTipoNameRemoval: 'Remove my name from the credit (keeping the link)',
    formTipoFullRemoval: 'Remove the imported recipe or the link',
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
    formContatoDica: 'Optional. If provided, we use it only to reply to this request; the request is erased 12 months after it is closed.',
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
    rodapeVersao: 'v3.6',
    rodapeDataRotulo: 'Date',
    rodapeData: DATA_POLITICA_V3_6,
    rodapeStatusRotulo: 'Status',
    rodapeStatus: 'Published — internal review completed on 2026-10-22',
  },
  // Terms of Use v1 (ADR-0051). Faithful translation of the pt-BR text, same keys and array lengths. See pt-BR.ts
  // for the full note (bold clauses decided in the component; a relevant change needs a notice 15 days ahead).
  termos: {
    metaTitulo: 'Terms of Use — Refogando',
    titulo: 'Refogando Terms of Use',
    nome: 'Terms of Use',
    intro:
      'These Terms are the agreement between you and Refogando for using the app. They are short on purpose: read them before creating your account. How we handle your data is in the Privacy Policy (/privacidade).',

    s1Titulo: '1. Who we are',
    s1Corpo: [
      'Refogando (https://www.refogando.com) is run by Fernando Lisboa, an individual, in Brazil. Contact: privacidade@refogando.com.',
      'The app is free, has no advertising and may change or cease to exist. We give advance notice when a change affects what you have stored in it.',
    ],

    s2Titulo: '2. Who can use it',
    s2Corpo: [
      'You must be 16 or older to create an account. By creating an account, you confirm that you are.',
      'If you are 16 or 17, use Refogando with the knowledge of your parent or guardian, and read these Terms with them. If you are the parent or guardian of someone aged 16 or 17 and want the account deleted, write to privacidade@refogando.com.',
      'If we learn that an account belongs to someone under 16, we email the account and, if the age is not confirmed, we delete the account and what it published.',
      'Without an account, you can read public recipes and use search.',
    ],

    s3Titulo: '3. Your account',
    s3Corpo: [
      'Use an email address that is yours and do not pretend to be someone else. Keep your password safe. You are responsible for what is done in your account, unless it is used through no fault of yours; in that case, let us know right away.',
      'An account belongs to one person. Do not sell, lend or transfer your account.',
      'You can download your data and delete your account whenever you want, in Edit profile → Your data.',
    ],

    s4Titulo: '4. AI-generated recipes and images',
    s4Corpo: [
      'Recipes, suggestions, translations and images generated by AI may contain errors: quantities, times, temperatures, ingredients that do not fit your restriction, unflagged allergens. Check before cooking, especially if you or whoever will eat has an allergy, an intolerance or a diet for health reasons.',
      'Refogando does not give medical, nutritional or food-safety advice. Selecting a restriction helps the AI, but does not guarantee that the recipe is safe for you.',
      'Do not ask the AI for images of identifiable real people, sexual, violent or hateful content, or images that imitate someone else’s brand or work as if it were yours.',
    ],

    s5Titulo: '5. Your content',
    s5Corpo: [
      'What you write and the photos you upload remain yours.',
      'While a recipe of yours is private, it does not appear to other people and we use it only to make the app work. The exception is in the Privacy Policy: the ingredients you type by hand and the new cuisines you type under "Other" may reach the curators, without your name, to expand the vocabulary.',
      'When you publish a recipe, a review or a photo, you give Refogando a free, non-exclusive, worldwide license to store that content, display and reproduce it in the app, in search engines and in share cards, translate it automatically, adapt it to the app’s formats (such as thumbnails and shopping lists) and let other people save and rate the recipe, add it to their Meal plan and make copies of its text, without your photos ("Create my version" and "Clone"), which they can edit and publish. The license lasts while the content is published, including after you delete your account.',
      'You can unpublish or delete your content at any time. Copies that other people have already made of a public recipe stay with them.',
      'A copy made directly from your recipe and published shows "Based on … by @you", linking to your recipe while it stays published. If you do not want your name on copies, turn this off in Edit profile; to remove your name from a single copy, use "Remove my name" on its page.',
      'If you delete your account, the recipes you published and the reviews you wrote stay on Refogando without your name, because other people rely on them. If you want a public recipe gone, delete it before deleting your account.',
      'Only publish what is yours or what you have the right to publish. Do not copy text or photos from books, websites or other people’s profiles.',
    ],

    s6Titulo: '6. Recipes imported from the web',
    s6Corpo: [
      'A recipe imported through Web Discovery always stays private, for your personal use, and shows credit to the source site. It cannot be published. If the author or the owner of the site asks, we may remove the name or the link from the credit, or delete the imported recipe from your collection.',
      'If you are the author or owner of a site and want your name or the copies removed, use the Your rights page (/seus-direitos).',
    ],

    s7Titulo: '7. What is not allowed',
    s7Itens: [
      'Publishing content that is illegal, that violates other people’s rights (copyright, image, privacy) or that is offensive, discriminatory, harassing or hateful.',
      'Using the app for spam, advertising, scams or to collect other people’s data.',
      'Accessing the app through bots, scripts or other automated means, getting around usage limits or trying to access what is not yours.',
      'Disrupting the app’s operation or its security.',
    ],

    s8Titulo: '8. Reports and moderation',
    s8Corpo: [
      'Anyone with an account can report a public recipe or a review with the Report button. You can also write to privacidade@refogando.com, which is the way to report a profile or to report without an account.',
      'We review every report. When content is clearly illegal or violates these Terms, we take it down and record the decision, with the reason.',
      'If moderation takes down a recipe, image or review of yours, you get a notification in the app with the reason, chosen from a closed list that follows these Terms, and a link to ask us to reconsider by email; if it is your profile, we let you know by email. To learn more about the reason or ask us to reconsider, write to privacidade@refogando.com.',
      'In serious or repeated violations, we may block features of the account, such as AI image generation, or close the account. We let you know beforehand when possible and, except in the case of illegal content, you have 15 days to download your data before the account is closed. You can ask us to reconsider at privacidade@refogando.com.',
    ],

    s9Titulo: '9. Liability',
    s9Corpo: [
      'We do our best to keep the app running and your data safe, but the app may go down or have failures.',
      'Content published by other people is the responsibility of whoever published it. When we are notified of illegal content, we act as described in item 8, and we are liable for it in the cases provided by law.',
      'Nothing in these Terms takes away a right that the law guarantees you.',
    ],

    s10Titulo: '10. Changes to these Terms',
    s10Corpo: [
      'We may update these Terms. When a change is relevant, we notify you in the app or by email at least 15 days in advance. If you do not agree, you can delete your account before the change takes effect.',
      'Each version is recorded below, with its date.',
    ],
    s10Historico: [
      `v1 — ${DATA_PUBLICACAO_TERMOS_V1}: first version.`,
      `v1.1 — ${DATA_TERMOS_V1_1}: public recipes can now also be reported with the Report button on the recipe page (item 8).`,
      `v1.2 — ${DATA_TERMOS_V1_2}: the curators no longer review images of private recipes (item 5).`,
      `v1.3 — ${DATA_TERMOS_V1_3}: the takedown notification now shows the reason, from a closed list, and a link to ask us to reconsider (item 8).`,
      `v1.4 — ${DATA_TERMOS_V1_4}: a published copy of one of your recipes shows "Based on … by @you", and you can turn this off or remove your name from a copy (item 5).`,
    ],

    s11Titulo: '11. Law and venue',
    s11Corpo: ['These Terms are governed by Brazilian law. Any dispute may be brought before the courts of your place of residence.'],

    rodapeVersaoRotulo: 'Version',
    rodapeVersao: 'v1.4',
    rodapeDataRotulo: 'Date',
    rodapeData: DATA_TERMOS_V1_4,
  },
  // Legal-change notice (ADR-0051), in the layout, only for accounts created by the end of the publication day. See pt-BR.ts.
  avisoLegal: {
    texto: 'We have published the Terms of Use and updated the Privacy Policy. Read what changed.',
    fechar: 'Got it',
  },
  // Quota-limit upsell card (billing Phase 2, flag-off). See pt-BR.ts for the full note.
  upsell: {
    titulo: "You've reached the free plan limit",
    descricao:
      "Subscribe to Pro to generate more, or buy extra credits when you need them. Billing isn't available yet — we're getting it ready.",
    cta: 'See plans',
  },
  // Placeholder `/plan` page (billing Phase 2, flag-off): "coming soon", no price or date commitment.
  plano: {
    metaTitulo: 'Plans — Refogando',
    titulo: 'Plans',
    corpo: "We're preparing a Pro plan with more AI generations, plus one-off credits for anyone who prefers to pay only for what they use. You can't subscribe or buy yet — check back soon.",
    voltar: 'Back to home',
  },
  despensa: {
    titulo: 'Pantry',
    descricao: 'Tell us what you have at home and see what you can cook now or with a short shopping trip.',
    precisaEntrar: 'Sign in to set up your pantry.',
    adicionarRotulo: 'What you have at home',
    adicionarPlaceholder: 'E.g. eggs, tomato, cheese',
    adicionarDica: 'Separate several items with commas.',
    adicionar: 'Add',
    adicionando: 'Adding…',
    sugestoesTitulo: 'Common items',
    sugestoes: ['egg', 'rice', 'beans', 'onion', 'garlic', 'tomato', 'potato', 'chicken', 'cheese', 'milk', 'butter', 'flour', 'pasta', 'lemon'],
    sugestaoAdicionar: 'Add {nome} to the pantry',
    vazia: 'Your pantry is empty. Add what you have at home to see what you can make.',
    itensContagem: '{n} items in the pantry',
    itemContagem: '1 item in the pantry',
    remover: 'Remove {nome} from the pantry',
    limpar: 'Clear pantry',
    confirmarLimpar: 'Remove every item from the pantry?',
    basicos: 'I have the basics ({lista})',
    basicosLista: 'salt, water, oil, olive oil, and black pepper',
    basicosNenhum: 'I have the basics (your list is empty)',
    basicosEditar: 'Your basics',
    basicosDica: 'What you always have at home. With “I have the basics” on, they count as already in your pantry, and “I cooked this” on the meal plan never removes them. The default list has Portuguese and English names because it applies to recipes in both languages.',
    basicosVazio: 'No basics on your list.',
    basicoRemover: 'Remove {nome} from your basics',
    basicoAdicionarRotulo: 'Add a basic',
    basicoAdicionarPlaceholder: 'E.g. garlic, sugar',
    basicosPadrao: 'Reset to default',
    basicosErroDados: 'Use names up to {max} characters, at most {teto} basics.',
    resultadosTitulo: 'What you can make',
    prontasTitulo: 'Ready to cook',
    quaseProntasTitulo: 'Almost there',
    semResultados: 'No recipe matches your pantry yet. Add more items or create a recipe with what you have.',
    temDeTotal: 'You have {n} of {total}',
    falta: 'Missing: {lista}',
    porNaLista: 'Add missing items to list',
    pondoNaLista: 'Adding…',
    postoNaLista: 'Added to “{lista}”.',
    abrirLista: 'Open list',
    criarComDespensa: 'Create a recipe with what I have',
    criarPrompt: 'a recipe with {lista}',
    criarComDespensaDica: 'The AI creates a new recipe from your pantry.',
    comoCasa: 'We match by ingredient name: “flour” counts for “all-purpose flour”. Check the recipe before you cook.',
    erroCarregar: 'Could not load your pantry. Try again.',
    erroCarregarResultados: 'Could not find recipes. Try again.',
    erroAdicionar: 'Use names up to {max} characters, at most {lote} at a time.',
    erroCheia: 'Your pantry reached the limit of {max} items. Remove some before adding more.',
    erro: 'Could not save the change. Try again.',
    nadaFaltando: 'With your current pantry, nothing is missing from this recipe.',
    erroPorNaLista: 'Could not add to the list. Try again.',
  },
  cardapio: {
    fechar: 'Close',
    titulo: 'Weekly meal plan',
    descricao: 'Plan the week’s meals and build the shopping list in one go.',
    semanaAnterior: 'Previous week',
    proximaSemana: 'Next week',
    estaSemana: 'This week',
    hoje: 'Today',
    slotCafeDaManha: 'Breakfast',
    slotAlmoco: 'Lunch',
    slotLanche: 'Snack',
    slotJantar: 'Dinner',
    adicionar: 'Add',
    adicionarAoDia: 'Add a recipe on {dia}',
    porcoesValor: '{n} servings',
    porcaoValor: '1 serving',
    porcoesDiminuir: 'Fewer servings of {nome}',
    porcoesAumentar: 'More servings of {nome}',
    moverPara: 'Move {nome} to',
    remover: 'Remove {nome} from the plan',
    receitaIndisponivel: 'Recipe unavailable',
    receitaIndisponivelDica: 'It is no longer available to you.',
    vazioDia: 'Nothing planned',
    vazioSemana: 'Your week is open. Add recipes from your Saved or your creations, or use the calendar button on any recipe.',
    precisaEntrar: 'Sign in to plan your meals.',
    erroCarregar: 'Couldn’t load your meal plan. Try again.',
    erroSalvar: 'Couldn’t save the change. Try again.',
    erroDiaCheio: 'That day is already full.',
    erroJaPlanejada: 'That’s already in that meal.',
    resumoSemana: '{n} meals planned',
    resumoSemanaSingular: '1 meal planned',
    escolherReceita: 'Add to meal plan',
    escolherReceitaDescricao: 'Pick a recipe from your Saved or your creations, or jot down something without a recipe.',
    buscarReceita: 'Search recipes',
    semReceitas: 'You haven’t saved or created any recipes yet. Explore and save a few to plan with.',
    semResultados: 'No recipes found.',
    explorar: 'Explore recipes',
    dia: 'Day',
    refeicao: 'Meal',
    planejar: 'Add',
    planejando: 'Adding…',
    erroCarregarReceitas: 'Couldn’t load your recipes. Try again.',
    criarNova: 'Create a new recipe with AI',
    criarNovaDica: 'You review the request before generating, then add the recipe to this meal in one tap.',
    criarNovaPrompt: 'a {refeicao} recipe',
    porNoCardapio: 'Add to meal plan',
    porNoCardapioAlvo: 'Add to meal plan: {dia}, {refeicao}',
    planejarReceita: 'Add to meal plan',
    convidaEntrar: 'Sign in to add to your meal plan.',
    planejadaEm: 'Added to your meal plan: {dia}, {refeicao}.',
    verCardapio: 'View meal plan',
    gerarLista: 'Build shopping list',
    gerarListaDescricao: 'Ingredients from the period’s recipes go on the list, at the servings you planned. Matching items add up.',
    periodo: 'Period',
    semanaInteira: 'Whole week',
    deHojeEmDiante: 'Today through Sunday',
    listaDestino: 'List',
    nomeListaPadrao: 'Groceries for week of {data}',
    gerando: 'Building…',
    listaGerada: '{n} meals went to “{lista}”.',
    listaGeradaSingular: '1 meal went to “{lista}”.',
    abrirLista: 'Open list',
    avisoSemPorcoes: '{n} recipes without set servings went in at the original amount.',
    avisoSemPorcoesSingular: '1 recipe without set servings went in at the original amount.',
    algumasIndisponiveis: 'Unavailable recipes were left out.',
    erroPlanoVazio: 'There are no meals with an available recipe in that period.',
    erroGerar: 'Couldn’t build the list. Try again.',
    // AI menu suggestion (ADR-0036).
    sugerir: 'Suggest with AI',
    sugerirTitulo: 'Suggest a menu with AI',
    sugerirDescricao: 'The AI picks recipes from your Saved, your creations and, if you want, the community. Nothing goes into the planner until you accept it.',
    sugerirDias: 'Days',
    sugerirRefeicoes: 'Meals',
    sugerirPorcoes: 'Servings per meal',
    sugerirRestricoes: 'Dietary needs (as declared by recipes)',
    sugerirFonte: 'Where recipes come from',
    sugerirFonteTodas: 'My collection and the community',
    sugerirFonteMinhas: 'Only my Saved and my creations',
    sugerirSoVazias: 'Only fill empty meals',
    sugerirNota: 'Anything in mind? (optional)',
    sugerirNotaPlaceholder: 'E.g. light dinners, fish on Friday',
    sugerirEnviar: 'Suggest menu',
    sugerindo: 'Putting your menu together… this can take up to a minute.',
    sugestaoPreviaDescricao: "Uncheck what you don't want and add the rest to your planner.",
    sugestaoIncluir: 'Include {nome} on {dia}, {refeicao}',
    sugestaoAceitar: 'Add {n} to the planner',
    sugestaoAceitarSingular: 'Add 1 to the planner',
    sugestaoAceitando: 'Adding…',
    sugestaoDeNovo: 'Suggest again',
    sugestaoAjustar: 'Edit request',
    sugestaoParcial: 'The AI filled {n} of {total} meals; nothing in your selection fit the others.',
    sugestaoVazia: 'The AI found no recipes that fit your request. Try including the community or changing the dietary needs.',
    sugestaoAdicionada: '{n} meals were added to your planner.',
    sugestaoAdicionadaSingular: '1 meal was added to your planner.',
    sugestaoPuladas: '{n} were left out (day full, already planned or recipe unavailable).',
    sugestaoPuladasSingular: '1 was left out (day full, already planned or recipe unavailable).',
    abreNovaAba: '(opens in a new tab)',
    tempoHoras: '{n} h',
    tempoMinutos: '{n} min',
    erroSugestaoDados: 'Pick at least one day and one meal.',
    erroSugestaoPedido: "We couldn't read that request. Check the days and meals and try again.",
    erroSugestaoNadaAPreencher: 'Those meals are already planned. Uncheck “Only fill empty meals” to get suggestions anyway.',
    erroSugestaoSemCandidatas: 'No recipe fits your request. Save a few recipes, include the community or change the dietary needs.',
    erroSugestaoPorcoes: 'Servings go from 1 to 99.',
    erroSugestaoLimite: "You've reached today's suggestion limit. Try again in {tempo}.",
    erroSugestaoFalhou: "The AI couldn't put your menu together right now. Try again.",
    erroSugestaoAceitar: "Couldn't add to your planner. Try again.",
    // Free-text note instead of a recipe (ADR-0037).
    anotacaoTitulo: 'No recipe',
    anotacaoRotulo: 'Note',
    anotacaoPlaceholder: 'E.g. eating out, Tuesday’s leftovers',
    anotacaoSugestoes: ['Eating out', 'Leftovers', 'Takeout'],
    anotacaoDica: 'Notes fill the meal but don’t go on the shopping list.',
    anotar: 'Add note',
    anotando: 'Adding…',
    anotarRapido: 'Add note “{texto}”',
    erroAnotacao: 'Write 1 to {max} characters.',
    // Copy the previous week (ADR-0037).
    copiarSemana: 'Copy previous week',
    copiarSemanaDica: 'Repeats the previous week in this week’s empty meals.',
    copiarSemanaDicaHoje: 'Repeats the previous week in the empty meals from today through Sunday.',
    copiando: 'Copying…',
    copiadas: '{n} meals copied from the previous week.',
    copiadasSingular: '1 meal copied from the previous week.',
    copiaPuladas: '{n} left out (meal already planned, day full or recipe unavailable).',
    copiaPuladasSingular: '1 left out (meal already planned, day full or recipe unavailable).',
    copiaNada: 'Nothing was copied: those meals were already planned or the recipes are unavailable.',
    erroCopiaVazia: 'The previous week has nothing for those days.',
    erroCopiar: 'Couldn’t copy the week. Try again.',
    cozinhei: 'I cooked this',
    cozinheiAria: 'I cooked this ({nome}): remove what the recipe uses from the pantry',
    cozinheiDica: 'Removes this recipe’s ingredients from your pantry (except your basics).',
    cozinhando: 'Updating…',
    cozinheiRemovidos: 'Removed from your pantry: {lista}.',
    cozinheiBasicosFicaram: 'Your basics stay: {lista}.',
    cozinheiSoBasicos: 'Only basics matched, and they stay in your pantry: {lista}.',
    cozinheiNada: 'Nothing in your pantry matched this recipe.',
    cozinheiDesfeito: 'Back in your pantry: {lista}.',
    desfazer: 'Undo',
    desfazendo: 'Undoing…',
    verDespensa: 'View pantry',
    erroCozinhei: 'Couldn’t update your pantry. Try again.',
    erroDesfazer: 'Couldn’t put the items back. Try again.',
    erroDesfazerCheia: 'Your pantry is full; remove some items to put these back.',
  },
  tour: {
    passoDe: 'Step {atual} of {total}',
    comecar: 'Start the tour',
    agoraNao: 'Not now',
    voltar: 'Back',
    proximo: 'Next',
    concluir: 'Done',
    pular: 'Skip tour',
    fechar: 'Close the tour',
    noMenu: 'On a phone, it’s in the ☰ menu.',
    verGuia: 'See the full guide',
    boasVindasTitulo: 'Welcome to Refogando',
    boasVindasTexto: 'In under a minute, we’ll show you where everything is. You can leave at any time.',
    buscaTitulo: 'Search for any dish',
    buscaTexto: 'Type a dish, an ingredient or a style. Can’t find what you want? With an account, you can generate the recipe with AI right from your search.',
    criarTitulo: 'Create your own recipe',
    criarTexto: 'In “Create”, AI builds a recipe your way: with a form, by describing the dish in one go, or by chatting. What you create lives in “My recipes”.',
    minhasReceitasTitulo: 'Your recipes',
    minhasReceitasTexto: 'The recipes you created and the ones you saved live here. Tap “Save” on a recipe and it shows up in “Saved”, where you can organize it into collections.',
    planejarTitulo: 'Plan your week',
    planejarTexto: '“Planner” holds your weekly Meal plan, your Shopping lists and your Pantry: build the week, generate a list with the right servings and see what you can cook with what you have.',
    contaTitulo: 'Your account',
    contaTexto: 'Your profile and this guide (“How to use”) live here, so you can replay the tour anytime.',
    contaTextoVisitante: 'Sign in or create an account to save recipes, create with AI and plan your week.',
    fimTitulo: 'You’re all set!',
    fimTexto: 'That’s the basics. The full guide explains each feature in detail, and you can replay the tour from there.',
  },
  guia: {
    metaTitulo: 'How to use Refogando',
    titulo: 'How to use Refogando',
    intro: 'A quick walk through everything you can do in the app: find recipes, create with AI, organize what you like and plan your week.',
    tourTitulo: 'Rather see it on screen?',
    tourTexto: 'The guided tour highlights each part of the app, one step at a time. You can skip it whenever you want.',
    tourBotao: 'Take the guided tour',
    indice: 'On this page',
    buscarTitulo: 'Finding recipes',
    buscarItens: [
      'In “Explore”, under the “Discover” tab (the home page), type a dish, an ingredient or a style in the search. Filters narrow it down by cuisine, category and dietary restriction.',
      'Didn’t find it? With an account and at least 3 letters, use “Generate with AI” to create a recipe from what you searched for.',
      'With an account you can also search the web. Recipes from other sites can be imported into your profile: they stay private and credit the source.',
    ],
    criarTitulo: 'Creating a recipe with AI',
    criarItens: [
      'Tap “Create” at the top of the screen and pick a way: Structured form (ingredients, cuisine, restrictions), Open prompt (describe the dish in one go) or Chat (refine it until it’s just right, then ask to distill the recipe).',
      'Every recipe starts out private. Publish it to the community whenever you want.',
      'On your recipes you can edit, ask AI for a new version and add a photo (your own or generated with AI).',
      'Like someone else’s recipe but want to change something? “Create my version” makes a copy of your own without touching the original.',
      'Everything you create lives in “My recipes”, under the “Creations” tab.',
    ],
    receitaTitulo: 'On the recipe page',
    receitaItens: [
      'Adjust the servings and the ingredient amounts follow along.',
      'Cook mode shows one step at a time, with timers for timed steps.',
      'Share the link, rate it with stars and a comment, and browse similar recipes.',
      'The save, shopping list and meal plan buttons are here too.',
    ],
    salvosTitulo: 'Saved and collections',
    salvosItens: [
      'Tap “Save” on any recipe. They all show up in “My recipes”, under the “Saved” tab.',
      'Create collections (say, “Sunday lunch”) to stay organized. Removing a recipe from a collection doesn’t unsave it.',
      'In “Saved”, select several recipes to send them to a shopping list at once.',
    ],
    listaTitulo: 'Shopping list',
    listaItens: [
      'On a recipe, “Add to shopping list” brings in the ingredients for the servings you choose. Matching items add up.',
      'Check off what you’ve bought, edit amounts and add extra items. Nothing disappears on its own: clearing the list is always your call.',
      'Your lists are in “Planner”, under the “Shopping lists” tab.',
    ],
    cardapioTitulo: 'Weekly meal plan',
    cardapioItens: [
      'In “Planner”, under the “Meal plan” tab, add recipes to each day and meal, with the number of servings. You can move or remove them later.',
      'A meal without a recipe? Jot down free text, like “eating out” or “leftovers”.',
      'Nothing in your collection fits? Under “Add”, “Create a new recipe with AI” opens recipe creation with the request filled in; after generating, one tap adds the recipe to that meal.',
      '“Suggest with AI” proposes a menu from your Saved recipes, your creations and, if you want, the community. Nothing is added until you accept.',
      '“Copy previous week” repeats last week in the meals that are still empty.',
      '“Build shopping list” gathers the week’s ingredients into a list, for the planned servings.',
      'Done cooking? “I cooked this” on the meal removes what the recipe used from your pantry, except your basics. You can undo it.',
    ],
    despensaTitulo: 'Pantry',
    despensaItens: [
      'In “Planner”, under the “Pantry” tab, list what you have at home: several names at once, separated by commas. No quantities.',
      'The app shows the recipes you can cook now and the ones that are almost there (up to 3 ingredients missing), with what is missing.',
      '“I have the basics” counts your basics (by default salt, water, oil, olive oil and black pepper) as already at home. You can turn it off, and in “Your basics” you can change the list or reset it to the default.',
      '“Add missing items to list” sends only the missing ingredients to your shopping list.',
      '“Add to meal plan” plans the recipe straight from your pantry, on the day and meal you pick.',
      'On your shopping list, “Add checked items to pantry” moves what you bought into your pantry.',
    ],
    comunidadeTitulo: 'Community',
    comunidadeItens: [
      'Follow cooks you like; their recipes show up in “Explore”, under the “Following” tab. The “Cooks” tab helps you find people to follow.',
      'Everyone has a public profile with the recipes they published.',
      'The bell at the top lets you know when someone follows you or rates one of your recipes.',
    ],
    contaTitulo: 'Account and preferences',
    contaItens: [
      'In your account menu (your name, at the top): public profile, edit profile and this guide.',
      'In “Edit profile”, save your dietary restrictions (only you can see them). They come pre-selected when you create a recipe, ask for a menu suggestion and search — and you can change or remove them each time.',
      'In “Edit profile”, under “Your data”, download a copy of your data or delete your account.',
      'In the footer, switch the language (Portuguese or English) and the light or dark theme.',
    ],
  },
} as const
