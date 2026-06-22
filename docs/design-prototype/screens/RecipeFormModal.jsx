/* Refogando — modal de criar/editar receita (sync do protótipo `a660ed26`, 2026-06-22).
   A tela de detalhe fica SÓ-LEITURA (estilo Instagram, #161); a edição da própria
   receita — e a criação estruturada — acontecem aqui, num overlay quase-fullscreen,
   pra a página de detalhe não crescer verticalmente. Espelha o RefoStage:
   modalMode 'new'|'edit', form { title, tempo, visibility, ingredients[], steps[], aiPhoto }.
   Compõe Input, Label, Textarea, ToggleGroup, Button. */
const RDSm = window.RefogandoDesignSystem_b03ee4

/* '3 unidade — ovo' → { qty:'3', unit:'unidade', name:'ovo' }; 'a gosto — sal' → { qty:'a gosto', unit:'', name:'sal' } */
function parseIngredientLine(line) {
  const seg = String(line).split(' — ')
  if (seg.length < 2) return { qty: '', unit: '', name: String(line).trim() }
  const left = seg[0].trim()
  const name = seg.slice(1).join(' — ').trim()
  const m = left.match(/^(\d[\d.,/]*|a gosto)\s*(.*)$/i)
  if (m) return { qty: m[1], unit: (m[2] || '').trim(), name }
  return { qty: '', unit: left, name }
}

