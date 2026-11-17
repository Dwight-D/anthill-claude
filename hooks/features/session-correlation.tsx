import type { Register } from 'claude-code'

import { linkArgs, parseAnthillCommand } from '../scripts/parse-anthill-command.mjs'

// Subagent enrichment for the sessions ledger. The classic PostToolUse hook
// (hooks/scripts/session-link.mjs) links every `anthill backlog
// claim|deliver|close|block|release` to the session and its transcript; this
// handler adds the subagent's own record, keyed (session, agent), when the
// command ran inside a subagent (`e.agentId` set; undefined on the main loop),
// with the claimant handle from `--by`. Both write through `anthill session
// link`, so the ledger has one writer. Failures go to the debug log only.
export const sessionCorrelation: Register = on => {
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId || ran.deny !== undefined || ran.isError) return ran

    const result = ran.result as { stdout?: unknown; interrupted?: boolean } | undefined
    if (result?.interrupted) return ran
    const stdout = typeof result?.stdout === 'string' ? result.stdout : undefined
    const parsed = parseAnthillCommand(e.command, stdout)
    if (!parsed) return ran

    const agent = e.agentId
    void (async () => {
      try {
        const [session, cwd] = await Promise.all([$.session.id(), $.session.cwd()])
        const args = linkArgs(parsed, { session, agent, cwd, role: 'worker' })
        const { exitCode, stderr } = await $.process.run(['anthill', ...args], { cwd, timeoutMs: 10_000 })
        if (exitCode !== 0) {
          $.ui.log(`session-correlation: anthill ${args.join(' ')} → exit ${exitCode}: ${stderr.trim().split('\n')[0]}`, { to: 'debug' })
        }
      } catch (err) {
        $.ui.log(`session-correlation: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
      }
    })()

    return ran
  }).catch(($, e, next) => next(e)) // never refuse a command over this hook
}
