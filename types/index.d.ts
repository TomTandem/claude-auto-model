export type Counts = { haiku: number; sonnet: number; opus: number }

export type Stats = {
  tier: 'haiku' | 'sonnet' | 'opus' | null
  reason: string
  counts: Counts
  // coût réel (modèles utilisés + classifieur) et coût si tout avait tourné sur Opus, en dollars
  costReal: number
  costOpus: number
}

declare module 'claude-code' {
  interface PluginState {
    'auto-model': { stats: Stats }
  }
}
