// Spark node mentions (`¤sp:12`) in message text. Pure: no Claude or Node
// imports, so it runs under the engine and under `node --test` alike.
// Spec: docs/specs/spec-spark-nodes.md §2 (F-SPK-M01…M04), docs/specs/spec-mentions.md.

import { namespacedPattern } from '../../mentions.ts'

export const MAX_KEYS_PER_MESSAGE = 12

const mask = (s: string) => s.replace(/[^\n]/g, '_')

/** Masks inline code spans (F-SPK-M02 item 2) in a stretch of text with no fences. */
const maskInline = (s: string): string => {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] !== '`') {
      out += s[i++]
      continue
    }
    let j = i
    while (s[j] === '`') j++
    const n = j - i
    // Find the next run of exactly n backticks.
    let k = j
    let close = -1
    while (k < s.length) {
      if (s[k] !== '`') {
        k++
        continue
      }
      let m = k
      while (s[m] === '`') m++
      if (m - k === n) {
        close = m
        break
      }
      k = m
    }
    if (close === -1) {
      out += s.slice(i, j) // no closer: literal text
      i = j
    } else {
      out += mask(s.slice(i, close))
      i = close
    }
  }
  return out
}

/** `text` with every code region replaced per F-SPK-M02 (same length, newlines kept). */
export const maskCode = (text: string): string => {
  if (typeof text !== 'string' || !text) return ''
  const lines = text.split('\n')
  const out: string[] = []
  let fence: { char: string; len: number } | null = null
  let pending: string[] = [] // consecutive non-fenced lines, inline-masked together
  const flush = () => {
    if (pending.length) out.push(...maskInline(pending.join('\n')).split('\n'))
    pending = []
  }
  for (const line of lines) {
    if (fence) {
      out.push(mask(line))
      const c = new RegExp(`^ {0,3}(${fence.char}{${fence.len},})[ \\t\\r]*$`).exec(line)
      if (c) fence = null
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open && open[1]) {
      flush()
      fence = { char: open[1][0] as string, len: open[1].length }
      out.push(mask(line))
      continue
    }
    pending.push(line)
  }
  flush()
  return out.join('\n')
}

/** Spark key form (spec-mentions.md F-MEN-02): `<n>` or `<PROJECT>-<n>`. */
export const SPARK_KEY_SOURCE = '(?:[A-Za-z]{2,10}-)?[1-9][0-9]{0,8}'

const MENTION = namespacedPattern('spark', SPARK_KEY_SOURCE)
const REF = new RegExp(`^${SPARK_KEY_SOURCE}$`)

/** Canonical ref string (`"12"`, `"PAY-12"`, prefix uppercased), or null when `s` is not a Spark key. */
export const canonicalRef = (s: unknown): string | null => (typeof s === 'string' && REF.test(s) ? s.toUpperCase() : null)

/** The scope of a canonical ref: its project key (`"PAY"`), or `""` for the global graph. */
export const refScope = (ref: string): string => {
  const i = ref.indexOf('-')
  return i < 0 ? '' : ref.slice(0, i)
}

/** Distinct mentioned canonical refs, first-appearance order, at most MAX_KEYS_PER_MESSAGE. */
export const extractMentions = (text: string): string[] => {
  if (typeof text !== 'string' || !text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of maskCode(text).matchAll(MENTION)) {
    const n = (m[1] as string).toUpperCase()
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
    if (out.length >= MAX_KEYS_PER_MESSAGE) break
  }
  return out
}
