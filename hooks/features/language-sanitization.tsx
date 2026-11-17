import type { Register } from 'claude-code'

import { sanitize, warning } from './language-sanitization/sanitize'
import { TERMS } from './language-sanitization/terms'

const TOAST_MS = 8000

// EXTENSION POINT (meaning check, not implemented): a model call (e.g. Haiku
// via `$.model`) could confirm that a rewrite kept the text's meaning before
// it is applied. It sits between `sanitize` and `next` in each hook below,
// taking the original and the rewritten text and answering keep or revert.
// Until it exists, every substitution is applied as the term table states.

// Rewrites wording that trips model safeguards before it leaves the session,
// and says so in the chat: the person's own prompts, Agent tool briefs, and
// SendMessage messages (main session and subagents alike).
export const languageSanitization: Register = on => {
  on('prompt.submit', ($, e, next) => {
    // A slash command's line takes no rewrite; a meta prompt was not typed.
    if (e.command || e.isMeta) return next(e)

    const { text, fired } = sanitize(e.text, TERMS)
    if (fired.length === 0) return next(e)

    $.ui.toast(warning(fired), { timeoutMs: TOAST_MS })
    return next({ ...e, text })
  })

  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    const { text, fired } = sanitize(e.prompt, TERMS)
    if (fired.length === 0) return next(e)

    $.ui.toast(warning(fired), { timeoutMs: TOAST_MS })
    return next({ ...e, prompt: text })
  })

  on('tool.call', { tool: 'SendMessage' }, ($, e, next) => {
    if (typeof e.message !== 'string') return next(e)

    const { text, fired } = sanitize(e.message, TERMS)
    if (fired.length === 0) return next(e)

    $.ui.toast(warning(fired), { timeoutMs: TOAST_MS })
    return next({ ...e, message: text })
  })
}
