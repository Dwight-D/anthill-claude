# Spark node chips — Specification

**Feature:** `spark-nodes`
**Files:** `hooks/features/spark-nodes.tsx` (+ pure helpers under `hooks/features/spark-nodes/`), `hooks/theme.ts`
**Plugin version:** 0.5.0
**Status:** Specified 2026-11-20, not implemented. Amended 2026-11-20 for Spark
local workspaces (qualified keys `PAY-12`, string keys, explicit cwd) — §11;
inline notes mark each superseded requirement.

When a conversation message mentions a Spark node by its canonical display
form `[n]`, the plugin shows a chip for it under the message, the way the Now
pane shows Anthill item keys (`hooks/features/now-pane.tsx`, key chips).
Pressing a chip opens an in-flow info box: the node's title, type and summary.
An explicit "Show content" control in the box fetches and shows the node's
full content; it is never expanded by default.

The data comes from the Spark CLI (`spark query --json`), never from
`spark show` (an access event that reinforces the graph) and never from the
Spark MCP tools. The feature is a separate feature module; it does not change
the Now pane.

Normative words: **must** / **must not** are requirements; **may** is
permission. Every requirement has an ID (`F-SPK-…`); tests and the changelog
cite them.

---

## 1. Dependencies on Spark

**F-SPK-D01 — CLI contract used**
The plugin depends only on Spark's JSON Lines contract
(`spark/docs/specs/spec-json-output.md`) and on `spark query`
(`spark/docs/specs/spec-query.md` F-QRY-L01, F-QRY-L05, F-QRY-S09):

| Need | Spark capability | Spec |
|---|---|---|
| title / type / summary by key, batched, non-mutating | `query-key`, `query-fields`, `summary` | F-QRY-S09, F-QRY-L05, F-JSON-S05 |
| full content by key, non-mutating | `node-content` | F-JSON-R07 |

The chips work with any Spark build that has `query-fields`; "Show content"
needs `node-content` and degrades to a message without it (F-SPK-F07). The
plugin does **not** call `spark meta capabilities` (one spawn saved per
session; an older build fails visibly per F-JSON-P03/S02, which the plugin
handles).

**F-SPK-D02 — Binary and database**
- The executable is `spark`, resolved from `PATH` by `$.process.run` (argv[0]
  `"spark"`, no path, no shell).
