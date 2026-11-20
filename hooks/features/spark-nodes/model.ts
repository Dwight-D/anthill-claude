// Spark node chips: argv, parsing, cache bookkeeping and display helpers.
// Pure: no Claude or Node imports, so it runs under the engine and under
// `node --test` alike. Spec: docs/specs/spec-spark-nodes.md §3 and §5.
import type { SparkNode } from '../../../types'
import { canonicalRef, refScope } from './mentions.ts'

export const MAX_KEYS_PER_BATCH = 50
export const INFO_FIELDS = 'key,scope,ref,title,type,summary'
export const CONTENT_FIELDS = 'key,scope,ref,title,type,summary,content'
export const CHIP_TITLE_MAX = 32
export const CONTENT_MAX_LINES = 60
export const CONTENT_MAX_CHARS = 4000

// `--all`: without it `spark query` leaves out domain types (todos).
// Refs are canonical strings (`12`, `PAY-12`); the plugin never passes `--global`.
export const infoArgv = (keys: string[]): string[] => [
  'spark', 'query', '--json', '--all', '--fields', INFO_FIELDS, ...keys.flatMap(k => ['--key', k]),
]

export const contentArgv = (ref: string): string[] => [
  'spark', 'query', '--json', '--all', '--fields', CONTENT_FIELDS, '--key', ref,
]

export type ParsedBatch =
  | { ok: true; nodes: SparkNode[]; contents: Record<string, string | null> }
  | { ok: false }

export const parseNodeLines = (stdout: string): ParsedBatch => {
  const nodes: SparkNode[] = []
  const contents: Record<string, string | null> = {}
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.trim()) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      return { ok: false }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false }
    const o = v as Record<string, unknown>
    if (typeof o.key !== 'number' || !Number.isSafeInteger(o.key) || o.key <= 0 || typeof o.title !== 'string') return { ok: false }
    // Identity is `ref` (F-SPK-L04); `key` is only the number within its scope. An
    // old Spark (no `ref`, no local workspaces) has only global keys.
    let ref: string | null
    if ('ref' in o) {
      ref = canonicalRef(o.ref)
      if (ref === null) return { ok: false }
      if (typeof o.scope === 'string' && o.scope !== refScope(ref)) return { ok: false }
    } else {
      if (typeof o.scope === 'string' && o.scope !== '') return { ok: false } // a workspace node must carry its ref
      ref = canonicalRef(String(o.key))
      if (ref === null) return { ok: false }
    }
    nodes.push({
      key: ref,
      title: o.title,
      type: typeof o.type === 'string' ? o.type : null,
      summary: typeof o.summary === 'string' ? o.summary : '',
    })
    if ('content' in o) contents[ref] = typeof o.content === 'string' && o.content !== '' ? o.content : null
  }
  return { ok: true, nodes, contents }
}

/** `mentioned` (order kept, de-duplicated) minus keys cached either way or in flight. */
export const pendingKeys = (
  mentioned: string[],
  nodes: Record<string, unknown>,
  missing: Record<string, unknown>,
  inFlight: ReadonlySet<string>,
): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of mentioned) {
    if (seen.has(k)) continue
    seen.add(k)
    if (k in nodes || k in missing || inFlight.has(k)) continue
    out.push(k)
  }
  return out
}

/**
 * Refs grouped by scope (the global group is the bare refs; each project key is
 * its own group; groups in first-appearance order), each chunked at `size`.
 * One batch never mixes graphs (F-SPK-L03).
 */
export const batches = (keys: string[], size = MAX_KEYS_PER_BATCH): string[][] => {
  const groups = new Map<string, string[]>()
  for (const k of keys) {
    const scope = refScope(k)
    const g = groups.get(scope)
    if (g) g.push(k)
    else groups.set(scope, [k])
  }
  const out: string[][] = []
  for (const g of groups.values()) for (let i = 0; i < g.length; i += size) out.push(g.slice(i, i + size))
  return out
}

/** Whether a `process.run` rejection means the binary cannot be started at all. */
export const isSpawnFailure = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null
  const text = `${typeof e?.code === 'string' ? e.code : ''} ${typeof e?.message === 'string' ? e.message : String(err)}`
  return /ENOENT|EACCES|EPERM|spawn|not found|no such file|cannot find|not executable/i.test(text)
}

/** Whitespace collapsed, cut to `n` characters with `…`. */
export const truncate = (s: string, n: number): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return n <= 1 ? t.slice(0, n) : `${t.slice(0, n - 1).trimEnd()}…`
}

/** The chip's accessible name: `[12] Payments API`. */
export const chipLabel = (key: string, title: string): string => `[${key}] ${truncate(title, CHIP_TITLE_MAX)}`

/**
 * The first 60 lines / 4000 characters of `content`, whichever cuts first;
 * `moreLines` counts the lines not shown (a line cut mid-way counts as not shown).
 */
export const contentView = (content: string): { text: string; moreLines: number } => {
  const s = String(content ?? '')
  const lines = s.split('\n')
  let end = s.length
  if (lines.length > CONTENT_MAX_LINES) end = lines.slice(0, CONTENT_MAX_LINES).join('\n').length
  if (end > CONTENT_MAX_CHARS) end = CONTENT_MAX_CHARS
  if (end >= s.length) return { text: s, moreLines: 0 }
  const text = s.slice(0, end)
  const atLineEnd = s[end] === '\n'
  const shown = atLineEnd ? text.split('\n').length : text.split('\n').length - 1
  return { text, moreLines: lines.length - shown }
}

/** A short stable id for a string (djb2, base 36). */
export const hash = (s: string): string => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
