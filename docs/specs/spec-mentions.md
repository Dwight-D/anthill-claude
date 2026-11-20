# spec-mentions — namespaced key mentions

Status: specified 2026-11-20. Applies to every feature that turns a key
mentioned in message text into a chip (today: `spark-nodes`, `now-pane`).

## Why

Several of the user's tools use short, similar keys (`12`, `ANT-74`). Bare
forms collide with each other and with ordinary text (`[1]` footnotes,
`arr[1]`). A mention therefore names its program explicitly.

## F-MEN-01 — Notation

```
¤<program>:<key>
```

- `¤` is U+00A4 CURRENCY SIGN (the "sigil"). It was chosen because it is
  available on the user's mobile keyboard, rare in prose and code, and not
  markdown syntax. Only U+00A4 counts; `*`, `$`, `#`, `@` do not.
- `<program>` is a program's canonical name or its alias, matched
  **case-insensitively** (mobile keyboards auto-capitalize: `¤Sp:12` is fine).
- `:` separates; no spaces anywhere inside a mention.
- `<key>` is the program's key form (F-MEN-02), case as the program defines.

## F-MEN-02 — Program registry

One pure module, `hooks/mentions.ts`, is the single place programs are named:

```ts
export const SIGIL = '¤'
export const PROGRAMS = {
  spark: ['spark', 'sp'],
  anthill: ['anthill', 'ah'],
} as const satisfies Record<string, readonly string[]>
export type Program = keyof typeof PROGRAMS
/** Program for a name or alias (case-insensitive), or null. */
export const programFor = (name: string): Program | null
/**
 * Global, Unicode regex matching `¤<name>:<key>` for one program, where
 * `keySource` is the key's regex source. Group 1 is the key.
 */
export const namespacedPattern = (program: Program, keySource: string): RegExp
```

| Program | Names | Key form | Example |
|---|---|---|---|
| spark | `spark`, `sp` | `[1-9][0-9]{0,8}` (positive integer, no leading zero) | `¤spark:123`, `¤sp:123` |
| anthill | `anthill`, `ah` | `<PREFIX>-[1-9][0-9]*`, `<PREFIX>` = the installation's key prefix, case-sensitive | `¤anthill:ANT-123`, `¤ah:ANT-123` |

Adding a program later = one entry here + its feature; nothing else parses
the sigil.

## F-MEN-03 — Boundaries

A namespaced mention matches only when:
- the character before `¤` is not a Unicode letter, number or `_`
  (`[\p{L}\p{N}_]`); start of text is allowed;
- the character after the key is not a Unicode letter, number, `_` or `-`
  (so `¤sp:12a`, `¤sp:12_x`, `¤ah:ANT-12-3` do not match); end of text and
  punctuation (`.`, `,`, `)`, `]`, `:`) are allowed.

Equivalent shape (normative intent):
```js
new RegExp(`(?<![\\p{L}\\p{N}_])\\u00A4(?:${names})(?::)(${keySource})(?![\\p{L}\\p{N}_-])`, 'gu')
```
with `names` the program's names made case-insensitive per character
(e.g. `[sS][pP]`) so the key part keeps its own case rules (no `i` flag).

## F-MEN-04 — Spark: namespaced form only

Spark node mentions are **only** `¤spark:<n>` / `¤sp:<n>`. The bare `[n]` form
is no longer detected (it stays Spark's *display* form in chip labels and CLI
output). Code masking (spec-spark-nodes.md F-SPK-M02) still applies first: a
mention inside inline or fenced code is not a mention. The per-message cap
(F-SPK-M04) is unchanged. This supersedes F-SPK-M03's `[n]` pattern.

## F-MEN-05 — Anthill: namespaced form plus the bare form

Anthill item mentions are either:
- the existing bare form `<PREFIX>-<n>` (unchanged, now-pane `keyPattern`), or
- `¤anthill:<PREFIX>-<n>` / `¤ah:<PREFIX>-<n>`.

**Foreign namespaces exclude.** A bare-form match that is immediately preceded
by `¤<name>:` where `<name>` is any run of `[\p{L}\p{N}_-]` that is *not* an
anthill name (case-insensitive) is **not** an anthill mention — e.g.
`¤jira:ANT-12` or `¤sp:ANT-12` yields nothing. This is what lets other tools
with `ABC-123`-shaped keys share the notation.

Both forms feed the same de-duplicated, first-appearance-order key list;
`¤ah:ANT-5 and ANT-5` is one key. No code masking is added to anthill (bare
form behavior stays exactly as before).

`/ant <arg>` (`parseKeyArg`) additionally accepts `¤ah:ANT-74` /
`¤anthill:ANT-74` as an argument, resolving like `ANT-74`.

## F-MEN-06 — Tests

`tests/mentions.spec.mjs` (pure):
- `programFor`: `spark`, `SP`, `Ah`, `anthill` resolve; `jira`, `''`, `s p` → null.
- `namespacedPattern('spark', …)` on: `¤spark:123` → 123; `¤sp:7` → 7;
  `¤SP:7` → 7; `(¤sp:7)` → 7; `¤sp:7.` → 7; `x¤sp:7` → none; `¤sp:07` → none;
  `¤sp:7a` → none; `¤sp: 7` → none; `*sp:7` → none; `¤spk:7` → none.

Spark (`tests/spark-nodes-mentions.spec.mjs`): replace the `[n]` table with:
`see ¤sp:12 and ¤spark:40.` → 12, 40; `¤sp:12 ¤spark:12` → 12; `[12]` → none;
`` `¤sp:12` `` → none; fenced `¤sp:12` → none; `¤ah:12` → none;
`¤sp:0`, `¤sp:1234567890` → none; cap at 12 still holds.

Anthill (`tests/now-pane-keys.spec.mjs`, prefix `ANT`): `¤ah:ANT-5` → ANT-5;
`¤Anthill:ANT-5` → ANT-5; `¤ah:ANT-5 and ANT-5` → [ANT-5]; `¤jira:ANT-5` → none;
`¤sp:ANT-5` → none; `¤ah:ant-5` → none; existing bare-form cases unchanged;
`parseKeyArg('¤ah:ANT-74')` resolves like `ANT-74`.

Engine (`tests/spark-nodes.test.tsx`): mounted messages use `¤sp:<n>`; add one
case showing `[n]` alone produces no chips and no process call.