- The plugin passes **no** `--db` flag and sets no `SPARK_DB`: the global
  database is whatever the Claude Code process inherits (`SPARK_DB`, else
  Spark's default `~/.spark/spark.db`).
- *(Amended, F-SPK-L01.)* `cwd` **is** passed: `await $.session.cwd()`, so
  Spark discovers the project's local workspace (`.spark/`) from the session's
  working directory, never from wherever the Claude Code process happened to
  start. No `env` or `stdin` is passed.
- Timeout: `timeoutMs: 10_000`, the Now pane's `RUN_TIMEOUT_MS`.

---

## 2. Mention detection

Module: `hooks/features/spark-nodes/mentions.ts` — pure (no `claude-code`
runtime import, no Node import), so it runs under the engine and under
`node --test`.

**F-SPK-M01 — Exported API**
```ts
export const MAX_KEYS_PER_MESSAGE = 12
/** Distinct mentioned keys, first-appearance order, at most MAX_KEYS_PER_MESSAGE. */
export const extractMentions = (text: string): number[]   // amended: string[] of canonical refs, F-SPK-L02
/** `text` with every code region replaced per F-SPK-M02 (exported for tests). */
export const maskCode = (text: string): string
```
A non-string or empty `text` returns `[]` / `''`.

**F-SPK-M02 — Code is masked first**
Before matching, every character inside a code region is replaced by `_`
(a word character), except `\n`, which is kept. Code regions are:
1. **Fenced blocks.** A line whose first non-space character (after at most
   3 spaces of indent) begins a run of ≥3 backticks or ≥3 tildes opens a fence;
   the fence closes at the next line whose first non-space content (≤3 spaces
   indent) is a run of the same character at least as long, followed only by
   whitespace. The opening line, the body and the closing line are all masked.
   An unclosed fence runs to the end of the text.
2. **Inline code spans** (outside fenced blocks). A run of N backticks opens a
   span that closes at the next run of exactly N backticks; the delimiters and
   everything between are masked, newlines inside kept. A run with no matching
   closer is left as literal text.

Indented (4-space) code blocks are **not** masked (they cannot be told from
list continuations without a full markdown parser).

Because masked characters are word characters, a `[n]` that touches code on
its left (`` `arr`[1] ``) is rejected by F-SPK-M03.

**F-SPK-M03 — The mention pattern** *(superseded 2026-11-20)*
Spark mentions are the namespaced form `¤spark:<n>` / `¤sp:<n>` defined in
[spec-mentions.md](spec-mentions.md) F-MEN-01…F-MEN-04, matched on the masked
text (F-SPK-M02) with `namespacedPattern('spark', '[1-9][0-9]{0,8}')`. The bare
`[n]` form is no longer detected; `[n]` remains the display form in chip labels.
Test cases: spec-mentions.md F-MEN-06.

**F-SPK-M04 — Cap**
After de-duplication, only the first `MAX_KEYS_PER_MESSAGE` (12) keys are
returned. Later mentions in the same message get no chip and are not fetched.

---

## 3. Data: argv, parsing, caching

Module: `hooks/features/spark-nodes/model.ts` — pure, like `mentions.ts`.

**F-SPK-C01 — Exact argv**
```ts
export const MAX_KEYS_PER_BATCH = 50
export const INFO_FIELDS = 'key,title,type,summary'
export const CONTENT_FIELDS = 'key,title,type,summary,content'
export const infoArgv = (keys: number[]): string[]    // amended: string refs, F-SPK-L03
export const contentArgv = (key: number): string[]     // amended: string ref, F-SPK-L03
```
- `infoArgv([12, 40])` →
  `['spark', 'query', '--json', '--all', '--fields', 'key,title,type,summary', '--key', '12', '--key', '40']`
- `contentArgv(12)` →
  `['spark', 'query', '--json', '--all', '--fields', 'key,title,type,summary,content', '--key', '12']`

`--all` is required: without it `spark query` excludes domain types (todos,
F-QRY-L02) and a mentioned todo would be negatively cached as missing.
`infoArgv` is never called with more than `MAX_KEYS_PER_BATCH` keys or with
zero keys. The order of `--key` flags is the order given.

**F-SPK-C02 — Expected output**
JSON Lines on stdout, one object per found node, exit 0 (Spark returns found
keys only; missing keys are silently skipped, F-QRY-S09). Example (real
output shape, Spark `query-fields`):
```
{"key":1,"title":"Me","type":null,"summary":""}
{"key":2,"title":"Payments API","type":"component","summary":"Handles card payments"}
```
Content form (Spark `node-content`):
```
{"key":2,"title":"Payments API","type":"component","summary":"Handles card payments","content":"Owns the card flow."}
{"key":3,"title":"Card vault","type":null,"summary":"","content":null}
```
An older Spark answers `--fields …,content` with exit 1, empty stdout and a
stderr line containing `unknown field "content"`.

**F-SPK-C03 — Parsing**
```ts
export type ParsedBatch = { ok: true; nodes: SparkNode[]; contents: Record<string, string | null> } | { ok: false }
export const parseNodeLines = (stdout: string): ParsedBatch
```
- Split on `\n`; ignore lines that are empty after trimming.
- Every remaining line must `JSON.parse` to a non-array object whose `key` is a
  positive safe integer and whose `title` is a string; otherwise the whole
  batch is `{ ok: false }` (a partial or corrupt answer never feeds the
  negative cache).
- `type`: a string is kept; anything else (absent, `null`, other) becomes `null`.
- `summary`: a string is kept; anything else becomes `''`.
- `content` (only when the property is present on the line): a non-empty
  string is kept; `null`, `''` or any other value becomes `null`. Lines without
  a `content` property contribute nothing to `contents`.
- Unknown properties are ignored (F-JSON-F03). Strings are kept as given (no
  trimming); title/summary truncation happens only at display (F-SPK-U02).
- Empty stdout → `{ ok: true, nodes: [], contents: {} }`.

**F-SPK-C04 — Caches (state)**
All caches are `$.state` atoms (declared per F-SPK-S01), session-lived, keyed
by the decimal key string:
- **positive** `spark-nodes`: `Record<string, SparkNode>`;
- **negative** `spark-missing`: `Record<string, true>` — a key requested in a
  batch that succeeded (`ok: true`, exit 0) and not returned. A key in the
  negative cache is **never** requested again this session (including by a
  later scan) and never gets a chip;
- **content** `spark-content`: `Record<string, SparkContent>`.

A key is in at most one of positive/negative. Entries are not expired during
the session (a node edited mid-session shows its first-fetched title until
content is fetched, which refreshes it per F-SPK-F06; a node created
mid-session under a key already negatively cached gets no chip until the next
session — documented limitation).

**F-SPK-C05 — Which keys are fetched**
```ts
export const pendingKeys = (mentioned: number[], nodes: Record<string, unknown>, missing: Record<string, unknown>, inFlight: ReadonlySet<number>): number[]
export const batches = (keys: number[], size?: number): number[][]
```
`pendingKeys` returns `mentioned` (order kept, de-duplicated) minus keys in
either cache or in flight. `batches` chunks into arrays of at most `size`
(default `MAX_KEYS_PER_BATCH`), order kept; `[]` → `[]`.

---

## 4. Fetch triggers and the resolver

Render hooks never spawn a process and never write state (the engine denies
`$.state.set` while drawing — plugin-authoring reference.md, "Drawing:
ui.render"). All fetching is started from event hooks or button handlers.

**F-SPK-F01 — Triggers**
| Event | Condition | Messages scanned |
|---|---|---|
| `session.start` | always | `$.session.messages({ last: 200 })` |
| `turn.complete` | main loop only (`e.agentId === undefined`) | `$.session.messages({ after: lastSeenUuid })` when a uuid is held; else (or when the read answers `{ deny }`) `$.session.messages({ last: 50 })` |
| `prompt.submit` | `e.origin.kind === 'composer'`, `e.command` absent, `e.isMeta` not true | `e.text` only (so a prompt's chips appear before the turn ends) |

Each hook returns `next(e)` unchanged and starts the scan detached
(`void scan(...)`); a hook never awaits the CLI. Each hook carries a
`.catch(($, e, next) => next(e))` so a failure never blocks the event.

`lastSeenUuid` is a module variable set to the `uuid` of the last message a
ranged read returned (a hot reload loses it; the `last: 50` fallback covers
that). Every message's `text` (role `user` or `assistant`) is passed through
`extractMentions` (so each message is capped at 12); the union, in order, is
cut to the first 200 keys per scan.

**F-SPK-F02 — The resolver**
`resolve($, keys: number[])` (a top-level function in `spark-nodes.tsx`):
1. If `spark-status` is `'unavailable'`, return.
2. `pendingKeys` against the current caches and the module-level in-flight
   set; nothing pending → return.
3. Add the pending keys to the in-flight set; run their `batches` **one at a
   time** (serial, never parallel spawns); remove each batch's keys from the
   in-flight set when that batch settles, whatever the outcome.
4. Per batch, `$.process.run(infoArgv(batch), { timeoutMs: 10_000 })`, then:

| Outcome | Effect |
|---|---|
| `run` rejects because the command cannot start (binary missing / not executable — error message or `code` indicates ENOENT/EACCES/spawn failure) | `spark-status` ← `'unavailable'`; one debug log line `spark-nodes: spark unavailable: <message>`; stop (remaining batches skipped) |
| `run` rejects for any other reason (e.g. timeout) | debug log `spark-nodes: spark query failed: <message>`; batch keys not cached; consecutive-failure count + 1; stop this scan (remaining batches skipped) |
| `exitCode !== 0` | debug log `spark-nodes: spark query → exit <n>: <first stderr line>`; batch keys not cached; consecutive-failure count + 1 |
| exit 0, `parseNodeLines` → `{ ok: false }` | debug log `spark-nodes: unparseable spark query output`; as non-zero exit |
| exit 0, `ok: true` | returned nodes merged into `spark-nodes`; requested-but-absent keys merged into `spark-missing`; `spark-status` ← `'ok'`; consecutive-failure count ← 0 |

After 3 consecutive failures (module variable), `spark-status` ←
`'unavailable'` for the rest of the session (one debug line saying so).
All writes go through `update($, atom, fn)` from `claude-code`.

**F-SPK-F03 — Inertness**
While `spark-status` is `'unavailable'` or no key is in the positive cache,
the feature draws nothing (render hooks return `next(e)`), shows no toast,
writes no status line and spawns nothing more. All diagnostics go to
`$.ui.log(..., { to: 'debug' })`. A machine without `spark` on PATH sees no
trace of the feature beyond one debug line.

**F-SPK-F04 — Never mutating**
The plugin must never run `spark show` (with or without `--peek`), any write
command, or any Spark MCP tool. The only argv shapes it ever spawns are
F-SPK-C01's. (`--json` reads are non-mutating per Spark F-JSON-S05.)

**F-SPK-F05 — Content fetch (lazy)**
Started only by pressing "Show content" (F-SPK-U04), for one key:
1. If `spark-content[key]` is `{ state: 'ok' }` or `{ state: 'loading' }` or
   `{ state: 'unsupported' }`, no spawn.
2. Otherwise set it to `{ state: 'loading' }`, then
   `$.process.run(contentArgv(key), { timeoutMs: 10_000 })`:

| Outcome | `spark-content[key]` |
|---|---|
| rejects | `{ state: 'failed' }`; debug log; `spark-status` is **not** changed by a content fetch |
| exit ≠ 0 and stderr contains `unknown field "content"` | `{ state: 'unsupported' }` |
| exit ≠ 0 otherwise, or `{ ok: false }` | `{ state: 'failed' }`; debug log |
| exit 0, the key's record present | `{ state: 'ok', content: <string or null> }` (from `contents[key]`) |
| exit 0, no record for the key | `{ state: 'gone' }` |

A `failed` entry is retried on the next press of "Show content".

**F-SPK-F06 — Content refreshes the header**
On a successful content fetch whose record is present, the record's title,
type and summary replace `spark-nodes[key]`. A `gone` result leaves
`spark-nodes` and `spark-missing` untouched (the chip does not vanish under
the pointer).

**F-SPK-F07 — Old Spark**
With a Spark lacking `node-content`, chips and info boxes work; "Show content"
shows the `unsupported` line of F-SPK-U05. No toast.

---

## 5. UI

All drawing happens in one `ui.render` hook on
`{ component: ['AssistantMessage', 'UserMessage'] }`, mirroring the Now pane's
chip hook. It reads atoms only (`read($, atom)`), never spawns, never writes.

**F-SPK-U01 — Where chips appear**
- `AssistantMessage`: every block (including `isSummary` blocks).
- `UserMessage`: only when `e.props.origin.kind === 'composer'` (as now-pane).
- Keys shown: `extractMentions(e.props.text)` filtered to keys present in
  `spark-nodes`, in mention order. None → `return next(e)` (no wrapper Box).
- `spark-status === 'unavailable'` → `return next(e)`.
- The hook has `.catch(($, e, next) => next(e))`: a failure never breaks a row.

**F-SPK-U02 — Layout**
```
<Box flexDirection="column">
  {await next(e)}                       ← the message as drawn below this hook
  <Box flexDirection="row" flexWrap="wrap" gap={1}>   ← the chip row
    Button per key
  </Box>
  {info box for the site's open key, if any}
</Box>
```
Chip Button: `key={`spark-chip:${n}`}`, children (not `label`):
`<Text weight="bold" color={color('key')}>[n]</Text>`, then ` ` + the title
truncated to 32 characters with now-pane's `truncate` rule (whitespace
collapsed, `…` when cut), then ` ▸` when closed or ` ▾` when its box is open.
Chips have no hover card and no hotkey (mouse-driven, like the Anthill chips).
The chip's accessible name (label) is `[n] <truncated title>`.

**F-SPK-U03 — Open state (site-scoped)**
- A **site** is one rendered message block:
  `site = hash(`${e.component}:${e.requestId ?? ''}:${e.props.text}`)` using
  now-pane's djb2 base-36 `hash` (move it to a shared pure helper or copy it
  into `spark-nodes/model.ts`; do not import it from `now-pane.tsx`).
- `spark-open: Record<site, number>` — the key whose info box is open in that
  site. At most one box per site (pressing another chip in the same message
  switches to it). The same key in two messages is independent.
- Pressing a chip: if `spark-open[site] === n`, delete `spark-open[site]` and
  `spark-expanded[site]`; else set `spark-open[site] = n` and delete
  `spark-expanded[site]` (a newly opened box is never expanded).
- Handlers compute `site` at draw time and capture only `site` and `n`; all
  writes use `update($, …)` reading fresh state.

**F-SPK-U04 — Info box**
Drawn only when `spark-open[site]` is one of this block's shown keys:
```
<Box key="spark-info" flexDirection="column" borderStyle="round" borderColor={color('frame')} paddingX={1}>
  header row:  <Text weight="bold" color={color('key')}>[n]</Text> <Text weight="bold" color={color('body')} wrap="wrap">Title</Text> [<Text color={color('secondary')}>· type</Text>]
  summary:     <Text color={color('body')} wrap="wrap">summary</Text>         ← only when summary !== ''
  control:     <Button key={`spark-content:${n}`} label="Show content" | "Hide content" onPress=…/>
  content:     F-SPK-U05, only when spark-expanded[site] === n
</Box>
```
- Title is full (wrapped), not truncated. The type part is omitted when type is
  `null`.
- "Show content" press: set `spark-expanded[site] = n`, then F-SPK-F05.
  "Hide content" press: delete `spark-expanded[site]` (content cache kept, so
  a re-expand does not spawn).
- Default (fresh box): content collapsed, label "Show content".

**F-SPK-U05 — Content area** (by `spark-content[n]`)
| State | Drawn |
|---|---|
| absent / `loading` | `<Text color={color('secondary')}>Loading content…</Text>` |
| `ok`, content `null` | `<Text color={color('secondary')} italic>no content</Text>` |
| `ok`, string | `<Text color={color('body')} wrap="wrap">` the first 60 lines / 4000 characters (whichever cuts first) `</Text>`; when cut, a following `<Text color={color('secondary')}>… <k> more lines — spark show --peek <n></Text>` |
| `unsupported` | `<Text color={color('problem')}>Content unavailable: this spark has no node-content (update spark).</Text>` |
| `failed` | `<Text color={color('problem')}>Content could not be loaded (see the debug log). Press Show content to retry.</Text>` (the button reads "Show content" in this state even while expanded) |
| `gone` | `<Text color={color('problem')}>[n] no longer exists in Spark.</Text>` |

Content is drawn as plain text (no `Markdown`), so it is safe on every surface.
`contentView(content: string): { text: string; moreLines: number }` in
`model.ts` does the cut (pure, tested); `moreLines` counts the lines not shown
(a cut mid-line counts that line as not shown).

**F-SPK-U06 — Coexistence with the Anthill chips**
`sparkNodes` is registered in `hooks/register.tsx` **after** `nowPane`. Both
hooks wrap `await next(e)`, so a message mentioning `ANT-5` and `[12]` shows
both chip rows (their relative order is whatever the engine's chain order
gives; tests assert presence, not order). The Spark hook must not read or
write any `now-*` atom, and the Now pane is not modified by this change.

**F-SPK-U07 — No other surfaces**
No pane, no status line, no toast, no slash command in this version.

---

## 6. Theme (hard rule: the user is colorblind)

**F-SPK-H01 — One central theme module**
New file `hooks/theme.ts` (pure, `import type { ThemeKey } from 'claude-code'`
only):
```ts
export const THEME = {
  key: 'suggestion',     // node keys [n] — always also bold
  body: 'text',          // titles, summaries, content
  secondary: 'text',     // type, loading / "no content" lines — same high-contrast key as body, distinguished by italic + words, never by a low-contrast key ('subtle'/'inactive' are banned: user is colorblind, contrast first)
  frame: 'suggestion',   // info box border
  problem: 'error',      // failure lines — always prefixed with words ("Content unavailable", …)
} as const satisfies Record<string, ThemeKey>
export type Role = keyof typeof THEME
export const color = (role: Role): ThemeKey => THEME[role]
```
Roles map to engine `ThemeKey`s, never to hex or ANSI names, so the person's
Claude Code theme (including its daltonized/high-contrast themes) decides the
actual colors. If a role ever needs an explicit color, it is changed here and
only here, high-contrast and more saturated than a typical default.

**F-SPK-H02 — Rules for the Spark feature**
- `spark-nodes.tsx` passes `color` / `borderColor` only as `color('<role>')`;
  no string literal color, no `ThemeKey` literal, no `dimColor`.
- No state is conveyed by hue alone: open/closed by `▸`/`▾`, emphasis by
  `weight="bold"`, failures by explicit words.

**F-SPK-H03 — Follow-up (not in this change)**
`now-pane.tsx` hardcodes `'green'`, `'yellow'`, `'red'`, `'cyan'`
(`pillColor`, the dispatch pill). Migrating it to `hooks/theme.ts` roles is a
separate follow-up, recorded in the CHANGELOG's 0.5.0 entry as "not yet" and
in the README's now-pane section; this change must not touch `now-pane.tsx`.

---

## 7. State contract

**F-SPK-S01 — `types/index.d.ts`**
Add these exported types (self-contained, no imports) and keys under
`PluginState['anthill-claude']`:
```ts
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
```
```ts
'spark-status': SparkStatus                    // initial 'unknown'
'spark-nodes': Record<string, SparkNode>       // positive cache, by decimal key; initial {}
'spark-missing': Record<string, true>          // negative cache; initial {}
'spark-content': Record<string, SparkContent>  // by decimal key; initial {}
'spark-open': Record<string, number>           // site → open key; initial {}
'spark-expanded': Record<string, number>       // site → key whose content shows; initial {}
```
Atoms are declared in `spark-nodes.tsx` as
`atom({ plugin: 'anthill-claude', key: 'spark-…' } as const, <initial>)`.
`model.ts` imports `SparkNode`/`SparkContent` types from `../../../types`,
as `now-pane/model.ts` does. `claude plugin validate .` must pass.

---

## 8. Tests

**F-SPK-T01 — `tests/spark-nodes-mentions.spec.mjs`** (node --test, imports
`../hooks/features/spark-nodes/mentions.ts`): every row of the F-SPK-M03 table
as its own assertion, plus: distinct/first-appearance order; the cap (14
distinct mentions → first 12); fenced block with `~~~` and with a 4-backtick
fence containing a 3-backtick line; unclosed fence masks to the end; unmatched
single backtick leaves following `[3]` matchable; inline span across a newline;
`maskCode` keeps length and newlines; non-string input → `[]`.

**F-SPK-T02 — `tests/spark-nodes-model.spec.mjs`**: `infoArgv`, `contentArgv`
exact arrays (F-SPK-C01); `batches` (0, 1, 50, 51, 120 keys); `pendingKeys`
(positive, negative, in-flight excluded, order kept, duplicates removed);
`parseNodeLines` against fixtures:
- `tests/fixtures/spark-nodes/info.jsonl` — the two lines of F-SPK-C02's first
  example plus `{"key":3,"title":"Card vault","type":null,"summary":""}`;
- `tests/fixtures/spark-nodes/content.jsonl` — the two content lines of
  F-SPK-C02, plus `{"key":4,"title":"T","type":null,"summary":"","content":""}`
  (→ `null`);
- `tests/fixtures/spark-nodes/unknown-fields.jsonl` — a full record with
  `tags`, `aliases`, `last_modified_at`, `score` (ignored);
- inline cases: empty stdout → ok/empty; trailing blank lines ok; a garbage
  line, a JSON array line, `key: 0`, `key: "2"`, missing title → `{ ok: false }`;
  `type: 5` → `null`; missing summary → `''`;
`contentView` (under/at/over 60 lines and 4000 chars; `moreLines`); the chip
label truncation at 32.

**F-SPK-T03 — `tests/theme.spec.mjs`**: every `THEME` value is a member of the
engine's `ThemeKey` list (copied into the test as a literal array, with a
comment citing `claude-code.d.ts` `ThemeKey`); and a source scan of
`hooks/features/spark-nodes.tsx` finds no `color="`, no `borderColor="`, no
`dimColor`, and no quoted `ThemeKey` literal.

