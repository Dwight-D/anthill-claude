# anthill-claude

Claude Code mods (a Claude Code plugin) for Anthill sessions: UI, hooks, and other Claude-side behavior.

## Features

- **timestamps** — a dim `HH:MM:SS` line above each user message and each assistant reply.

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
