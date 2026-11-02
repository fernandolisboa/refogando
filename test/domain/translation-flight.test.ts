import { describe, expect, it } from 'vitest'
import {
  TRANSLATION_CAP_BY_ROLE,
  TRANSLATION_LEASE_MS,
  TRANSLATION_MAX_INGREDIENTS,
  TRANSLATION_MAX_PAYLOAD_BYTES,
  TRANSLATION_MAX_STEPS,
  TRANSLATION_PAIR_LOCK_TIMEOUT_MS,
  TRANSLATION_USER_LOCK_TIMEOUT_MS,
  capForTranslation,
  decideTranslationFlight,
  isTranslationInputTooLarge,
  translationFlightFailKey,
  translationModelConfigKey,
  translationPayloadBytes,
} from '@/domain/translation-flight'
import { buildTranslationPrompt, buildTranslationUserPrompt } from '@/domain/translation-prompt'
import { retranslateFailKey } from '@/domain/translation-divergent-stale'

/** Guardas de custo da tradução sob demanda (#642, ADR-0056): decisões puras. */
describe('decideTranslationFlight', () => {
  const base = {
    translationExists: false,
    leaseActive: false,
    cooldownActive: false,
    storedFailKey: null,
    currentFailKey: 'fp:v2',
  }

  it('sem estado ⇒ go', () => {
    expect(decideTranslationFlight(base)).toBe('go')
  })

  it('tradução já gravada vence tudo (mesmo com lease ou cooldown)', () => {
    expect(
      decideTranslationFlight({ ...base, translationExists: true, leaseActive: true, cooldownActive: true }),
    ).toBe('exists')
  })

  it('lease valendo ⇒ in_progress', () => {
    expect(decideTranslationFlight({ ...base, leaseActive: true })).toBe('in_progress')
  })

  it('cooldown valendo com a MESMA chave ⇒ cooling_down', () => {
    expect(decideTranslationFlight({ ...base, cooldownActive: true, storedFailKey: 'fp:v2' })).toBe('cooling_down')
  })

  it('cooldown com chave diferente (fonte editada ou prompt novo) ⇒ go', () => {
    expect(decideTranslationFlight({ ...base, cooldownActive: true, storedFailKey: 'outra:v2' })).toBe('go')
    expect(decideTranslationFlight({ ...base, cooldownActive: true, storedFailKey: 'fp:v1' })).toBe('go')
  })

  it('cooldown vencido com a mesma chave ⇒ go', () => {
    expect(decideTranslationFlight({ ...base, cooldownActive: false, storedFailKey: 'fp:v2' })).toBe('go')
  })
})

describe('teto da entrada (bytes do JSON que vai ao modelo)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length

  it('mede o userPrompt serializado (com a estrutura JSON e os escapes) mais a cozinha', () => {
    const input = {
      fields: { titulo: 'abc', descricao: 'de', passos: ['f', 'gh'], notas: 'i' },
      ingredientes: [
        { ordem: 1, nome: 'jk' },
        { ordem: 2, nome: 'l' },
      ],
    }
    const userPrompt = buildTranslationUserPrompt(input)
    expect(translationPayloadBytes(input)).toBe(bytes(userPrompt))
    expect(translationPayloadBytes({ ...input, cozinha: ' italiana ' })).toBe(bytes(userPrompt) + 'italiana'.length)
    // É o mesmo texto que o tradutor manda como mensagem do usuário.
    const { userPrompt: sent } = buildTranslationPrompt({ sourceLocale: 'pt-BR', targetLocale: 'en-US', ...input })
    expect(sent).toBe(userPrompt)
  })

  it('o que o texto cru não via pesa: passos vazios, ingredientes de 1 letra, caracteres de controle', () => {
    const vazio = { fields: { titulo: 'x' } }
    const base = translationPayloadBytes(vazio)
    // 40 passos vazios: 0 caracteres de texto, mas `"",` cada.
    const passosVazios = translationPayloadBytes({ fields: { titulo: 'x', passos: Array(40).fill('') } })
    expect(passosVazios).toBeGreaterThan(base + 40 * 2)
    // 1 ingrediente de 1 letra custa ~25 bytes de JSON.
    const umIngrediente = translationPayloadBytes({ ...vazio, ingredientes: [{ ordem: 10, nome: 'a' }] })
    expect(umIngrediente - base).toBeGreaterThanOrEqual(20)
    // Um caractere de controle vira `\u0001` (6 bytes).
    expect(translationPayloadBytes({ fields: { titulo: 'x\u0001' } }) - base).toBe(6)
    // Fora do alfabeto latino, um caractere ocupa mais de um byte.
    expect(translationPayloadBytes({ fields: { titulo: 'x食' } }) - base).toBe(3)
  })

  it('recusa os desvios do teto em caracteres: muitos passos vazios, muitos ingredientes de 1 letra, controle', () => {
    const passos = (n: number) => ({ fields: { titulo: 'x', passos: Array(n).fill('') } })
    expect(isTranslationInputTooLarge(passos(100_000))).toBe(true)
    expect(isTranslationInputTooLarge(passos(TRANSLATION_MAX_STEPS + 1))).toBe(true)
    expect(isTranslationInputTooLarge(passos(TRANSLATION_MAX_STEPS))).toBe(false)
    const ingredientes = (n: number) => ({
      fields: { titulo: 'x' },
      ingredientes: Array.from({ length: n }, (_, i) => ({ ordem: i, nome: 'a' })),
    })
    expect(isTranslationInputTooLarge(ingredientes(5_000))).toBe(true)
    expect(isTranslationInputTooLarge(ingredientes(TRANSLATION_MAX_INGREDIENTS + 1))).toBe(true)
    expect(isTranslationInputTooLarge(ingredientes(TRANSLATION_MAX_INGREDIENTS))).toBe(false)
    // 1.500 caracteres de controle: muito abaixo do teto em caracteres, ~9 KB de JSON.
    expect(isTranslationInputTooLarge({ fields: { titulo: 'x', descricao: '\u0001'.repeat(1_500) } })).toBe(true)
  })

  it('no teto passa; um byte acima não', () => {
    const overhead = translationPayloadBytes({ fields: { titulo: '' } })
    const at = { fields: { titulo: 'x'.repeat(TRANSLATION_MAX_PAYLOAD_BYTES - overhead) } }
    const over = { fields: { titulo: 'x'.repeat(TRANSLATION_MAX_PAYLOAD_BYTES - overhead + 1) } }
    expect(translationPayloadBytes(at)).toBe(TRANSLATION_MAX_PAYLOAD_BYTES)
    expect(isTranslationInputTooLarge(at)).toBe(false)
    expect(isTranslationInputTooLarge(over)).toBe(true)
  })

  it('uma receita grande e real passa (40 passos de frase longa, 40 ingredientes, notas)', () => {
    const passo = 'Refogue a cebola e o alho no azeite em fogo médio até dourar, mexendo sempre para não queimar.'
    const input = {
      fields: {
        titulo: 'Feijoada completa à moda da casa',
        descricao: 'Feijão-preto cozido devagar com carnes de porco defumadas e salgadas, servido com arroz e couve.',
        passos: Array(40).fill(passo),
        notas: 'Deixe as carnes salgadas de molho na véspera, trocando a água três vezes.',
      },
      ingredientes: Array.from({ length: 40 }, (_, i) => ({ ordem: i, nome: '200 g de costelinha de porco defumada' })),
      cozinha: 'brasileira',
    }
    expect(isTranslationInputTooLarge(input)).toBe(false)
  })
})

