// Item keys (`ANT-74`): the installation prefix, a hyphen, a positive integer.
// Pure: no Claude or Node imports, so it runs under the engine and under
// `node --test` alike. Contract: anthill-cli/docs/ITEM_KEYS_SPEC.md §1.

/** A prefix is 2 to 5 uppercase ASCII letters. */
export const PREFIX = /^[A-Z]{2,5}$/

/** A canonical key: `ANT-74`. */
export const CANONICAL = /^[A-Z]{2,5}-[1-9][0-9]*$/

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The global matcher for the installation's keys, bound to its prefix so
 * `UTF-8` or `SHA-256` never match. Case-sensitive. Returns null for an
 * invalid prefix.
 */
export const keyPattern = (prefix: string): RegExp | null =>
  PREFIX.test(prefix) ? new RegExp(`\\b${escape(prefix)}-[1-9][0-9]*\\b`, 'g') : null

/** Distinct keys mentioned in `text`, in order of first appearance. */
export const extractKeys = (text: string, prefix: string): string[] => {
  const re = keyPattern(prefix)
  if (!re || typeof text !== 'string' || !text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

/** The number of a canonical key (`ANT-74` → 74); NaN for anything else. */
export const keyNumber = (key: string): number => (CANONICAL.test(key) ? Number(key.slice(key.indexOf('-') + 1)) : NaN)

/**
 * Resolves what a person typed (`/ant 74`, `/ant ANT-74`, `/ant ant-74`) to
 * the canonical key under the installation's prefix; null when it is neither
 * a number nor a key of this installation.
 */
export const parseKeyArg = (arg: string, prefix: string): string | null => {
  const s = (arg ?? '').trim()
  if (!PREFIX.test(prefix) || !s) return null
  if (/^[1-9][0-9]*$/.test(s)) return `${prefix}-${s}`
  const m = /^([A-Za-z]{2,5})-([1-9][0-9]*)$/.exec(s)
  if (m && m[1] && m[1].toUpperCase() === prefix) return `${prefix}-${m[2]}`
  return null
}

/**
 * The `key-prefix:` value from the frontmatter of
 * `.anthill/backlog/workstreams.md`; null when absent or invalid.
 */
export const readPrefix = (workstreamsMd: string): string | null => {
  if (typeof workstreamsMd !== 'string') return null
  const m = /^key-prefix:[ \t]*["']?([A-Za-z]{2,5})["']?[ \t]*$/m.exec(workstreamsMd)
  if (!m || !m[1]) return null
  const prefix = m[1].toUpperCase()
  return PREFIX.test(prefix) ? prefix : null
}
