# anthill-claude

Claude Code mods (a Claude Code plugin) for Anthill sessions: UI, hooks, and other Claude-side behavior.

## Features

- **timestamps** — a dim `HH:MM:SS` line above each user message and each assistant reply.
- **language-sanitization** — rewrites wording that can trip model safeguards before it leaves the session, and shows a toast for each rewrite (see below).
- **session-correlation** — records which Claude Code session (and subagent) works which backlog item in the anthill sessions ledger (see below).

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
```

`node --test tests/` runs `tests/index.js`, which loads every `tests/*.spec.mjs`; `node --test "tests/*.spec.mjs"` runs them directly.

Add a feature: create `hooks/features/<name>.tsx` exporting a `Register`, then call it from `hooks/register.tsx`.
