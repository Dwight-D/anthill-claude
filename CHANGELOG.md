# Changelog

## 0.4.2

- now-pane: the installation is discovered on demand from the session's cwd when `session.start` did not find it (cleared or resumed sessions, module reloads), instead of staying "no anthill installation in this session" for the whole session.

## 0.4.1

- now-pane: the key-chip hover card opens above the chip row as an absolutely positioned box, so a reveal no longer pushes the neighbouring chips aside or scrolls the transcript; each card lights only for its own chip in its own message.
- now-pane: keyboard hotkeys — `1`–`9` open pane rows; `b`/`c`/`o`/`t` press back / copy key / open file / transcript in the detail view; `/ant help` lists every key.

## 0.4.0

- now-pane: a docked `Anthill · <PREFIX>` pane listing the installation's active and validation backlog items (`anthill backlog list --active --json`, `list --json`, `session list --json`), refreshed on session start, after each turn and after each backlog verb; a detail view per item (`show --json`) with `copy key`, `open file`, `transcript` and `back`; key chips with a hover card under assistant replies and composer prompts that mention `<PREFIX>-N`; a status-line count; the `/ant` command (`/ant` toggles, `/ant 74` opens an item). Inert outside an installation. Needs `anthill` 0.2.0 (item keys).
- `$.state` contract in `types/index.d.ts` (`plugin.json` `types`).
- parse-anthill-command: `REFRESH_VERBS` and `refreshVerb()` for the pane's refresh trigger; `VERBS` and session linking unchanged.
- timestamps, session-correlation: the hooks are registered with one-of matchers (`{ component: [...] }`, `{ tool: [...] }`) instead of a loop, so `tsc -p .` type-checks the repo; behavior unchanged.
- Tests: `claude plugin test .` runs `tests/now-pane.test.tsx` beside the Node specs.

## 0.3.0

- session-correlation: `anthill backlog claim|deliver|close|block|release` commands are linked to the Claude Code session, subagent and transcript in the anthill sessions ledger via `anthill session link` (classic PostToolUse hook plus a mod `tool.call` handler). Needs an `anthill` CLI with the `session` commands.

## 0.2.0

- language-sanitization: rewrites wording that trips model safeguards in prompts, Agent briefs and SendMessage messages, with a toast.

## 0.1.0

- timestamps: `HH:MM:SS` above each user message and assistant reply.
