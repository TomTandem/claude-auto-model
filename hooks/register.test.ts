import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const usage = { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// Monde simulé sous le mod : ce que Haiku répond, le modèle courant, les écritures de /config.
const world = (
  on: On,
  o: { haiku: string | 'fail'; current: string },
) => {
  const sets: { key: string; value: unknown }[] = []
  on('model.complete', () =>
    o.haiku === 'fail'
      ? { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage } }
      : { value: { isAnswered: true as const, text: o.haiku, usage } },
  )
  on('session.model', () => ({ value: o.current }))
  on('config.list', () => ({
    value: [
      { key: 'model', label: 'Model', kind: 'choice' as const, value: o.current, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false },
    ],
  }))
  on('config.set', (_$, e) => {
    sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return sets
}

const prompt = (text: string, kind: 'composer' | 'sdk' = 'composer') =>
  ({ text, wait: false, origin: { kind } }) as const

describe('auto-model', () => {
  const cases: [string, string, string][] = [
    ['code → Opus', 'opus', 'Corrige le bug dans la fonction parseDate de utils.ts'],
    ['rédaction → Sonnet', 'sonnet', 'Rédige un mail de relance pour le client Santiane'],
    ['simple → Haiku', 'haiku', 'Quelle est la capitale de la Slovénie ?'],
  ]
  for (const [name, tier, text] of cases) {
    test(name, async ($, on) => {
      const sets = world(on, { haiku: tier, current: 'claude-sonnet-5-5' })
      await $.prompt.submit(prompt(text))
      if (tier === 'sonnet') expect(sets).toEqual([])
      else expect(sets).toEqual([{ key: 'model', value: `claude-${tier}-5-5` }])
    })
  }

  test('ne change rien si le modèle est déjà le bon', async ($, on) => {
    const sets = world(on, { haiku: 'opus', current: 'claude-opus-5-5' })
    await $.prompt.submit(prompt('Refactor le workflow n8n de facturation'))
    expect(sets).toEqual([])
  })

  test('réponse de Haiku illisible → règles de secours', async ($, on) => {
    const sets = world(on, { haiku: 'peut-être ?', current: 'claude-haiku-5-5' })
    await $.prompt.submit(prompt('Écris un script python qui renomme les fichiers'))
    expect(sets).toEqual([{ key: 'model', value: 'claude-opus-5-5' }])
  })

  test('Haiku indisponible → règles de secours', async ($, on) => {
    const sets = world(on, { haiku: 'fail', current: 'claude-opus-5-5' })
    await $.prompt.submit(prompt('Rédige un post LinkedIn sur notre dernière mission'))
    expect(sets).toEqual([{ key: 'model', value: 'claude-sonnet-5-5' }])
  })

  test('prompt trop court → modèle conservé', async ($, on) => {
    const sets = world(on, { haiku: 'haiku', current: 'claude-opus-5-5' })
    await $.prompt.submit(prompt('oui vas-y'))
    expect(sets).toEqual([])
  })

  test('commande slash → ignorée', async ($, on) => {
    const sets = world(on, { haiku: 'haiku', current: 'claude-opus-5-5' })
    await $.prompt.submit(prompt('/auto-model off pour tout de suite'))
    expect(sets).toEqual([])
  })

  test('prompt hors clavier (sdk) → ignoré', async ($, on) => {
    const sets = world(on, { haiku: 'haiku', current: 'claude-opus-5-5' })
    await $.prompt.submit(prompt('Quelle est la capitale de la Slovénie ?', 'sdk'))
    expect(sets).toEqual([])
  })
})