function RecipeFormModal({ mode = 'new', recipe = null, onClose, onSave }) {
  const isEdit = mode === 'edit'
  const init = React.useMemo(() => {
    if (isEdit && recipe) {
      return {
        title: recipe.title || '',
        tempo: String(recipe.tempo || ''),
        visibility: recipe.visibilidade || 'privada',
        ingredients: (recipe.ingredientes || []).map(parseIngredientLine),
        steps: [...(recipe.passos || [''])],
        aiPhoto: !!recipe.aiPhoto,
      }
    }
    return {
      title: '', tempo: '', visibility: 'privada',
      ingredients: [{ qty: '', unit: '', name: '' }, { qty: '', unit: '', name: '' }],
      steps: ['', ''], aiPhoto: false,
    }
  }, [isEdit, recipe])

  const [form, setForm] = React.useState(init)
  const [genning, setGenning] = React.useState(false)
  const patch = (p) => setForm((f) => ({ ...f, ...p }))
  const setIng = (i, k, v) => setForm((f) => { const a = [...f.ingredients]; a[i] = { ...a[i], [k]: v }; return { ...f, ingredients: a } })
  const addIng = () => setForm((f) => ({ ...f, ingredients: [...f.ingredients, { qty: '', unit: '', name: '' }] }))
  const rmIng = (i) => setForm((f) => ({ ...f, ingredients: f.ingredients.length > 1 ? f.ingredients.filter((_, j) => j !== i) : f.ingredients }))
  const setStep = (i, v) => setForm((f) => { const a = [...f.steps]; a[i] = v; return { ...f, steps: a } })
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, ''] }))
  const rmStep = (i) => setForm((f) => ({ ...f, steps: f.steps.length > 1 ? f.steps.filter((_, j) => j !== i) : f.steps }))
  const genPhoto = () => { setGenning(true); setTimeout(() => { setGenning(false); patch({ aiPhoto: true }) }, 700) }

  // ESC fecha — paridade com o Sheet/Dialog real do app (#163).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const heading = isEdit ? 'Editar receita' : 'Nova receita'
  const fieldLabel = { fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-muted)' }
  const hint = { fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }
  const removeBtn = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 'var(--text-xl)', lineHeight: 1, padding: '0 0.25rem' }
  const field = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }

  return (
    <div
      role="dialog" aria-modal="true" aria-label={heading}
      onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'var(--space-8) var(--space-4)', overflowY: 'auto',
        background: 'color-mix(in oklch, var(--color-fg) 40%, transparent)', backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        width: 'min(40rem, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)',
      }}>
        {/* Cabeçalho: kicker em versalete + título serifado + X */}
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', padding: 'var(--space-6) var(--space-6) var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-brand-ink)' }}>{heading}</span>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-0.02em', color: 'var(--color-fg)', margin: 0 }}>{heading}</h2>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose} style={{ ...removeBtn, fontSize: '1.5rem' }}>×</button>
        </header>

        {/* Corpo rolável */}
        <div className="rfg-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <div style={field}>
            <RDSm.Label htmlFor="rfm-title">Título</RDSm.Label>
            <RDSm.Input id="rfm-title" value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Ex.: Bolo de fubá com goiabada" />
          </div>

          <div style={field}>
            <RDSm.Label htmlFor="rfm-tempo">Tempo de preparo (minutos)</RDSm.Label>
            <RDSm.Input id="rfm-tempo" type="number" value={form.tempo} onChange={(e) => patch({ tempo: e.target.value })} placeholder="50" />
          </div>

          <RDSm.ToggleGroup
            label="Visibilidade" value={form.visibility} onChange={(v) => patch({ visibility: v })}
            options={[{ key: 'privada', label: 'Privada' }, { key: 'publica', label: 'Pública' }]}
          />

          <div style={field}>
            <span style={fieldLabel}>Foto</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
              <RDSm.Button variant="secondary" size="sm" onClick={genPhoto}>{genning ? 'Gerando foto…' : (form.aiPhoto ? 'Gerar outra com IA' : 'Gerar com IA')}</RDSm.Button>
              <span style={hint}>{form.aiPhoto ? 'Foto gerada por IA — você pode trocar.' : 'Envie uma foto ou gere uma com IA.'}</span>
            </div>
          </div>

          <div style={field}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
              <span style={fieldLabel}>Ingredientes</span>
              <span style={hint}>um por linha · quantidade e unidade</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {form.ingredients.map((ing, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 110px 1fr auto', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <RDSm.Input aria-label="Quantidade" value={ing.qty} onChange={(e) => setIng(i, 'qty', e.target.value)} placeholder="3" />
                  <RDSm.Input aria-label="Unidade" value={ing.unit} onChange={(e) => setIng(i, 'unit', e.target.value)} placeholder="xícaras" />
                  <RDSm.Input aria-label="Ingrediente" value={ing.name} onChange={(e) => setIng(i, 'name', e.target.value)} placeholder="fubá" />
                  <button type="button" aria-label="Remover ingrediente" onClick={() => rmIng(i)} style={removeBtn}>×</button>
                </div>
              ))}
            </div>
            <div><RDSm.Button variant="ghost" size="sm" onClick={addIng}>+ Adicionar ingrediente</RDSm.Button></div>
          </div>

          <div style={field}>
            <span style={fieldLabel}>Modo de preparo</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {form.steps.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 'var(--space-2)', alignItems: 'start' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', paddingTop: '0.5rem' }}>{i + 1}.</span>
                  <RDSm.Textarea aria-label={`Passo ${i + 1}`} rows={2} value={s} onChange={(e) => setStep(i, e.target.value)} placeholder="Um passo por linha" />
                  <button type="button" aria-label="Remover passo" onClick={() => rmStep(i)} style={{ ...removeBtn, paddingTop: '0.5rem' }}>×</button>
                </div>
              ))}
            </div>
            <div><RDSm.Button variant="ghost" size="sm" onClick={addStep}>+ Adicionar passo</RDSm.Button></div>
          </div>
        </div>

        {/* Rodapé fixo: Cancelar + Salvar receita */}
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-6) var(--space-6)', marginTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          <RDSm.Button variant="secondary" onClick={onClose}>Cancelar</RDSm.Button>
          <RDSm.Button onClick={() => onSave && onSave(form)}>Salvar receita</RDSm.Button>
        </footer>
      </div>
    </div>
  )
}

window.RecipeFormModal = RecipeFormModal
