// The Now pane's row model: the CLI's `--json` output → rows, counts, ages.
// Pure: no Claude or Node imports, so it runs under the engine and under
// `node --test` alike. Contract: anthill-cli/docs/ITEM_KEYS_SPEC.md §5.2.
// The row, counts, now and detail types live in types/index.d.ts (the
// plugin's `$.state` contract, which must be self-contained).

import type { Counts, Detail, Now, Row } from '../../../types'

export type { Counts, Detail, Now, Row }

/** One item as `anthill backlog list --json` / `show --json` prints it. */
export type Item = {
  id: string
  title?: string
  summary?: string
  value?: string
  workstream?: string
  status?: string
  dispatch?: string
  disposition?: string
  priority?: string
  reporter?: string
  'change-type'?: string
  risk?: string
  verify?: string
  source?: string
  'created-at'?: string
  'triaged-at'?: string
  'claimed-at'?: string
  'delivered-at'?: string
  'closed-at'?: string
  'claimed-by'?: string
  session?: string
  'former-id'?: string
  path?: string
  ready?: boolean
  active?: boolean
  /** `show --json` only: the item file's markdown body. */
  body?: string
}

/** One record as `anthill session list --json` prints it. */
export type SessionRecord = {
  session: string
  agent?: string
  handle?: string
  item?: string
  role?: string
  transcript?: string
  cwd?: string
  started?: string
  'last-seen'?: string
  verb?: string
}


export const EMPTY_NOW: Now = {
  rows: [],
  validation: [],
  counts: { ready: 0, proposed: 0, blocked: 0 },
  refreshedAt: 0,
  turn: 0,
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const parseTime = (iso: string | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Parses a JSON array leniently: anything not an array of objects is empty. */
export const parseList = <T>(text: string): T[] => {
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []
  } catch {
    return []
  }
}

/** Parses one JSON object leniently; null when it is not one. */
export const parseObject = <T>(text: string): T | null => {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null
  } catch {
    return null
  }
}

/**
 * The ledger record that speaks for an item: the latest `last-seen` among the
 * records naming it (a subagent's record counts too).
 */
export const sessionFor = (item: Item, sessions: readonly SessionRecord[]): SessionRecord | undefined => {
  let best: SessionRecord | undefined
  let bestAt = -Infinity
  for (const s of sessions) {
    if (s.item !== item.id) continue
    const at = parseTime(s['last-seen']) ?? parseTime(s.started) ?? 0
    if (at >= bestAt) {
      best = s
      bestAt = at
    }
  }
  return best
}

/** Builds one row. The age is the ledger's last-seen, else the item's claim/delivery stamp. */
export const toRow = (item: Item, sessions: readonly SessionRecord[], nowMs: number): Row => {
  const rec = sessionFor(item, sessions)
  const session = str(item.session) || str(rec?.session)
  const seen =
    parseTime(rec?.['last-seen']) ??
    parseTime(item['delivered-at']) ??
    parseTime(item['claimed-at']) ??
    parseTime(item['triaged-at']) ??
    parseTime(item['created-at'])
  return {
    key: str(item.id),
    title: str(item.title),
    summary: str(item.summary) || str(item.value) || str(item.title),
    status: str(item.status),
    dispatch: str(item.dispatch),
    disposition: str(item.disposition),
    workstream: str(item.workstream),
    claimedBy: str(item['claimed-by']) || str(rec?.handle),
    session,
    session8: session.slice(0, 8),
    ageMs: seen === null ? null : Math.max(0, nowMs - seen),
    transcript: str(rec?.transcript),
    path: str(item.path),
  }
}

/** Counts over every non-archived item (`list --json`). */
export const countItems = (all: readonly Item[]): Counts => ({
  ready: all.filter(i => i.ready === true).length,
  proposed: all.filter(i => i.dispatch === 'proposed').length,
  blocked: all.filter(i => i.status === 'blocked').length,
})