**F-SPK-T04 — `tests/spark-nodes.test.tsx`** (`claude plugin test .`, engine
kit as in `tests/now-pane.test.tsx`). The engine stub answers `process.run` by
exact argv (joined with spaces), records every call, and can be switched to
reject (missing binary), to exit 1, or to answer the old-Spark content error.
`session.messages` is stubbed to return messages whose `text` mentions keys.
Cases:
1. After `session.start` + one `turn.complete`, mounting an `AssistantMessage`
   with text `see [2] and [3] but not arr[1] or [99]` (Spark knows 2 and 3)
   shows Buttons `spark-chip:2` and `spark-chip:3` only; exactly one
   `spark query … --key 2 --key 3 --key 99` call was made (batched); no argv
   ever contains `show`.
2. A later `turn.complete` mentioning `[99]` again makes **no** new call
   (negative cache); `[2]` again makes no call (positive cache).
3. Pressing `spark-chip:2` shows the info box: title `Payments API`, `· component`,
   summary `Handles card payments`, Button `spark-content:2` labelled
   `Show content`; no content Text and no content call yet. Pressing the chip
   again removes the box.
4. Node 3 (`type: null`, `summary: ''`): box shows the title, no type text, no
   summary line.
5. Pressing `spark-content:2` makes exactly one `contentArgv(2)` call and shows
   `Owns the card flow.`; the label becomes `Hide content`; pressing it hides
   the content; pressing again shows it with **no** second call.
