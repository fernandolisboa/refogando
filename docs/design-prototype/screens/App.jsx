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
  const data = window.RefoData

  const openRecipe = (id) => { setRecipeId(id); setRoute('recipe'); window.scrollTo(0, 0) }
  const openAuthor = (h) => { setHandle(h); setRoute('profile'); window.scrollTo(0, 0) }
  const go = (r) => { setRoute(r); window.scrollTo(0, 0) }
  const recipe = data.recipes.find((r) => r.id === recipeId) || data.recipes[0]

  return (
    <React.Fragment>
      <Header route={route} onNavigate={go} authed={true} />
      {route === 'home' && <HomeSearch onOpen={openRecipe} />}
      {route === 'recipes' && <HomeSearch onOpen={openRecipe} />}
      {route === 'recipe' && <RecipeDetail recipe={recipe} onBack={() => go('home')} onAuthor={openAuthor} />}
      {route === 'create' && <CreateScreen />}
      {route === 'mine' && <Profile handle="voce" onOpen={openRecipe} onBack={() => go('home')} />}
      {route === 'profile' && <Profile handle={handle} onOpen={openRecipe} onBack={() => go('home')} />}
      <Footer locale={locale} onLocale={setLocale} />
    </React.Fragment>
  )
}

window.RefoApp = App
