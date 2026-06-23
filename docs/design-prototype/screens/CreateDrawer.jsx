/* Refogando — drawer "Nova receita" (sync do protótipo `a660ed26`,
   `Refogando - Drawer Nova Receita.dc.html`, 2026-06-22).
   Reorganiza a CRIAÇÃO POR IA num drawer da direita + wizard, pra despoluir a
   tela /create. NÃO é autoria manual — os 3 caminhos mapeiam aos modos que já
   existem: Formulário estruturado → ai_structured, Prompt aberto → ai_free_text,
   Conversa → ai_chat. Nenhuma proveniência nova.

   Fluxo: escolher caminho → (estruturado: 3 passos Ingredientes/Cozinha/Detalhes;
   prompt: textarea; conversa: chat) → gerando → gerada (Abrir receita / Criar outra).
   Supersede o screens/CreateScreen.jsx centralizado. */
const RDSdr = window.RefogandoDesignSystem_b03ee4 // (reservado; o drawer usa estilos inline pra fidelidade)

const COZINHA_OPTS = ['Brasileira', 'Italiana', 'Indiana', 'Baiana', 'Mineira', 'Japonesa', 'Árabe', 'Mexicana']
const RESTR_OPTS = ['Vegetariana', 'Vegana', 'Sem glúten', 'Sem lactose', 'Low carb', 'Sem açúcar']
const STEP_NAMES = ['Ingredientes', 'Cozinha', 'Detalhes']

