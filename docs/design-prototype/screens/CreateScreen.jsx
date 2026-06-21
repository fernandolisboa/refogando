/* Refogando — Create (#104). Two modes via ToggleGroup: Conversa (chat) and
   Formulário (structured fields → generate). Composes Textarea, Input, Select,
   Checkbox, Button, ToggleGroup. */
const RDSc = window.RefogandoDesignSystem_b03ee4

function Bubble({ who, label, children, mine }) {
  return (
    <div style={{
      alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%',
      borderRadius: 'var(--radius-md)',
      borderBottomRightRadius: mine ? 0 : 'var(--radius-md)',
      borderBottomLeftRadius: mine ? 'var(--radius-md)' : 0,
      border: '1px solid var(--color-border)',
      backgroundColor: mine ? 'var(--color-surface)' : 'var(--color-bg)',
      padding: '0.625rem 1rem',
    }}>
      <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-muted)', margin: 0 }}>{label}</p>
      <p style={{ color: 'var(--color-fg)', margin: '0.125rem 0 0', lineHeight: 'var(--leading-normal)' }}>{children}</p>
    </div>
  )
}

function ConversaMode() {
  const [transcript, setTranscript] = React.useState(window.RefoData.conversation)
  const [input, setInput] = React.useState('')
  const send = () => {
    if (input.trim() === '') return
    setTranscript((t) => [...t, { role: 'user', content: input.trim() }, { role: 'assistant', content: 'Boa! Posso destilar isso numa receita pronta quando você quiser. Quer que eu gere agora?' }])
    setInput('')
  }
  const last = transcript.slice(-2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <p style={{ maxWidth: '60ch', color: 'var(--color-muted)', margin: 0 }}>Converse para chegar na receita. Quando quiser, peça para destilar tudo numa receita pronta.</p>
      <div role="log" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {last.map((m, i) => (
          <Bubble key={i} mine={m.role === 'user'} label={m.role === 'user' ? 'Você' : 'Resposta da IA'}>{m.content}</Bubble>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <RDSc.Label htmlFor="chat">Sua mensagem</RDSc.Label>
        <RDSc.Textarea id="chat" rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="quero um jantar rápido com o que tenho na geladeira…" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <RDSc.Button onClick={send}>Enviar</RDSc.Button>
          <RDSc.Button variant="secondary">Ver transcrição</RDSc.Button>
          <RDSc.Button variant="secondary">Nova conversa</RDSc.Button>
        </div>
      </div>
    </div>
  )
}

function EstruturadoMode() {
  const [restricao, setRestricao] = React.useState(['vegana'])
  const toggle = (v) => setRestricao((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])
  const field = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <p style={{ maxWidth: '60ch', color: 'var(--color-muted)', margin: 0 }}>Monte um pedido por campos e a IA gera a receita.</p>
      <div style={field}>
        <RDSc.Label htmlFor="ing">Ingredientes</RDSc.Label>
        <RDSc.Input id="ing" placeholder="Ex.: 1 cebola grande" />
        <RDSc.Input placeholder="Ex.: 400 g de grão-de-bico" />
        <div><RDSc.Button variant="ghost" size="sm">+ Adicionar ingrediente</RDSc.Button></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
        <div style={field}>
          <RDSc.Label htmlFor="coz">Cozinha</RDSc.Label>
          <RDSc.Select id="coz"><option>Qualquer cozinha</option>{window.RefoData.cozinhas.map((c) => <option key={c}>{c}</option>)}</RDSc.Select>
        </div>
        <div style={field}>
          <RDSc.Label htmlFor="por">Porções</RDSc.Label>
          <RDSc.Input id="por" type="number" defaultValue={4} />
        </div>
        <div style={field}>
          <RDSc.Label htmlFor="dif">Dificuldade (1 a 5)</RDSc.Label>
          <RDSc.Input id="dif" type="number" defaultValue={2} />
        </div>
      </div>
      <div style={field}>
        <RDSc.Label>Restrições alimentares</RDSc.Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {window.RefoData.restricoesFiltro.map((x) => <RDSc.Checkbox key={x} label={x} checked={restricao.includes(x)} onChange={() => toggle(x)} />)}
        </div>
      </div>
      <div style={field}>
        <RDSc.Label htmlFor="obs">Observações</RDSc.Label>
        <RDSc.Textarea id="obs" rows={2} placeholder="Ex.: sem pimenta, bem dourado" />
      </div>
      <div><RDSc.Button size="lg">Gerar receita</RDSc.Button></div>
    </div>
  )
}

function CreateScreen() {
  const [mode, setMode] = React.useState('conversa')
  return (
    <main style={{ maxWidth: '52rem', margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-4xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-0.02em', color: 'var(--color-fg)' }}>Criar receita</h1>
      </div>
      <RDSc.ToggleGroup
        label="Como criar"
        value={mode}
        onChange={setMode}
        options={[{ key: 'conversa', label: 'Conversa' }, { key: 'estruturado', label: 'Formulário' }]}
      />
      {mode === 'conversa' ? <ConversaMode /> : <EstruturadoMode />}
    </main>
  )
}

window.CreateScreen = CreateScreen