6. Content `null` → `no content` line.
7. Old Spark (content call exits 1 with `unknown field "content"`) →
   the `Content unavailable…` line; chips still work.
8. Same key in two messages (different text): opening it in one leaves the
   other closed.
9. Missing binary (`process.run` rejects): after the triggers, mounting the
   message draws only the engine row (no Button), and a second `turn.complete`
   makes no further `process.run` call.
10. Exit 1 on the info call: no chips; keys are not negatively cached (a later
    trigger retries); after 3 consecutive failures no more calls.
11. A `UserMessage` with `origin.kind: 'composer'` gets chips; one with
    another origin kind does not.
12. A message mentioning `ANT-5` and `[2]` in an anthill installation shows
    both `chip-open:ANT-5` and `spark-chip:2` (coexistence).
13. Cases 1, 3 and 5 loop over `['terminal', 'desktop'] as const`.

Baseline that must not regress: `node --test tests/` (36/37 today — the one
pre-existing failure is `tests/session-link.spec.mjs:91`, environmental) and
`claude plugin test .` (11/11 today) plus the new tests;
`claude plugin validate .` passes.

---

## 9. Files

Add:
- `hooks/theme.ts` — F-SPK-H01.
- `hooks/features/spark-nodes.tsx` — exports `sparkNodes: Register`; atoms,
  triggers (F-SPK-F01), resolver (F-SPK-F02), content fetch (F-SPK-F05), render
  hook (F-SPK-U01…U05).
