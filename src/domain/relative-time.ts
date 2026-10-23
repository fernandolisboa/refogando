/**
 * Datas para a interface: tempo relativo curto ("agora", "há 3 horas", "há 2 dias") para o que aconteceu na
 * última semana e, daí para trás, a data. Usado pela lista de usuários do Console (#598) e pelas notificações do
 * sininho. PURO: `now` e `locale` entram por parâmetro; quem chama decide quando ler o relógio (sempre no cliente,
 * depois da hidratação, para o texto não divergir do SSR).
 */

const MINUTO = 60
const HORA = 60 * MINUTO
const DIA = 24 * HORA
const SEMANA = 7 * DIA

/**
 * Tempo relativo até uma semana; acima disso, a data (`formatDate`). As unidades são TRUNCADAS ("há 2 dias" quer
 * dizer pelo menos 2 dias; 59 min 40 s ainda é "há 59 minutos", nunca "há 60 minutos"). Um instante no futuro
 * (relógio do aparelho atrasado em relação ao servidor) vira "agora": tudo que passa por aqui já aconteceu.
 * Data inválida ⇒ "" (as três funções): o `Intl` lançaria `RangeError` e derrubaria a tela por causa de um rótulo.
 */
export function formatRelativeTime(iso: string, now: number, locale: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const passados = Math.max(0, Math.floor((now - t) / 1000))
  if (passados < MINUTO) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
  if (passados >= SEMANA) return formatDate(iso, locale)
  // `numeric: 'always'`: "há 1 dia", não "ontem" (25 h atrás pode ser anteontem no calendário).
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  if (passados < HORA) return rtf.format(-Math.floor(passados / MINUTO), 'minute')
  if (passados < DIA) return rtf.format(-Math.floor(passados / HORA), 'hour')
  return rtf.format(-Math.floor(passados / DIA), 'day')
}

export function formatDate(iso: string, locale: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function formatDateTime(iso: string, locale: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}
