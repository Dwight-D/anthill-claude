# anthill-claude

Claude Code mods (a Claude Code plugin) for Anthill sessions: UI, hooks, and other Claude-side behavior.

## Features

- **timestamps** — a dim `HH:MM:SS` line above each user message and each assistant reply.
- **language-sanitization** — rewrites wording that can trip model safeguards before it leaves the session, and shows a toast for each rewrite (see below).

### language-sanitization

Some harmless wording reads to the model safeguards as a request to extract model reasoning: a subagent brief asking to "write your reasoning trail" was refused at launch every time it was tried. This feature substitutes such wording with a plain equivalent and shows a toast in the chat:

```
Wording that can trip model safeguards: reasoning trail → evidence trail
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
- `tests/sanitize.spec.mjs` — `node --test tests/sanitize.spec.mjs` (Node 22.18+ / 23.6+, which runs `.ts` directly).

Not implemented: a meaning check (for example a Haiku call through `$.model`) confirming a rewrite kept the text's meaning before it is applied. The extension point is marked in `language-sanitization.tsx`; until then every substitution in the table is applied as written.

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
```

Add a feature: create `hooks/features/<name>.tsx` exporting a `Register`, then call it from `hooks/register.tsx`.
