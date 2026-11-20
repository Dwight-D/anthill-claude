# anthill-claude

Claude Code mods (a Claude Code plugin) for Anthill sessions: UI, hooks, and other Claude-side behavior.

## Features

- **timestamps** — a dim `HH:MM:SS` line above each user message and each assistant reply.
- **language-sanitization** — rewrites wording that can trip model safeguards before it leaves the session, and shows a toast for each rewrite (see below).
- **session-correlation** — records which Claude Code session (and subagent) works which backlog item in the anthill sessions ledger (see below).
- **now-pane** — a docked "Anthill" pane listing the installation's active and validation backlog items, key chips under transcript rows that mention an item (`ANT-74` or `¤ah:ANT-74`), a detail view, a status-line count and the `/ant` command (see below).
- **spark-nodes** — chips under messages that mention a Spark node as `¤sp:n`; pressing one opens a box with the node's title, type and summary, and "Show content" fetches the full content on demand (see below). Colors come from `hooks/theme.ts`.

### language-sanitization

Some harmless wording reads to the model safeguards as a request to extract model reasoning: a subagent brief asking to "write your reasoning trail" was refused at launch every time it was tried. This feature substitutes such wording with a plain equivalent and shows a toast in the chat:

```
Wording that can trip model safeguards: reasoning trail → findings and rationale
```

Where it applies:

| Surface | Hook | Behavior |
| --- | --- | --- |
| Your own prompts | `prompt.submit` | substitutes and warns (slash-command lines and meta prompts are left alone) |
| Agent tool briefs (`prompt`) | `tool.call` `{ tool: 'Agent' }` | substitutes and warns |
| SendMessage messages (`message`) | `tool.call` `{ tool: 'SendMessage' }` | substitutes and warns |

Tool calls are rewritten, not just observed: a `tool.call` hook passes `next({ ...e, prompt })` and the subagent runs with the rewritten prompt. This covers calls made by the main session and by subagents. A hook that fails is skipped and the original text goes through unchanged.

Files:

- `hooks/features/language-sanitization/terms.ts` — the term table: one entry per pattern with `pattern` (regex source, case-insensitive, word-bounded), `replacement`, and `note` (why it trips safeguards). Add a term by adding an entry. It is a `.ts` module holding a JSON-shaped array because a hooks module can import only script files.
- `hooks/features/language-sanitization/sanitize.ts` — the pure substitution logic (no Claude imports).
- `hooks/features/language-sanitization.tsx` — the hooks.
- `tests/sanitize.spec.mjs` — run with the rest of the tests (Develop, below; Node 22.18+ / 23.6+, which runs `.ts` directly).

Not implemented: a meaning check (for example a Haiku call through `$.model`) confirming a rewrite kept the text's meaning before it is applied. The extension point is marked in `language-sanitization.tsx`; until then every substitution in the table is applied as written.

### session-correlation

Each `anthill backlog claim|deliver|close|block|release <id>` run through the Bash or PowerShell tool is recorded in the anthill sessions ledger (`.anthill/sessions/<session>[.<agent>].json`, owned by the CLI) by running `anthill session link`. A dashboard then knows which session, subagent and transcript work each item. Requires an `anthill` CLI with the `session` command group (Backlog v2 sessions); with an older CLI the hook logs the failure and does nothing else.

Two mechanisms, one writer (`anthill session link`):

| Mechanism | Where | What it links |
| --- | --- | --- |
| Classic PostToolUse command hook | `hooks/hooks.json` → `hooks/scripts/session-link.mjs` (Node, no dependencies) | `--session <session_id> --item <id> --verb <verb> --transcript <transcript_path> --cwd <cwd> --role <role>`, plus `--agent <agent_id>` when the payload carries one (a subagent's call) and `--handle <h>` from `--by <h>`. Role is `worker` when `CLAUDE_CODE_CHILD_SESSION` is set or the call came from a subagent, else `supervisor`. Works in every mode, including `claude -p`. |
| Mod `tool.call` handler | `hooks/features/session-correlation.tsx` | For a call made inside a subagent (`e.agentId` set): the `(session, agent)` record with `--agent`, `--handle` from `--by`, `--cwd`, `--role worker`, via `$.process.run`. |

`claim --next` takes its id from the command's output (`claimed <id>` or the id on the first line, or the `--json` view's `id`). A `claim` whose output does not name the id is a failed claim and links nothing. Commands that only mention the verbs (a commit message, `echo`) and `--help` are ignored.

