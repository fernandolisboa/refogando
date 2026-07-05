import { describe, expect, it } from 'vitest'
import {
  fingerprintSource,
  fingerprintMt,
  type SourceFingerprintInput,
  type MtFingerprintInput,
} from '@/domain/translation-fingerprint'

// Fingerprints de conteúdo (#496, ADR-0031). A segurança da re-tradução (pull) depende de a MESMA
// entrada produzir SEMPRE o mesmo hash e de QUALQUER mudança de conteúdo mudar o hash — testado
// byte-a-byte aqui (o caminho de banco não é unit-testável). sha256 hex = 64 chars.

const baseSource: SourceFingerprintInput = {
  titulo: 'Feijoada',
  descricao: 'Um ensopado.',
  passos: ['Refogue', 'Cozinhe'],
  notas: 'Sirva com arroz.',
  ingredientes: [
    { ordem: 0, nome: 'feijão preto' },
    { ordem: 1, nome: 'linguiça' },
  ],
}

const baseMt: MtFingerprintInput = {
  titulo: 'Feijoada',
  descricao: 'A stew.',
  passos: ['Sauté', 'Simmer'],
  notas: 'Serve with rice.',
  ingredientes: [
    { ordem: 0, nome: 'black beans' },
    { ordem: 1, nome: 'sausage' },
  ],
}

describe('fingerprintSource (#496)', () => {
  it('é determinístico: mesma entrada → mesmo hash sha256 hex', () => {
    const a = fingerprintSource(baseSource)
    const b = fingerprintSource({ ...baseSource, ingredientes: [...baseSource.ingredientes!] })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('muda quando QUALQUER campo traduzível muda', () => {
    const h = fingerprintSource(baseSource)
    expect(fingerprintSource({ ...baseSource, titulo: 'Feijoada light' })).not.toBe(h)
    expect(fingerprintSource({ ...baseSource, descricao: 'Outro.' })).not.toBe(h)
    expect(fingerprintSource({ ...baseSource, passos: ['Refogue'] })).not.toBe(h)
    expect(fingerprintSource({ ...baseSource, notas: null })).not.toBe(h)
  })

  it('muda quando um raw_text de ingrediente muda (renomear dispara re-tradução)', () => {
    const h = fingerprintSource(baseSource)
    const renamed = fingerprintSource({
      ...baseSource,
      ingredientes: [
        { ordem: 0, nome: 'feijão carioca' },
        { ordem: 1, nome: 'linguiça' },
      ],
    })
    expect(renamed).not.toBe(h)
  })

  it('é estável quanto à ORDEM do array (ordenado por `ordem`), mas sensível ao pareamento ordem→nome', () => {
    const forward = fingerprintSource(baseSource)
    const reversedArray = fingerprintSource({
      ...baseSource,
      ingredientes: [
        { ordem: 1, nome: 'linguiça' },
        { ordem: 0, nome: 'feijão preto' },
      ],
    })
    expect(reversedArray).toBe(forward) // só a ordem do array mudou, não o pareamento
    const swappedNames = fingerprintSource({
      ...baseSource,
      ingredientes: [
        { ordem: 0, nome: 'linguiça' },
        { ordem: 1, nome: 'feijão preto' },
      ],
    })
    expect(swappedNames).not.toBe(forward) // trocar qual nome está em qual `ordem` MUDA
  })

  it('distingue null de string vazia e de lista de ingredientes ausente', () => {
    expect(fingerprintSource({ ...baseSource, notas: null })).not.toBe(
      fingerprintSource({ ...baseSource, notas: '' }),
    )
    expect(fingerprintSource({ ...baseSource, ingredientes: null })).not.toBe(
      fingerprintSource({ ...baseSource, ingredientes: [] }),
    )
  })
})

describe('fingerprintMt (#496)', () => {
  it('é determinístico e sensível ao nome traduzido (editar um nome deixa de ser intocada)', () => {
    const h = fingerprintMt(baseMt)
    expect(fingerprintMt({ ...baseMt, ingredientes: [...baseMt.ingredientes!] })).toBe(h)
    const edited = fingerprintMt({
      ...baseMt,
      ingredientes: [
        { ordem: 0, nome: 'black turtle beans' },
        { ordem: 1, nome: 'sausage' },
      ],
    })
    expect(edited).not.toBe(h)
  })

  it('muda quando o corpo traduzido muda (curador editou o texto → não-intocada)', () => {
    const h = fingerprintMt(baseMt)
    expect(fingerprintMt({ ...baseMt, titulo: 'Brazilian Feijoada' })).not.toBe(h)
    expect(fingerprintMt({ ...baseMt, passos: ['Sauté', 'Simmer', 'Rest'] })).not.toBe(h)
  })

  it('source e mt de mesma forma não colidem (domínios separados)', () => {
    const s = fingerprintSource({ ...baseSource, titulo: 'X', descricao: null, passos: null, notas: null, ingredientes: null })
    const m = fingerprintMt({ titulo: 'X', descricao: null, passos: null, notas: null, ingredientes: null })
    expect(s).not.toBe(m)
  })
})
