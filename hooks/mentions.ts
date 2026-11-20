// Namespaced key mentions: `¤<program>:<key>`. Pure, no imports: the single
// place programs are named. Spec: docs/specs/spec-mentions.md (F-MEN-01…03).

export const SIGIL = '¤' // U+00A4 CURRENCY SIGN

export const PROGRAMS = {
  spark: ['spark', 'sp'],
  anthill: ['anthill', 'ah'],
} as const satisfies Record<string, readonly string[]>

export type Program = keyof typeof PROGRAMS

/** Program for a name or alias (case-insensitive), or null. */
export const programFor = (name: string): Program | null => {
  if (typeof name !== 'string') return null
  const n = name.toLowerCase()
  for (const p of Object.keys(PROGRAMS) as Program[]) {
    if ((PROGRAMS[p] as readonly string[]).includes(n)) return p
  }
  return null
}

const caseless = (s: string) => [...s].map(c => (c.toLowerCase() !== c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c)).join('')

/**
 * Global, Unicode regex matching `¤<name>:<key>` for one program, where
 * `keySource` is the key's regex source. Group 1 is the key.
 */
export const namespacedPattern = (program: Program, keySource: string): RegExp => {
  const names = PROGRAMS[program].map(caseless).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}_])\\u00A4(?:${names}):(${keySource})(?![\\p{L}\\p{N}_-])`, 'gu')
}