- `hooks/features/spark-nodes/mentions.ts` — F-SPK-M01…M04.
- `hooks/features/spark-nodes/model.ts` — F-SPK-C01…C05, `contentView`, chip
  label, `hash`.
- `tests/spark-nodes-mentions.spec.mjs`, `tests/spark-nodes-model.spec.mjs`,
  `tests/theme.spec.mjs`, `tests/spark-nodes.test.tsx`.
- `tests/fixtures/spark-nodes/info.jsonl`, `content.jsonl`,
  `unknown-fields.jsonl`.

Modify:
- `hooks/register.tsx` — import and call `sparkNodes(on, options)` after
  `nowPane(on, options)`.
- `types/index.d.ts` — F-SPK-S01; update the header comment to mention
  `spark-nodes/model.ts` importing from it.
- `.claude-plugin/plugin.json` — `version` `0.5.0`; description appends
  `, Spark node chips for [n] mentions`.
- `.claude-plugin/marketplace.json` — the plugin entry's description, same text.
- `CHANGELOG.md` — new `## 0.5.0` section:
  - `spark-nodes: chips under assistant replies and composer prompts for Spark nodes mentioned as \`[n]\` (outside code, not links, footnotes or indexes); pressing a chip opens a box with the node's title, type and summary; "Show content" fetches the full content on demand. Data from \`spark query --json --all --fields …\` (batched, non-mutating; never \`spark show\`). Inert when \`spark\` is not on PATH. Needs \`spark\` with \`query-fields\`; "Show content" needs \`node-content\` (spark spec-json-output.md F-JSON-R07).`
  - `theme: \`hooks/theme.ts\`, one map from semantic roles to theme keys; the Spark chips use it. The Now pane's hardcoded colors are not migrated yet (follow-up).`
