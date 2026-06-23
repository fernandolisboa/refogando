/* Refogando UI kit — app shell. Ties the screens together with simple routing.
   This is a recreation of the live product flow: search → recipe → create →
   profile, with the sticky header throughout. */

function App() {
  const [route, setRoute] = React.useState('home')
  const [recipeId, setRecipeId] = React.useState(null)
  const [handle, setHandle] = React.useState('ana')
  // #162: o seletor de idioma vive no footer; o estado de locale sobe pro shell pra
  // header e footer compartilharem (a chrome inteira acompanha a troca).
  const [locale, setLocale] = React.useState('pt-BR')
  // Sync 2026-06-22: editar/criar acontecem num MODAL quase-fullscreen (overlay), não
  // inline na tela de detalhe — assim o detalhe fica só-leitura e curto. `modal` é
  // null | { mode:'edit'|'new', recipe }.
  const [modal, setModal] = React.useState(null)
  // Sync 2026-06-22: "Criar" abre um DRAWER da direita (wizard de geração por IA),
  // que supersede a tela /create centralizada (screens/CreateScreen.jsx).
  const [createOpen, setCreateOpen] = React.useState(false)
  const data = window.RefoData

  const openRecipe = (id) => { setRecipeId(id); setRoute('recipe'); window.scrollTo(0, 0) }
  const openAuthor = (h) => { setHandle(h); setRoute('profile'); window.scrollTo(0, 0) }
  // "Criar" não navega: abre o drawer por cima da tela atual (mantém o contexto atrás).
  const go = (r) => { if (r === 'create') { setCreateOpen(true); return } setRoute(r); window.scrollTo(0, 0) }
  const recipe = data.recipes.find((r) => r.id === recipeId) || data.recipes[0]
  const openEdit = (r) => setModal({ mode: 'edit', recipe: r }) // sua receita → prefilled
  const openDerive = () => setModal({ mode: 'new', recipe: null }) // "Criar minha versão" → form em branco
  const closeModal = () => setModal(null)

  return (
    <React.Fragment>
      <Header route={route} onNavigate={go} authed={true} />
      {route === 'home' && <HomeSearch onOpen={openRecipe} />}
      {route === 'recipes' && <HomeSearch onOpen={openRecipe} />}
      {route === 'recipe' && <RecipeDetail recipe={recipe} onBack={() => go('home')} onAuthor={openAuthor} onEdit={() => openEdit(recipe)} onDerive={openDerive} />}
      {route === 'mine' && <Profile handle="voce" onOpen={openRecipe} onBack={() => go('home')} />}
      {route === 'profile' && <Profile handle={handle} onOpen={openRecipe} onBack={() => go('home')} />}
      <Footer locale={locale} onLocale={setLocale} />
      {/* Editar = modal centralizado; Criar = drawer da direita (wizard de geração por IA). */}
      {modal && <RecipeFormModal mode={modal.mode} recipe={modal.recipe} onClose={closeModal} onSave={closeModal} />}
      <CreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </React.Fragment>
  )
}

window.RefoApp = App
