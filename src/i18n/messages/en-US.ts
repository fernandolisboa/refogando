/**
 * Catálogo de chrome em en-US (issue #4). Tipado como `Messages` (= typeof ptBR):
 * o compilador exige as MESMAS chaves do pt-BR; o teste de paridade T3 confirma em runtime.
 */
import type { Categoria, Cozinha, Restricao, Unidade } from '@/domain/vocabulary'
import type { Messages } from './pt-BR'

export const enUS: Messages = {
  app: { name: 'Refogando', tagline: 'Cook up any idea' },
  nav: {
    home: 'Home',
    // #236: the old "Recipes" entry (feed index) merged into the home (Discovery IS the home);
    // key removed as orphaned.
    create: 'Create',
    painel: 'Dashboard',
    signIn: 'Sign in',
    signOut: 'Sign out',
    // Mobile menu (#163): accessible labels for the hamburger trigger and the drawer title.
    abrirMenu: 'Open menu',
    fecharMenu: 'Close menu',
    menu: 'Menu',
    menuDescricao: 'Site navigation and account',
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
    titulo: 'Search recipes',
    placeholder: 'Type a dish, ingredient, or culinary style',
    buscar: 'Search',
    dicaInicial: 'Start typing a dish, ingredient, or style you like — or use the filters.',
    // #116: signed-in users also search their OWN recipes (private ones included).
    dicaInicialLogado: 'Start typing a dish, ingredient, or style — we search your recipes and the community’s.',
    semResultado: 'No recipes found. Try another term or adjust the filters.',
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
    // #160: disclosure trigger that collapses the filters (collapsed by default on the home).
    // `filtrosContagem` shows the number of active facets (cuisine+category+restriction sum);
    // {count} is interpolated in the component via `.replace` (leaves of the type are string).
    filtros: '+ filters',
    filtrosContagem: '+ filters ({count})',
    // Authorship (#129): "by <name>" credit on a pool recipe item, linking /u/<handle>.
    // {name} interpolated in the component via `.replace` (leaves of the type are string).
    porAutor: 'by {name}',
    // "AI-generated" seal (#132, ADR-0017) — over ai_generated images on cards and detail.
    // The Claude Design prototype uses ✨ on this seal (RefoStage "Minhas criações"/Search).
    imagemSeloIa: '✨ AI-generated',
    // #166: PERMANENT "Generate with AI" CTA — always visible on Search (with and without
    // results), since generating is the heart of the app. It does NOT auto-fire: it links to
    // /create?q=<term> pre-filling the free-text. Guests see the sign-in invite (reuses
    // `minhasCriacoes.convidaEntrar*`).
    gerarComIa: 'Generate with AI',
    // #164: SEPARATE section of web links (ADR-0019) — appears ONLY when our own collection came back
    // SHALLOW. These are EXTERNAL links, marked "from the web", NOT stored nor ranked (Search only
    // finds). `daWebFonte` credits the source ("from the web · {fonte}"); {fonte} interpolated in the
    // component via `.replace`.
    secaoDaWeb: 'From the web',
    daWebDescricao: "We didn't find this in our collection yet. These are external links — they open on the source site.",
    daWebFonte: 'from the web · {fonte}',
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
    importarErroGenerico: "We couldn't import right now. Try again or open it on the source site.",
    importarConviteTitulo: 'Sign in to import',
    importarConviteTexto: 'Create an account or sign in to import recipes from the web to your profile.',
  },
  // Feed da Descoberta-home (#103/#236), mesma substância traduzida (ADR-0001). Reusa `busca.*`
  // para o chrome compartilhado; só os textos próprios do feed vivem aqui. `titulo`/`subtituloLogado`
  // saíram com a fusão (#236): o `<h1>` é o da Busca e o feed de repouso é sempre o pool público anônimo.
  feed: {
    subtitulo: 'What the community is cooking up, newest first.',
    vazio: 'No recipes here yet.',
    carregarMais: 'Load more',
    fim: "You've reached the end.",
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
  // Rótulo amigável por valor do enum COZINHAS (#56), traduzido por locale.
  cozinhaLabel: {
    italiana: 'Italian',
    japonesa: 'Japanese',
    brasileira: 'Brazilian',
    baiana: 'Bahian',
    mineira: 'Minas Gerais',
    mexicana: 'Mexican',
    chinesa: 'Chinese',
    indiana: 'Indian',
    tailandesa: 'Thai',
    francesa: 'French',
    arabe: 'Arabic',
    portuguesa: 'Portuguese',
    mediterranea: 'Mediterranean',
    peruana: 'Peruvian',
  } satisfies Record<Cozinha, string>,
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
  // Página de detalhe da Receita (#57), mesma substância traduzida (ADR-0001, não
  // byte-idêntica). Selos de proveniência REUSAM busca.seloCatalogo/seloComunidade.
  detalhe: {
    ingredientes: 'Ingredients',
    passos: 'Steps',
    notas: 'Notes',
    descricao: 'Description',
    porcoes: 'Servings',
    dificuldade: 'Difficulty',
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
    // Back link at the top of the detail (#57) → "/" (home IS search).
    voltarBusca: 'Back to search',
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
    imagemGerarErro: "We couldn't generate the image. Try again.",
    // #134: generation turned off by the admin (UI hides the button; covers the toggle-off race).
    imagemGerarDesabilitada: 'AI image generation is currently disabled.',
    // 24h SLIDING window (not "today"/calendar day): window-neutral copy.
    imagemLimite: "You've hit the generation limit for now. Frees up in ~{tempo}.",
    // Image studio (#222, ADR-0022): preview modal + re-selectable gallery.
    imagemSeloIa: '✨ AI-generated',
    imagemPreviewTitulo: 'Generate image with AI',
    imagemPreviewDescricao: 'Preview the generated image before using it. Generating another keeps the previous ones in the gallery.',
    imagemUsarEsta: 'Use this one',
    imagemGerarOutra: 'Generate another',
    imagemFechar: 'Close',
    imagemGaleria: 'Image gallery',
    imagemGaleriaVazia: 'No images yet. Generate one with AI or upload your own photo.',
    imagemSelecionar: 'Use this one',
    imagemSelecionada: 'In use',
    imagemApagar: 'Delete',
    // 409 in_use: the image is still a version's face — deselect it before deleting.
    imagemApagarEmUso: 'This image is in use by a version. Pick another one before deleting it.',
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
    ingredientePlaceholder: 'e.g., 1 large onion',
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
      "This recipe is public. Your changes will be visible to anyone who favorited it or is viewing it in the community.",
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
  },
  comunidade: {
    titulo: 'Community',
    votar: 'Vote',
    votado: 'Voted',
    votos: '{n} votes',
    voto: '{n} vote',
    favoritar: 'Favorite',
    favoritado: 'Favorited',
    ordenarPor: 'Sort the Community by',
    toggleRelevancia: 'Relevance',
    togglePopularidade: 'Popularity',
    convidaEntrarVoto: 'Sign in to vote',
    convidaEntrarFavorito: 'Sign in to favorite',
    erroVoto: 'Could not vote. Try again.',
    erroFavorito: 'Could not favorite. Try again.',
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
    userIdLabel: 'User ID',
    userIdPlaceholder: 'Paste the user ID',
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
    navConfig: 'Default model',
    navPapeis: 'Roles',
    navModeracao: 'Moderation',
    navTraducoes: 'Translations',
    navCatalogo: 'Catalog',
    navAi: 'Image generation',
    // /admin/ai section (#134) — toggle AI image generation, model and per-role daily caps.
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
    erroPapelInvalido: 'Invalid role.',
    erroNaoAplicado: 'Could not apply the role. Check the ID.',
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
  },
} as const
