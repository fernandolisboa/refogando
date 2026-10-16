/**
 * Leitura PURA de um ID de modelo da Anthropic no formato atual: `claude-<família>-<maior>[-<menor>]`,
 * com sufixo de data opcional (`claude-haiku-4-5-20251001`). Usado para comparar versões dentro da mesma
 * família (ADR-0046) quando a Models API não lista o modelo em uso. Formato fora disso ⇒ `null`.
 */
export type ModelIdParts = { family: string; major: number; minor: number }

const ID_RE = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/

export function parseModelId(id: string): ModelIdParts | null {
  const m = ID_RE.exec(id)
  if (!m) return null
  return { family: m[1], major: Number(m[2]), minor: m[3] === undefined ? 0 : Number(m[3]) }
}

/** `a` é de versão estritamente maior que `b` na mesma família? Formato desconhecido ⇒ `false`. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = parseModelId(a)
  const pb = parseModelId(b)
  if (!pa || !pb || pa.family !== pb.family) return false
  return pa.major !== pb.major ? pa.major > pb.major : pa.minor > pb.minor
}

/** A versão do ID é pelo menos `major.minor` na família dada? */
export function atLeastVersion(id: string, family: string, major: number, minor: number): boolean {
  const p = parseModelId(id)
  if (!p || p.family !== family) return false
  return p.major !== major ? p.major > major : p.minor >= minor
}