- `README.md` — feature bullet in "Features"; a `### Spark node chips`
  section in the Now pane section's format (what it shows table, mention
  rules, data source and argv, failure behavior, Files list, "Check it":
  with `spark` on PATH and a node `[n]`, write `[n]` in a prompt, see the chip,
  press it, press Show content); and a sentence under the Now pane section
  noting its colors are not yet on the theme module.

Not modified: `hooks/features/now-pane.tsx`, `now-pane/*`, existing tests.

---

## 10. Out of scope (this version)

- Keyboard access to chips (mouse-only, like the Anthill chips); a `/spark`
  command.
- Rendering content as Markdown.
- Expiring caches / live refresh of edited nodes beyond F-SPK-F06.
- Title-based mentions (no `[n]`), MCP fallback, `spark show`.

---

## 11. Amendment: Spark local workspaces (2026-11-20)

Spark gained project-local graphs (`spark/docs/specs/spec-local-workspace.md`).
A local workspace's nodes have qualified keys (`PAY-12`, display `[PAY-12]`);
a bare number (`12`) always means the user's global graph. Mentions carry both
forms (spec-mentions.md F-MEN-02, F-MEN-04). These requirements supersede the
parts of §1–§9 they name.

**F-SPK-L01 — Working directory (supersedes the "no `cwd`" line of F-SPK-D02)**
Every `$.process.run` for Spark passes `{ cwd: await $.session.cwd(), timeoutMs: 10_000 }`.
Spark resolves qualified keys against the local workspaces it discovers by
walking up from that directory (Spark F-LWS-D02). Without it, `PAY-12` could
resolve against the wrong project or none.

