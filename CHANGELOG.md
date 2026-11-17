# Changelog

## 0.3.0

- session-correlation: `anthill backlog claim|deliver|close|block|release` commands are linked to the Claude Code session, subagent and transcript in the anthill sessions ledger via `anthill session link` (classic PostToolUse hook plus a mod `tool.call` handler). Needs an `anthill` CLI with the `session` commands.

## 0.2.0

- language-sanitization: rewrites wording that trips model safeguards in prompts, Agent briefs and SendMessage messages, with a toast.

## 0.1.0

- timestamps: `HH:MM:SS` above each user message and assistant reply.