The classic hook never breaks a session: it runs async, exits 0 on every failure (anthill missing, an older CLI, an unparsable command, a nonzero exit) and writes nothing to stdout or stderr. Failures are appended with a timestamp to `~/.claude/anthill-session-hook.log`. The mod handler logs its failures to the debug log (`claude --debug`).

Files:

- `hooks/scripts/parse-anthill-command.mjs` — the pure command parser and `session link` argv builder, imported by both mechanisms.
- `hooks/scripts/session-link.mjs` — the classic hook script.
- `hooks/features/session-correlation.tsx` — the mod handler.
- `tests/parse-anthill-command.spec.mjs`, `tests/session-link.spec.mjs` — parser cases, and the script run against a fake `anthill` on PATH.

Check it: in a new session with the plugin refreshed and a sessions-capable `anthill` on PATH, run `anthill backlog claim <id>` in an anthill project; `.anthill/sessions/<session>.json` then holds the item, the verb and the transcript path (`anthill session list`).

### Now pane and key chips

In a session whose cwd is an anthill installation (`<cwd>/.anthill/backlog/workstreams.md` with a `key-prefix:` line), the plugin keeps a pane beside the chat showing what the backlog holds right now, and marks every item key a transcript row mentions. Outside an installation the feature is inert: no pane, no chips, no status line. Needs `anthill` 0.2.0 or newer on PATH (item keys and `--json`).

What it shows:

| Surface | What | Source |
| --- | --- | --- |
| Pane `Anthill · ANT` (id `anthill-now`) | `ACTIVE (n)`: one row per in-progress item — key, status, claimant, session (8 chars), age, workstream, summary on a second line; `VALIDATION (n)` the same; `BLOCKED (n)` as a count; footer `ready a · proposed b · blocked c · ↻ <age> ago · turn <n>`. Seated inline (narrow terminal) each row is one line. | `anthill backlog list --active --json`, `anthill backlog list --json` (counts), `anthill session list --json` (ages, transcripts) |
| Detail view (press a row, a chip, or `/ant 74`) | Pane retitled `Anthill · ANT-74`: title, status and dispatch pills, `disposition · workstream · priority · risk`, claimed-by + session + age, reporter + created-at, verify, former-id when present, SUMMARY, ACCEPTANCE, the last three Log lines; buttons `copy key`, `open file` (appends `@<path>` to the prompt), `transcript` (toast with the ledger's transcript path), `back`. The pane's close mark while a detail is up goes back to the list; a second close closes the pane. | `anthill backlog show <key> --json`, cached per key until the next refresh |
| Key chips | Under each assistant reply and each composer prompt that mentions a key: one button per distinct key, `ANT-74 · <summary, 40 chars> · <status>` from the pane's cached rows (dim `ANT-74` alone when the item is not active). Hovering a chip reveals a card above the chip row, over the message text: key · status · dispatch · disposition · workstream, the summary, `claimed by <handle> · <age>` or `unclaimed`. The card is absolutely positioned, so revealing it moves neither the other chips nor the transcript; only the hovered chip's card shows. Pressing opens the detail view with the pane focused. Chips are mouse-only; from the keyboard use `/ant <key>`. | the pane's cached rows; no process call per row |
| Status line | `anthill ANT · 2 active · 1 validation`; cleared when both are zero | each refresh |
| `/ant` | No argument toggles the pane; `/ant 74`, `/ant ANT-74` or `/ant ant-74` opens that item's detail; `/ant help` lists the keys; anything else is a toast. | |

Keyboard: `ctrl+x tab` (or a click, or `/ant`) gives the pane the keyboard; Esc hands it back. In the list, `1`–`9` open the numbered row (ACTIVE then VALIDATION), Tab/arrows walk rows, Enter presses. In the detail view, `b` back, `c` copy key, `o` open file, `t` transcript.

Keys are matched case-sensitively and bound to the installation's prefix (`\bANT-[1-9][0-9]*\b`), so `UTF-8`, `SHA-256` or another installation's `BH-3` never become chips. The namespaced form `¤ah:ANT-74` / `¤anthill:ANT-74` also works (`/ant ¤ah:ANT-74` too); a bare key right after another program's namespace (`¤jira:ANT-74`, `¤sp:ANT-74`) is not an Anthill mention. See `docs/specs/spec-mentions.md`. Age is the sessions ledger's `last-seen` for the item, else the item's own claim/delivery stamp.

Refresh: on session start, after each turn of the main session, and after every `anthill backlog claim|deliver|close|block|release|new|triage|approve|renumber|set` run through the Bash or PowerShell tool. At most one refresh runs at a time; a trigger during one schedules one more. A failed command keeps the last good state and logs to the debug log. The pane opens by itself after the first refresh that finds an active or validation item (an unasked pane waits unplaced on a terminal narrower than 144 columns); `/ant` opens it at any width.

Its colors are hardcoded (`green`, `yellow`, `red`, `cyan`); they are not yet on the theme module `hooks/theme.ts` the Spark chips use. Migrating them is a follow-up.

Read-only in this version: the controller verbs (done / reject / release) stay in the TUI Now mode. The extension point is marked in `now-pane.tsx` (`DetailButtons`).

Files:

- `hooks/features/now-pane/keys.ts` — key extraction (incl. `¤ah:` forms), `/ant` argument resolution, `key-prefix:` read (pure).
- `hooks/features/now-pane/model.ts` — the CLI's JSON to rows, counts, ages, status and footer text, and the detail model (pure).
- `hooks/features/now-pane.tsx` — discovery, refresh, the pane, the chips, the command.
- `types/index.d.ts` — the `$.state` contract (`now-install`, `now`, `now-selected`, `now-details`), named by `plugin.json` `types`.
- `hooks/scripts/parse-anthill-command.mjs` — `REFRESH_VERBS` and `refreshVerb()` for the refresh trigger (session linking keeps `VERBS`).
- `tests/now-pane-keys.spec.mjs`, `tests/now-pane-model.spec.mjs` — the pure helpers, against `tests/fixtures/now-pane/*.json` (anthill 0.2.0's real `--json` output for this installation, plus a three-item variant in the same shape).
- `tests/now-pane.test.tsx` — the pane, chips and `/ant` through the engine's own test kit (`claude plugin test .`), with the CLI stubbed.

Check it: open a session in an anthill installation with the plugin loaded, mention `ANT-1` in a prompt and see the chip under it; `/ant` opens the pane; `/ant 1` opens the item's detail.

### Spark node chips

When a conversation message mentions a Spark node as `¤sp:<n>` (or `¤spark:<n>`; `¤` is U+00A4, the currency sign), a chip for it appears under the message, the way key chips do for Anthill items. Pressing a chip opens an in-flow box with the node's title, type and summary; a "Show content" button in the box fetches and shows the full content, never by default. Needs `spark` on PATH with `query-fields` (and `node-content` for "Show content"). Without `spark` the feature is inert: no chips, no toast, one debug-log line.

What it shows:

| Surface | What | Source |
| --- | --- | --- |
| Chip row | Under each assistant reply and each composer prompt: one button per distinct mentioned node that Spark knows, `[n] <title, 32 chars> ▸` (`▾` while its box is open). Mouse-only, like the Anthill chips. | the session cache; no process call per row |
| Info box | Pressing a chip opens a bordered box under the message: `[n]`, the full title, `· type` when set, the summary when set, and a `Show content` / `Hide content` button. One box per message; pressing the chip again closes it; the same node in another message is independent. | the session cache |
| Content | `Show content` fetches once and shows the first 60 lines / 4000 characters as plain text (a `… k more lines — spark show --peek n` line when cut). Failures say so in words: `Content unavailable: this spark has no node-content (update spark).`, `Content could not be loaded…`, `[n] no longer exists in Spark.` | `spark query --json --all --fields key,title,type,summary,content --key n` |

Mention rules: `¤sp:` or `¤spark:` (program name case-insensitive) + a positive integer (no leading zero, at most 9 digits), outside code (fenced blocks and inline spans are ignored), not directly after a letter, digit or `_`, and not directly followed by a letter, digit, `_` or `-`. The bare `[n]` form is no longer detected (it stays the display form in chips and Spark's CLI output). At most 12 distinct keys per message. See `docs/specs/spec-mentions.md` and `docs/specs/spec-spark-nodes.md` §2.

Data: scans run on session start (the last 200 messages), after each main-loop turn (the new messages) and on each composer prompt, and resolve unknown keys in batches of up to 50 with `spark query --json --all --fields key,title,type,summary --key n …` (serial, 10 s timeout, no `--db`: the database is whatever the Claude Code process inherits). It never runs `spark show` (an access event) or a write command. Found nodes and keys Spark does not know are cached for the session. If `spark` cannot be started the feature switches itself off; so does a third consecutive failed query.

Colors: every color goes through `hooks/theme.ts` (roles mapped to the person's Claude Code theme keys, high contrast, no dimmed text); open/closed is told by `▸`/`▾`, emphasis by bold, failures by words.

Files:

- `hooks/mentions.ts` — the program registry and namespaced-mention pattern shared by both features (pure).
- `hooks/features/spark-nodes/mentions.ts` — mention detection with code masking (pure).
- `hooks/features/spark-nodes/model.ts` — argv, JSON Lines parsing, cache bookkeeping, content cut, chip label (pure).
- `hooks/features/spark-nodes.tsx` — atoms, triggers, resolver, content fetch, the chips and the box.
- `hooks/theme.ts` — the one map from color roles to theme keys.
- `types/index.d.ts` — the `$.state` contract (`spark-status`, `spark-nodes`, `spark-missing`, `spark-content`, `spark-open`, `spark-expanded`).
- `tests/mentions.spec.mjs`, `tests/spark-nodes-mentions.spec.mjs`, `tests/spark-nodes-model.spec.mjs`, `tests/theme.spec.mjs` — the pure helpers and the theme rules, against `tests/fixtures/spark-nodes/*.jsonl`.
- `tests/spark-nodes.test.tsx` — the chips and box through the engine's test kit, with `spark` stubbed.

Check it: with `spark` on PATH and a node `n`, write `¤sp:n` in a prompt and see the chip under it; press it for the box; press Show content.

## Install

```
/plugin marketplace add Dwight-D/anthill-claude
/plugin install anthill-claude@anthill-claude
```

`anthill` installations pick this up from the framework's install guide (INSTALLATION.md, "Optional: Anthill Claude mod").

## Develop

```
claude --plugin-dir <path-to>/anthill-claude
claude plugin validate .
node --test tests/
claude plugin test .
```

`node --test tests/` runs `tests/index.js`, which loads every `tests/*.spec.mjs` (the pure helpers, under Node); `node --test "tests/*.spec.mjs"` runs them directly. `claude plugin test .` runs every `tests/*.test.tsx` through the engine's own test kit (hooks, panes, chips, commands).

Type-check: once a session has loaded the plugin, `.claude-plugin/types/` holds the API declarations and a `tsconfig.json` to extend, and `tsc -p .` checks it. Before that, a `tsconfig.json` kept outside the repo whose `include` names the `plugin-authoring` skill's `types/claude-code.d.ts` and this repo's `hooks`, `types` and `tests/*.test.tsx` does the same (the compiler options are in that file's header, plus `allowJs` for the `.mjs` import).

Add a feature: create `hooks/features/<name>.tsx` exporting a `Register`, then call it from `hooks/register.tsx`.