/**
 * The `now` value from the three CLI outputs. `active` is `list --active
 * --json` (in-progress + validation), `all` is `list --json`, `sessions` is
 * `session list --json`.
 */
export const buildNow = (
  input: { active: readonly Item[]; all: readonly Item[]; sessions: readonly SessionRecord[] },
  nowMs: number,
  turn: number,
): Now => {
  const rows = input.active.filter(i => i.status === 'in-progress').map(i => toRow(i, input.sessions, nowMs))
  const validation = input.active.filter(i => i.status === 'validation').map(i => toRow(i, input.sessions, nowMs))
  return { rows, validation, counts: countItems(input.all), refreshedAt: nowMs, turn }
}

/** The row for a key, in either section. */
export const findRow = (now: Now, key: string): Row | undefined =>
  now.rows.find(r => r.key === key) ?? now.validation.find(r => r.key === key)

/** `12s`, `4m`, `3h`, `2d`; `?` when unknown. */
export const formatAge = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms)) return '?'
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Truncates to `n` characters with a trailing ellipsis. */
export const truncate = (s: string, n: number): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return n <= 1 ? t.slice(0, n) : `${t.slice(0, n - 1).trimEnd()}…`
}

/** The status-line text: `anthill ANT · 2 active · 1 validation`, or undefined when both are zero. */
export const statusText = (prefix: string, now: Now): string | undefined => {
  const a = now.rows.length
  const v = now.validation.length
  if (a === 0 && v === 0) return undefined
  return `anthill ${prefix} · ${a} active · ${v} validation`
}

/** The pane's footer: `ready a · proposed b · blocked c · ↻ <age> · turn <n>`. */
export const footerText = (now: Now, nowMs: number): string => {
  const { ready, proposed, blocked } = now.counts
  const ago = now.refreshedAt ? formatAge(nowMs - now.refreshedAt) : '?'
  return `ready ${ready} · proposed ${proposed} · blocked ${blocked} · ↻ ${ago} ago · turn ${now.turn}`
}

// --- the detail view -------------------------------------------------------

/** The `## <Heading>` sections of an item file's body, keyed by heading (lowercased). */
export const sections = (body: string): Record<string, string> => {
  const out: Record<string, string> = {}
  let name = ''
  let lines: string[] = []
  const flush = () => {
    if (name) out[name] = lines.join('\n').trim()
  }
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      name = (m[1] ?? '').toLowerCase()
      lines = []
    } else if (name) {
      lines.push(line)
    }
  }
  flush()
  return out
}

/** A `## Log` line without its leading `- `, the timestamp shortened to `HH:MMZ`. */
export const shortLogLine = (line: string): string => {
  const t = line.replace(/^-\s*/, '').trim()
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}Z\s+(.*)$/.exec(t)
  return m ? `${m[2]}Z ${m[3]}` : t
}

/** The detail model from `show --json` plus the ledger. */
export const buildDetail = (item: Item, sessions: readonly SessionRecord[], nowMs: number): Detail => {
  const row = toRow(item, sessions, nowMs)
  const sec = sections(str(item.body))
  const logLines = (sec.log ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
  return {
    key: row.key,
    title: row.title,
    status: row.status,
    dispatch: row.dispatch,
    disposition: row.disposition,
    workstream: row.workstream,
    priority: str(item.priority),
    risk: str(item.risk),
    claimedBy: row.claimedBy,
    session: row.session,
    session8: row.session8,
    ageMs: row.ageMs,
    reporter: str(item.reporter),
    createdAt: str(item['created-at']),
    verify: str(item.verify),
    formerId: str(item['former-id']),
    path: row.path,
    transcript: row.transcript,
    summary: str(item.summary) || sec.description || str(item.value),
    acceptance: sec.acceptance ?? '',
    log: logLines.slice(-3).map(shortLogLine),
  }
}