**F-SPK-L02 — Keys are canonical strings (supersedes number keys in F-SPK-M01, C04, C05, S01)**
- `extractMentions` returns `string[]`: canonical refs (`"12"`, `"PAY-12"`,
  prefix uppercased), de-duplicated on the canonical form.
- All caches (`spark-nodes`, `spark-missing`, `spark-content`) are keyed by the
  canonical ref string; `spark-open` / `spark-expanded` values are ref strings;
  `pendingKeys` and `batches` operate on strings; the in-flight set is a
  `Set<string>`.
- `SparkNode.key` becomes `string` (the canonical ref).
- Chip label and info-box header show `[${ref}]` (`[12]`, `[PAY-12]`); Button
  keys are `spark-chip:${ref}` and `spark-content:${ref}`; the "more lines"
  hint is `spark show --peek <ref>`.

**F-SPK-L03 — Argv and batching (supersedes F-SPK-C01's signatures)**
- `infoArgv(refs: string[])` / `contentArgv(ref: string)` produce the same
  argv shapes as F-SPK-C01 with each `--key` value being the ref string:
  `['spark','query','--json','--all','--fields','key,scope,ref,title,type,summary','--key','PAY-12','--key','12']`.
  `INFO_FIELDS` becomes `'key,scope,ref,title,type,summary'`, `CONTENT_FIELDS`
  `'key,scope,ref,title,type,summary,content'`. The plugin never passes
  `--global`: it must resolve qualified refs in the session's workspaces, and
  bare refs are global in every scope anyway (Spark F-LWS-K04).
- `batches` groups refs **by scope** before chunking: all bare refs form the
  global group; each distinct project key forms its own group; groups in first
  appearance order, each chunked at `MAX_KEYS_PER_BATCH`. One spawn therefore
  never mixes graphs, so a problem in one workspace cannot void another's
  chips.

**F-SPK-L04 — Parsing: identity is `ref` (amends F-SPK-C03)**
Spark's JSON node records carry `key` (always an integer — the number
*within* its scope, so `PAY-12` and global `12` both have `key: 12`), `scope`
(`"PAY"`, or `""` for global) and `ref` (`"PAY-12"` / `"12"`) (Spark
F-LWS-J01). Therefore:
- A line's identity is its `ref` when `ref` is a string matching the F-MEN-02
  Spark key form (canonicalised: prefix uppercased).
