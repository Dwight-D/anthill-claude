// The plugin's `$.state` contract: every value the hooks module keeps under
// the plugin's name, read by `claude plugin validate` against the module's
// `$.state` keys. Named from .claude-plugin/plugin.json `types`. Self-contained
// (no imports): hooks/features/now-pane/model.ts and
// hooks/features/spark-nodes/model.ts import these types from here.

/** The anthill installation the session runs in: its root and key prefix. */
export type Install = { root: string; prefix: string }

/** One Now pane row (an in-progress or validation item). */
export type Row = {
  key: string
  title: string
  summary: string
  status: string
  dispatch: string
  disposition: string
  workstream: string
  claimedBy: string
  session: string
  /** The first 8 characters of the session id. */
  session8: string
  /** Milliseconds since the item's last activity at refresh time; null when unknown. */
  ageMs: number | null
  /** The ledger's transcript path for the item's session. */
  transcript: string
  /** The item file's path. */
  path: string
}

export type Counts = { ready: number; proposed: number; blocked: number }

/** The `now` value: rows, counts and the refresh stamp. */
export type Now = {
  rows: Row[]
  validation: Row[]
  counts: Counts
  /** Epoch ms of the refresh that produced this value; 0 before the first. */
  refreshedAt: number
  /** The session's turn count at that refresh. */
  turn: number
}

/** The detail view's model, from `anthill backlog show <key> --json` and the ledger. */
export type Detail = {
  key: string
  title: string
  status: string
  dispatch: string
  disposition: string
  workstream: string
  priority: string
  risk: string
  claimedBy: string
  session: string
  session8: string
  ageMs: number | null
  reporter: string
  createdAt: string
  verify: string
  formerId: string
  path: string
  transcript: string
  summary: string
  acceptance: string
  /** The last three `## Log` lines, oldest first, timestamps shortened to `HH:MMZ`. */
  log: string[]
}

/** One node as `spark query --json --fields key,title,type,summary` prints it. */
export type SparkNode = { key: number; title: string; type: string | null; summary: string }

/** The lazily fetched content of one node. */
export type SparkContent =
  | { state: 'loading' }
  | { state: 'ok'; content: string | null }
  | { state: 'unsupported' }
  | { state: 'failed' }
  | { state: 'gone' }

/** Whether the spark CLI answered this session. */
export type SparkStatus = 'unknown' | 'ok' | 'unavailable'

declare module 'claude-code' {
  interface PluginState {
    'anthill-claude': {
      /** The installation found at session start; null when the cwd holds none. */
      'now-install': Install | null
      /** The Now pane's rows, counts and refresh stamp. */
      now: Now
      /** The key shown in the detail view; null for the list. */
      'now-selected': string | null
      /** `show --json` details by key, cached until the next refresh. */
      'now-details': Record<string, Detail>
      /** Whether the spark CLI answered this session. */
      'spark-status': SparkStatus
      /** Positive cache of Spark nodes by decimal key. */
      'spark-nodes': Record<string, SparkNode>
      /** Negative cache: keys a successful query did not return. */
      'spark-missing': Record<string, true>
      /** Lazily fetched node content by decimal key. */
      'spark-content': Record<string, SparkContent>
      /** Message site → the key whose info box is open. */
      'spark-open': Record<string, number>
      /** Message site → the key whose content shows. */
      'spark-expanded': Record<string, number>
    }
  }
}
