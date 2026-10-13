import type { Register } from 'claude-code'

import type { Stats } from '../types'

const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
} as const

type Tier = keyof typeof MODELS

const REASONS: Record<Tier, string> = { haiku: 'simple', sonnet: 'rédaction', opus: 'code' }

// Hypothèse de tarifs en $ par million de tokens (à ajuster) : entrée, sortie.
// Lecture de cache = 0,1 × entrée, écriture de cache = 1,25 × entrée.
const PRICES: Record<Tier, { in: number; out: number }> = {
  haiku: { in: 1, out: 5 },
  sonnet: { in: 3, out: 15 },
  opus: { in: 5, out: 25 },
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const cost = (tier: Tier, u: Usage): number => {
  const p = PRICES[tier]
  return (
    (u.input_tokens * p.in +
      u.cache_read_input_tokens * p.in * 0.1 +
      u.cache_creation_input_tokens * p.in * 1.25 +
      u.output_tokens * p.out) /
    1_000_000
  )
}

const tierOf = (model: string): Tier | undefined =>
  model.includes('opus') ? 'opus' : model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : undefined

const stats = { plugin: 'auto-model', key: 'stats' } as const

const EMPTY: Stats = {
  tier: null,
  reason: '',
  counts: { haiku: 0, sonnet: 0, opus: 0 },
  costReal: 0,
  costOpus: 0,
}

const DOT: Record<Tier, string> = { haiku: '🟢', sonnet: '🔵', opus: '🟣' }
const NAME: Record<Tier, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

const RULES = `Tu es un routeur. Tu lis la requête d'un utilisateur adressée à un assistant IA et tu choisis le modèle le plus adapté. Réponds par UN SEUL mot, sans ponctuation :
- haiku : tâche simple et rapide (question factuelle courte, reformatage, renommage, liste, lecture ou recherche simple, commande triviale, confirmation).
- sonnet : rédaction et contenu (mail, propal, SOW, article, post LinkedIn, résumé, compte rendu, traduction, deck, analyse de texte, brainstorming, tâches business).
- opus : code et raisonnement complexe (écrire, modifier ou débugger du code, workflows n8n, scripts, SQL, architecture, refactor, analyse approfondie, tâche agentique multi-étapes, problème difficile).
En cas de doute entre deux niveaux, prends le plus élevé.`

const CODE =
  /```|\b(code|bug|debug|refactor\w*|fonction|function|script|api|sql|regex|stack ?trace|exception|compil\w*|typescript|javascript|python|react|docker|git|commit|impl[ée]ment\w*|architecture|n8n|workflow|webhook)\b|\.(ts|tsx|js|py|json|sql|sh)\b/i
const WRITING =
  /\b(r[ée]dige\w*|[ée]cri(s|re)|mail|article|post|linkedin|r[ée]sum\w*|reformul\w*|traduis\w*|propal|compte[- ]rendu|deck|slides?|contrat|sow|nda|draft|write|rewrite)\b/i

const fallback = (text: string): Tier =>
  CODE.test(text) ? 'opus' : WRITING.test(text) || text.length >= 70 ? 'sonnet' : 'haiku'

const parse = (reply: string): Tier | undefined => {
  const word = reply.toLowerCase().match(/haiku|sonnet|opus/)
  return word ? (word[0] as Tier) : undefined
}

export const register: Register = on => {
  let isEnabled = true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'auto-model',
      description: 'Active ou coupe le choix automatique du modèle (on/off)',
      argumentHint: 'on|off',
    })

    return next(e)
  })

  on('command.run', { command: 'auto-model' }, async (_$, e) => {
    const arg = String((e as { args?: string }).args ?? '').trim().toLowerCase()
    if (arg === 'on') isEnabled = true
    else if (arg === 'off') isEnabled = false
    else isEnabled = !isEnabled

    return { text: `auto-model : ${isEnabled ? 'activé' : 'désactivé'}` }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    // un « oui », « ok », « vas-y » garde le modèle en cours
    if (!isEnabled || e.origin.kind !== 'composer' || text.startsWith('/') || text.length < 15) {
      return next(e)
    }

    try {
      let tier: Tier | undefined
      let isFallback = false

      const r = await $.model.complete({
        model: MODELS.haiku,
        system: RULES,
        prompt: text.slice(0, 1500),
        maxTokens: 8,
        effort: 'low',
        timeoutMs: 4000,
      })
      if (r.isAnswered) tier = parse(r.text)
      if (!tier) {
        tier = fallback(text)
        isFallback = true
      }

      const target = MODELS[tier]
      const current = await $.session.model()
      const picked = tier
      const classifierCost = r.isAnswered ? cost('haiku', r.usage) : 0
      const held = await $.state.get(stats)
      const s = held.value ?? EMPTY
      await $.state.set(stats, {
        ...s,
        reason: REASONS[picked],
        costReal: s.costReal + classifierCost,
      })

      if (!current.includes(tier)) {
        const rows = await $.config.list()
        const row = rows.find(x => x.key === 'model') ?? rows.find(x => /model/i.test(x.key))
        if (row) {
          const res = await $.config.set({ key: row.key, value: target })
          if (res.deny === undefined) {
            $.ui.toast(`Modèle : ${tier}${isFallback ? ' (règles)' : ''}`)
          }
        }
      }
    } catch {
      // le routage ne doit jamais bloquer le prompt
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    const tier = u ? tierOf(u.model) : undefined
    if (u && tier) {
      const held = await $.state.get(stats)
      const s = held.value ?? EMPTY
      await $.state.set(stats, {
        ...s,
        tier: e.agentId === undefined ? tier : s.tier,
        counts: e.agentId === undefined ? { ...s.counts, [tier]: s.counts[tier] + 1 } : s.counts,
        costReal: s.costReal + cost(tier, u),
        costOpus: s.costOpus + cost('opus', u),
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = (await $.state.get(stats)).value ?? EMPTY
    if (e.props.hasSurvey || s.tier === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const { haiku, sonnet, opus } = s.counts
    const saving =
      s.costOpus > 0 ? Math.round((1 - s.costReal / s.costOpus) * 100) : undefined
    const savingText =
      saving === undefined ? '' : saving >= 0 ? `  |  ≈ −${saving} % vs tout-Opus` : `  |  ≈ +${-saving} % vs tout-Opus`

    return (
      <Box>
        <Text dimColor>
          {DOT[s.tier]} {NAME[s.tier]}
          {s.reason ? ` · ${s.reason}` : ''}  |  Haiku {haiku} · Sonnet {sonnet} · Opus {opus}
          {savingText}
        </Text>
      </Box>
    )
  })
}