- When `ref` is **absent** (an older Spark without `local-workspaces`), the
  identity is `String(key)` for a positive safe integer `key` — valid only
  because such a Spark has no local workspaces, so its keys are all global.
- `ref` present but invalid, or `key` not a positive safe integer → the whole
  batch is `{ ok: false }`.
- `key` alone is never used as identity when `ref` is present; `scope` is
  informational (it must agree with `ref`'s prefix; a disagreement →
  `{ ok: false }`).
The requested-but-absent rule (negative cache) compares canonical ref strings.

**F-SPK-L05 — Outcomes for workspace batches (amends F-SPK-F02)**
For a batch of **qualified** refs (one project key):
| Outcome | Effect |
|---|---|
| exit 0 | as F-SPK-F02 (Spark skips refs of an unknown project key silently, Spark F-CLI-LWS-11, so they become negatively cached) |
| exit ≠ 0 and stderr contains `ambiguous` (two workspaces share the project key, Spark F-LWS-X02) | the batch's refs are negatively cached; one debug line; **not** counted as a failure |
| exit ≠ 0 otherwise (e.g. an older Spark rejecting a non-integer `--key`) | the batch's refs are negatively cached; one debug line; **not** counted as a failure |
| `run` rejects | as F-SPK-F02 |
Consecutive-failure counting and the `'unavailable'` switch apply to global
batches and to rejections only, so a Spark without local-workspace support
keeps showing global chips.

**F-SPK-L06 — Requires**
Qualified chips need Spark with capability `local-workspaces` (Spark
F-LWS-J02); global chips keep working with any Spark that has `query-fields`
(F-SPK-D01). The plugin still does not call `spark meta capabilities`.

**F-SPK-L07 — Tests (adds to F-SPK-T01…T04)**
- Mentions: the qualified cases of spec-mentions.md F-MEN-06.
- Model: `infoArgv(['PAY-12','12'])` exact array; `batches` groups
  `['12','PAY-1','40','OPS-2','PAY-3']` into `[['12','40'],['PAY-1','PAY-3'],['OPS-2']]`;
  `parseNodeLines` on `{"key":3,"scope":"PAY","ref":"PAY-3",…}` (→ `"PAY-3"`),
  on `{"key":12,"scope":"","ref":"12",…}` (→ `"12"`), on an old-Spark line
  `{"key":12,…}` (→ `"12"`); a batch holding both `{"key":3,"scope":"PAY","ref":"PAY-3"}`
  and `{"key":3,"scope":"","ref":"3"}` yields two distinct nodes; `{"key":3,"ref":"x"}`,
  `{"key":"3","ref":"3"}` and `{"key":3,"scope":"OPS","ref":"PAY-3"}` → `{ ok: false }`.
- Engine: every `process.run` call carries `cwd` equal to the session cwd; a
  message with `¤sp:PAY-3 and ¤sp:12` makes two calls (one per scope) and shows
  chips `[PAY-3]` and `[12]`; a qualified batch exiting 1 with
  `project key "PAY" is ambiguous` shows no `PAY` chip, still shows `[12]`, and
  does not flip `spark-status` after three such messages.