function CreateDrawer({ open, onClose }) {
  const blank = () => ({
    method: null, step: 0, ingMode: 'guided', ings: [{ qty: '', unit: '', name: '' }], cur: 0,
    bulkText: '', cozinha: null, restricoes: [], porcoes: 4, dificuldade: 'Fácil', obs: '',
    promptText: '', chat: [{ role: 'ai', text: 'Oi! Me conta o que você tem ou que tipo de prato quer fazer.' }],
    chatInput: '', generating: false, generated: false,
  })
  const [s, setS] = React.useState(blank)
  const patch = (p) => setS((x) => ({ ...x, ...p }))
  // Reabrir reseta o wizard (paridade com openDrawer/criarOutra do protótipo).
  React.useEffect(() => { if (open) setS(blank()) }, [open])
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && open && onClose) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const isMethod = s.method === null
  const isStruct = s.method === 'estruturado'
  const isPrompt = s.method === 'prompt'
  const isConversa = s.method === 'conversa'
  const showStruct = isStruct && !s.generated && !s.generating

  const back = () => setS((x) => {
    if (x.generated || x.generating) return blank()
    if (x.method === 'estruturado' && x.step > 0) return { ...x, step: x.step - 1 }
    return { ...x, method: null, step: 0 }
  })
  const generate = () => { patch({ generating: true }); setTimeout(() => patch({ generating: false, generated: true }), 900) }
  const setIngField = (k) => (e) => { const v = e.target.value; setS((x) => ({ ...x, ings: x.ings.map((g, j) => (j === x.cur ? { ...g, [k]: v } : g)) })) }
  const addNext = () => setS((x) => ({ ...x, ings: [...x.ings, { qty: '', unit: '', name: '' }], cur: x.ings.length }))
  const removeCur = () => setS((x) => { if (x.ings.length <= 1) return { ...x, ings: [{ qty: '', unit: '', name: '' }], cur: 0 }; const ings = x.ings.filter((_, j) => j !== x.cur); return { ...x, ings, cur: Math.min(x.cur, ings.length - 1) } })
  const toggleRestr = (k) => setS((x) => ({ ...x, restricoes: x.restricoes.includes(k) ? x.restricoes.filter((r) => r !== k) : [...x.restricoes, k] }))
  const sendChat = () => setS((x) => {
    const t = (x.chatInput || '').trim(); if (!t) return x
    const replies = ['Boa! Posso usar alho-poró no lugar pra adoçar sem cebola. Faço pra quantas porções?', 'Fechado. Quer mais cremoso ou mais sequinho?', 'Anotado. Quando quiser, é só pedir pra eu destilar tudo numa receita pronta.']
    const n = x.chat.filter((m) => m.role === 'me').length
    return { ...x, chat: [...x.chat, { role: 'me', text: t }, { role: 'ai', text: replies[Math.min(n, replies.length - 1)] }], chatInput: '' }
  })

  // estilos compartilhados (px do protótipo + tokens var() pra cor/fonte)
  const seg = (a) => ({ flex: 1, textAlign: 'center', borderRadius: '7px', padding: '7px 12px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: a ? 600 : 400, background: a ? 'var(--color-brand-strong)' : 'transparent', color: a ? 'var(--color-on-brand)' : 'var(--color-muted)' })
  const chip = (a) => ({ fontSize: '0.82rem', borderRadius: 'var(--radius-full)', padding: '7px 14px', cursor: 'pointer', border: `1px solid ${a ? 'var(--color-brand-strong)' : 'var(--color-border)'}`, background: a ? 'var(--color-brand-strong)' : 'transparent', color: a ? 'var(--color-on-brand)' : 'var(--color-muted)', fontWeight: a ? 600 : 400 })
  const inputStyle = { border: '1px solid var(--color-border)', background: 'var(--color-bg)', borderRadius: '9px', padding: '9px 10px', fontSize: '0.86rem', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.18rem', fontWeight: 600, marginBottom: '3px' }
  const ghostBtn = { fontSize: '0.88rem', fontWeight: 500, color: 'var(--color-fg)', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '11px 18px', cursor: 'pointer' }
  const primaryBtn = { fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-on-brand)', background: 'var(--color-brand-strong)', border: 0, borderRadius: '10px', padding: '11px 22px', cursor: 'pointer' }

  const cur = Math.min(s.cur, s.ings.length - 1)
  const curIng = s.ings[cur] || { qty: '', unit: '', name: '' }
  const filledCount = s.ings.filter((g) => g.name && g.name.trim()).length
  const headerTitle = s.generated ? 'Receita pronta' : isMethod ? 'Como você quer criar?' : isStruct ? 'Formulário estruturado' : isPrompt ? 'Prompt aberto' : 'Conversa'
  const hasBack = !isMethod && !s.generated
  const showFooter = !isMethod && !s.generating

  // CTA primária do rodapé
  let primaryLabel = '', primaryAction = null
  if (showStruct) { if (s.step < 2) { primaryLabel = 'Continuar'; primaryAction = () => patch({ step: s.step + 1 }) } else { primaryLabel = 'Gerar receita'; primaryAction = generate } }
  else if (isPrompt && !s.generated) { primaryLabel = 'Gerar receita'; primaryAction = generate }
  else if (isConversa && !s.generated) { primaryLabel = 'Destilar receita'; primaryAction = generate }

  const methodCards = [
    { key: 'estruturado', title: 'Formulário estruturado', desc: 'Monte por campos — ingredientes, cozinha, restrições. A IA preenche o resto.' },
    { key: 'prompt', title: 'Prompt aberto', desc: 'Descreva o prato de uma vez e gere na hora. Sem idas e vindas.' },
    { key: 'conversa', title: 'Conversa', desc: 'Converse com a IA até a receita ficar do seu jeito.' },
  ]

  return (
    <React.Fragment>
      {/* scrim */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'color-mix(in oklch, oklch(0.18 0.02 55) 46%, transparent)', transition: 'opacity 220ms cubic-bezier(0.22,1,0.36,1)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} />
      {/* drawer */}
      <div role="dialog" aria-modal="true" aria-label="Nova receita"
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 110, width: 'min(468px, 100%)', background: 'var(--color-bg)', borderLeft: '1px solid var(--color-border)', boxShadow: '-18px 0 48px -24px rgb(56 40 24 / 0.45)', display: 'flex', flexDirection: 'column', transition: 'transform 240ms cubic-bezier(0.22,1,0.36,1)', transform: open ? 'translateX(0)' : 'translateX(112%)' }}>

        {/* header */}
        <div style={{ flex: 'none', padding: '18px 22px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {hasBack && <button type="button" aria-label="Voltar" onClick={back} style={{ flex: 'none', width: '32px', height: '32px', borderRadius: '9px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-fg)' }}>‹</button>}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '0.64rem', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--color-brand-ink)' }}>Nova receita</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.32rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{headerTitle}</span>
            </div>
            <button type="button" aria-label="Fechar" onClick={onClose} style={{ flex: 'none', width: '32px', height: '32px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-muted)' }}>×</button>
          </div>
          {showStruct && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '16px' }}>
              {STEP_NAMES.map((t, i) => (
                <React.Fragment key={t}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: i === s.step ? undefined : 'none' }}>
                    <span style={{ flex: 'none', width: '22px', height: '22px', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'var(--font-display)', background: i === s.step ? 'var(--color-brand-strong)' : i < s.step ? 'color-mix(in oklch, var(--color-brand) 18%, transparent)' : 'var(--color-surface)', color: i === s.step ? 'var(--color-on-brand)' : i < s.step ? 'var(--color-brand-ink)' : 'var(--color-muted)', border: i > s.step ? '1px solid var(--color-border)' : undefined }}>{i + 1}</span>
                    <span style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', color: i === s.step ? 'var(--color-fg)' : 'var(--color-muted)', fontWeight: i === s.step ? 600 : 400 }}>{t}</span>
                  </div>
                  {i < 2 && <span style={{ flex: 1, height: '1px', background: 'var(--color-border)', minWidth: '10px' }} />}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* body */}
        <div className="rfg-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px' }}>
          {/* método */}
          {isMethod && !s.generated && !s.generating && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '0.94rem', lineHeight: 1.5, color: 'var(--color-muted)', margin: '0 0 2px' }}>Como você quer chegar na sua receita? Dá pra montar por campos, descrever de uma vez ou conversar.</p>
              {methodCards.map((c) => (
                <div key={c.key} onClick={() => patch({ method: c.key, step: 0 })} style={{ display: 'flex', alignItems: 'center', gap: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: '13px', padding: '16px', cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.08rem', fontWeight: 600, letterSpacing: '-0.01em' }}>{c.title}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', marginTop: '2px', lineHeight: 1.4 }}>{c.desc}</div>
                  </div>
                  <span style={{ flex: 'none', color: 'var(--color-muted)' }}>›</span>
                </div>
              ))}
            </div>
          )}

          {/* estruturado · passo 1 — ingredientes */}
          {showStruct && s.step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={sectionTitle}>Ingredientes</div>
                <p style={{ fontSize: '0.86rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.45 }}>Liste tudo de uma vez ou adicione um a um — você pode voltar e ajustar qualquer item.</p>
              </div>
              <div style={{ display: 'flex', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3px', gap: '3px' }}>
                <span onClick={() => patch({ ingMode: 'guided' })} style={seg(s.ingMode === 'guided')}>Um a um</span>
                <span onClick={() => patch({ ingMode: 'bulk' })} style={seg(s.ingMode === 'bulk')}>De uma vez</span>
              </div>
              {s.ingMode === 'guided' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    {s.ings.map((g, i) => (
                      <span key={i} onClick={() => patch({ cur: i })} style={{ flex: 'none', minWidth: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-display)', cursor: 'pointer', padding: '0 6px', background: i === cur ? 'var(--color-brand-strong)' : g.name && g.name.trim() ? 'color-mix(in oklch, var(--color-brand) 12%, transparent)' : 'var(--color-bg)', color: i === cur ? 'var(--color-on-brand)' : g.name && g.name.trim() ? 'var(--color-brand-ink)' : 'var(--color-muted)', border: `1px solid ${i === cur ? 'var(--color-brand-strong)' : 'var(--color-border)'}` }}>{i + 1}</span>
                    ))}
                    <span onClick={addNext} style={{ flex: 'none', minWidth: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-brand-ink)', border: '1px dashed var(--color-brand)', fontSize: '1.05rem', lineHeight: 1 }}>+</span>
                  </div>
                  <div style={{ border: '1px solid var(--color-brand-strong)', background: 'var(--color-surface)', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span onClick={() => patch({ cur: Math.max(0, cur - 1) })} style={{ flex: 'none', width: '30px', height: '30px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-fg)', opacity: cur === 0 ? 0.4 : 1, pointerEvents: cur === 0 ? 'none' : 'auto' }}>‹</span>
                      <span style={{ flex: 1, textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-brand-ink)' }}>{`Ingrediente ${cur + 1} de ${s.ings.length}`}</span>
                      <span onClick={() => patch({ cur: Math.min(s.ings.length - 1, cur + 1) })} style={{ flex: 'none', width: '30px', height: '30px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-fg)', opacity: cur >= s.ings.length - 1 ? 0.4 : 1, pointerEvents: cur >= s.ings.length - 1 ? 'none' : 'auto' }}>›</span>
                      {s.ings.length > 1 && <span onClick={removeCur} aria-label="Remover ingrediente" style={{ flex: 'none', width: '30px', height: '30px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-muted)' }}>×</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '8px' }}>
                      <input value={curIng.qty} onChange={setIngField('qty')} placeholder="Qtd" style={inputStyle} />
                      <input value={curIng.unit} onChange={setIngField('unit')} placeholder="Unidade (g, xícara, dente…)" style={inputStyle} />
                    </div>
                    <input value={curIng.name} onChange={setIngField('name')} placeholder="Ingrediente — ex.: cebola roxa" style={inputStyle} />
                  </div>
                  <span onClick={addNext} style={{ alignSelf: 'flex-start', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', borderRadius: '9px', padding: '8px 14px', background: 'var(--color-brand-strong)', color: 'var(--color-on-brand)' }}>+ Adicionar outro</span>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>{filledCount ? `${filledCount} ${filledCount === 1 ? 'ingrediente preenchido' : 'ingredientes preenchidos'} · use ‹ › ou os números pra revisitar` : 'Preencha o primeiro e clique em "Adicionar outro".'}</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <textarea value={s.bulkText} onChange={(e) => patch({ bulkText: e.target.value })} placeholder="Um ingrediente por linha ou separados por vírgula&#10;Ex.: 2 xícaras de fubá, 1 cebola, 200 g de goiabada" style={{ ...inputStyle, background: 'var(--color-surface)', borderRadius: '11px', padding: '12px 13px', fontSize: '0.9rem', minHeight: '170px', resize: 'vertical', lineHeight: 1.6 }} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>Um ingrediente por linha ou separados por vírgula — a IA separa quantidade, unidade e item.</span>
                </div>
              )}
            </div>
          )}

          {/* estruturado · passo 2 — cozinha & restrições */}
          {showStruct && s.step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <div>
                <div style={{ ...sectionTitle, marginBottom: '8px' }}>Cozinha</div>
                <p style={{ fontSize: '0.84rem', color: 'var(--color-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>De onde vem o tempero? Opcional.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {COZINHA_OPTS.map((o) => <span key={o} onClick={() => patch({ cozinha: s.cozinha === o ? null : o })} style={chip(s.cozinha === o)}>{o}</span>)}
                </div>
              </div>
              <div>
                <div style={{ ...sectionTitle, marginBottom: '8px' }}>Restrições alimentares</div>
                <p style={{ fontSize: '0.84rem', color: 'var(--color-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>Marque o que a receita precisa respeitar. Declarado, não verificado.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {RESTR_OPTS.map((o) => <span key={o} onClick={() => toggleRestr(o)} style={chip(s.restricoes.includes(o))}>{o}</span>)}
                </div>
              </div>
            </div>
          )}

          {/* estruturado · passo 3 — detalhes */}
          {showStruct && s.step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, marginBottom: '10px' }}>Porções</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span onClick={() => patch({ porcoes: Math.max(1, s.porcoes - 1) })} style={{ width: '38px', height: '38px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--color-fg)' }}>−</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, minWidth: '32px', textAlign: 'center' }}>{s.porcoes}</span>
                  <span onClick={() => patch({ porcoes: Math.min(20, s.porcoes + 1) })} style={{ width: '38px', height: '38px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--color-fg)' }}>+</span>
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, marginBottom: '10px' }}>Dificuldade</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {['Fácil', 'Médio', 'Difícil'].map((o) => <span key={o} onClick={() => patch({ dificuldade: o })} style={chip(s.dificuldade === o)}>{o}</span>)}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, marginBottom: '10px' }}>Observações</div>
                <textarea value={s.obs} onChange={(e) => patch({ obs: e.target.value })} placeholder="Algo a mais? Ex.: sem pimenta, rende bem congelado, ponto bem cremoso…" style={{ ...inputStyle, background: 'var(--color-surface)', borderRadius: '11px', padding: '12px 13px', fontSize: '0.9rem', minHeight: '96px', resize: 'vertical', lineHeight: 1.55 }} />
              </div>
            </div>
          )}

          {/* prompt aberto */}
          {isPrompt && !s.generated && !s.generating && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '0.92rem', lineHeight: 1.5, color: 'var(--color-muted)', margin: 0 }}>Descreva o prato com suas palavras. A IA gera uma receita completa de uma vez — sem idas e vindas.</p>
              <textarea value={s.promptText} onChange={(e) => patch({ promptText: e.target.value })} placeholder="Ex.: um jantar rápido de frigideira com ovo, abobrinha e queijo, sem cebola, pra 2 pessoas" style={{ ...inputStyle, background: 'var(--color-surface)', borderRadius: '12px', padding: '14px', fontSize: '0.95rem', minHeight: '200px', resize: 'vertical', lineHeight: 1.6 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)', alignSelf: 'center' }}>Sugestões:</span>
                {['Jantar rápido', 'Vegano', 'Sobremesa de domingo'].map((o) => <span key={o} onClick={() => patch({ promptText: (s.promptText ? s.promptText + ' ' : '') + o.toLowerCase() })} style={{ fontSize: '0.8rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-fg)', borderRadius: 'var(--radius-full)', padding: '5px 12px', cursor: 'pointer' }}>{o}</span>)}
              </div>
            </div>
          )}

          {/* conversa */}
          {isConversa && !s.generated && !s.generating && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--color-muted)', margin: 0 }}>Converse para chegar na receita. Quando quiser, peça para destilar tudo numa receita pronta.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {s.chat.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '84%', alignSelf: m.role === 'me' ? 'flex-end' : 'flex-start', alignItems: m.role === 'me' ? 'flex-end' : 'flex-start' }}>
                    <span style={{ fontSize: '0.64rem', color: 'var(--color-muted)' }}>{m.role === 'me' ? 'Você' : 'IA'}</span>
                    <div style={{ padding: '10px 13px', fontSize: '0.88rem', lineHeight: 1.5, background: m.role === 'me' ? 'color-mix(in oklch, var(--color-brand) 14%, var(--color-bg))' : 'var(--color-surface)', border: `1px solid ${m.role === 'me' ? 'color-mix(in oklch, var(--color-brand) 30%, transparent)' : 'var(--color-border)'}`, borderRadius: m.role === 'me' ? '14px 14px 4px 14px' : '14px 14px 14px 4px' }}>{m.text}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '4px' }}>
                <input value={s.chatInput} onChange={(e) => patch({ chatInput: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat() } }} placeholder="Escreva uma mensagem…" style={{ ...inputStyle, flex: 1, background: 'var(--color-surface)', borderRadius: '10px', padding: '11px 13px', fontSize: '0.9rem' }} />
                <span onClick={sendChat} style={{ ...ghostBtn, flex: 'none', background: 'var(--color-surface)', padding: '11px 16px' }}>Enviar</span>
              </div>
            </div>
          )}

          {/* gerando */}
          {s.generating && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '80px 20px', textAlign: 'center' }}>
              <span style={{ width: '42px', height: '42px', borderRadius: 'var(--radius-full)', border: '3px solid var(--color-border)', borderTopColor: 'var(--color-brand-strong)', animation: 'rfgspin 0.8s linear infinite' }} />
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600 }}>Refogando sua receita…</div>
              <div style={{ fontSize: '0.86rem', color: 'var(--color-muted)', maxWidth: '30ch', lineHeight: 1.45 }}>Juntando ingredientes, ajustando quantidades e escrevendo o preparo.</div>
            </div>
          )}

          {/* gerada */}
          {s.generated && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-brand-ink)' }}>Gerada pela IA · sua receita</span>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.08 }}>Refogado de abobrinha com alho-poró</h3>
                <p style={{ fontSize: '0.92rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.5 }}>Dourado por fora, cremoso por dentro — pronto em 20 minutos, sem cebola.</p>
              </div>
              <div style={{ display: 'flex', gap: '18px', fontSize: '0.84rem', color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', padding: '11px 0' }}>
                <span><span style={{ color: 'var(--color-fg)', fontWeight: 500 }}>{s.porcoes}</span> porções</span>
                <span style={{ color: 'var(--color-fg)', fontWeight: 500 }}>{s.dificuldade}</span>
                <span style={{ color: 'var(--color-fg)', fontWeight: 500 }}>{s.cozinha || 'Brasileira'}</span>
              </div>
              {s.restricoes.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                  {s.restricoes.map((r) => <span key={r} style={{ fontSize: '0.76rem', border: '1px solid var(--color-brand)', color: 'var(--color-brand-ink)', background: 'color-mix(in oklch, var(--color-brand) 9%, transparent)', borderRadius: 'var(--radius-full)', padding: '4px 11px' }}>{r}</span>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        {showFooter && (
          <div style={{ flex: 'none', padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {hasBack && <span onClick={back} style={ghostBtn}>Voltar</span>}
            <span style={{ flex: 1 }} />
            {s.generated ? (
              <React.Fragment>
                <span onClick={() => setS(blank())} style={{ ...ghostBtn, background: 'var(--color-surface)' }}>Criar outra</span>
                <span onClick={onClose} style={primaryBtn}>Abrir receita</span>
              </React.Fragment>
            ) : (
              primaryAction && <span onClick={primaryAction} style={primaryBtn}>{primaryLabel}</span>
            )}
          </div>
        )}
      </div>
    </React.Fragment>
  )
}

window.CreateDrawer = CreateDrawer