describe('translationFlightFailKey', () => {
  const base = { sourceFingerprint: 'fp', promptVersion: 2, cozinha: 'italiana', modelConfig: 'm1/off/-' }

  it('começa pela chave do circuit-breaker do #520, sem mudá-la', () => {
    expect(translationFlightFailKey(base).startsWith(`${retranslateFailKey('fp', 2)}:`)).toBe(true)
  })

  it('muda com a cozinha e com o modelo/ajuste do admin', () => {
    const k = translationFlightFailKey(base)
    expect(translationFlightFailKey({ ...base, cozinha: 'japonesa' })).not.toBe(k)
    expect(translationFlightFailKey({ ...base, cozinha: null })).not.toBe(k)
    expect(translationFlightFailKey({ ...base, modelConfig: 'm2/off/-' })).not.toBe(k)
    expect(translationFlightFailKey({ ...base, modelConfig: null })).not.toBe(k)
    expect(translationFlightFailKey({ ...base })).toBe(k)
  })

  it('translationModelConfigKey distingue modelo, thinking e esforço', () => {
    const a = translationModelConfigKey({ model: 'm', settings: { thinking: 'off', effort: null } })
    expect(translationModelConfigKey({ model: 'n', settings: { thinking: 'off', effort: null } })).not.toBe(a)
    expect(translationModelConfigKey({ model: 'm', settings: { thinking: 'adaptive', effort: null } })).not.toBe(a)
    expect(translationModelConfigKey({ model: 'm', settings: { thinking: 'off', effort: 'low' } })).not.toBe(a)
  })
})

describe('capForTranslation', () => {
  it('teto por papel: usuario 30, curador 60, admin ∞', () => {
    expect(capForTranslation('usuario')).toBe(30)
    expect(capForTranslation('curador')).toBe(60)
    expect(capForTranslation('admin')).toBe(Infinity)
  })

  it('papel desconhecido/null ⇒ teto de usuario (fail-closed)', () => {
    expect(capForTranslation(null)).toBe(TRANSLATION_CAP_BY_ROLE.usuario)
    expect(capForTranslation('root' as never)).toBe(TRANSLATION_CAP_BY_ROLE.usuario)
  })
})

describe('lease e esperas', () => {
  it('dura mais que o maxDuration (60 s) da rota', () => {
    expect(TRANSLATION_LEASE_MS).toBeGreaterThan(60_000)
  })

  it('as duas esperas de lock somadas cabem antes do prazo de 50 s do tradutor no maxDuration de 60 s', () => {
    expect(TRANSLATION_PAIR_LOCK_TIMEOUT_MS + TRANSLATION_USER_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(5_000)
  })
})
