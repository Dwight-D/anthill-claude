// Pure substitution logic for the language-sanitization feature: no Claude
// imports, so it runs under the engine and under `node --test` alike.

import type { Term } from './terms'

export type Fired = {
  /** The text as it first matched, e.g. "Reasoning trail". */
  match: string
  /** What it became. */
  replacement: string
  /** The term entry's note. */
  note: string
  /** How many times this term matched. */
  count: number
}

export type Sanitized = {
  text: string
  fired: Fired[]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const startsUpper = (s: string) => /^[A-Z]/.test(s)

export const sanitize = (text: string, terms: readonly Term[]): Sanitized => {
  const fired: Fired[] = []
  let out = text

  for (const term of terms) {
    const re = new RegExp(`\\b(?:${term.pattern})\\b`, 'gi')
    let first = ''
    let count = 0

    out = out.replace(re, match => {
      if (count === 0) first = match
      count += 1
      return startsUpper(match) ? capitalize(term.replacement) : term.replacement
    })

    if (count > 0) {
      fired.push({ match: first, replacement: term.replacement, note: term.note, count })
    }
  }

  return { text: out, fired }
}

/** The chat warning for one or more fired terms. */
export const warning = (fired: readonly Fired[]): string =>
  `Wording that can trip model safeguards: ${fired
    .map(f => `${f.match} → ${f.replacement}`)
    .join('; ')}`
