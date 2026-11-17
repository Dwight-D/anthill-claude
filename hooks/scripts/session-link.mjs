#!/usr/bin/env node
// Classic PostToolUse hook: after a Bash/PowerShell `anthill backlog
// claim|deliver|close|block|release …`, records which Claude Code session
// (and transcript) works the item, via `anthill session link`.
//
// Never breaks the session: every failure is silent on stdout/stderr, exits
// 0, and is appended to ~/.claude/anthill-session-hook.log.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const LOG = join(homedir(), '.claude', 'anthill-session-hook.log')

function log(message) {
  try {
    mkdirSync(join(homedir(), '.claude'), { recursive: true })
    appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Nowhere left to report; stay silent.
  }
}

// Finds `anthill` on PATH. On Windows a .cmd/.bat shim needs cmd.exe; an
// .exe runs directly. Elsewhere the OS resolves the bare name.
function resolveAnthill() {
  if (process.platform !== 'win32') return { file: 'anthill', prefix: [] }
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of (process.env.PATH || process.env.Path || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, `anthill${ext.toLowerCase()}`)
      if (!existsSync(candidate)) continue
      if (/\.(cmd|bat)$/i.test(ext)) {
        return { file: process.env.ComSpec || 'cmd.exe', prefix: ['/d', '/s', '/c'], script: candidate }
      }
      return { file: candidate, prefix: [] }
    }
  }
  return null
}

function runAnthill(args, cwd) {
  const bin = resolveAnthill()
  if (!bin) return { error: 'anthill not found on PATH' }
  let file = bin.file
  let argv = args
  let options = { cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true }
  if (bin.script) {
    // cmd.exe /s /c "<script> "arg" …": one quoted line, args quoted whole.
    const line = [bin.script, ...args].map(a => `"${String(a).replace(/"/g, '')}"`).join(' ')
    argv = [...bin.prefix, `"${line}"`]
    options = { ...options, windowsVerbatimArguments: true }
  }
  const r = spawnSync(file, argv, options)
  if (r.error) return { error: `${r.error.code || ''} ${r.error.message}`.trim() }
  if (r.status !== 0) return { error: `exit ${r.status}: ${(r.stderr || '').trim().split(/\r?\n/)[0]}` }
  return {}
}

async function main() {
  // Imported here, not statically, so even a broken parser module is logged
  // and exits 0 instead of failing the hook.
  const { linkArgs, parseAnthillCommand } = await import('./parse-anthill-command.mjs')

  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch (err) {
    log(`stdin unreadable: ${err.message}`)
    return
  }
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    log('stdin is not JSON')
    return
  }

  const command = input?.tool_input?.command
  const response = input?.tool_response
  if (response?.interrupted) return
  const stdout = typeof response?.stdout === 'string' ? response.stdout : undefined

  const parsed = parseAnthillCommand(command, stdout)
  if (!parsed) {
    if (typeof command === 'string' && /\banthill(\.exe)?\s+backlog\s+(claim|deliver|close|block|release)\b/i.test(command)) {
      log(`no item resolved (or claim failed): ${command.slice(0, 200)}`)
    }
    return
  }
  if (!input.session_id) {
    log(`no session_id in payload for: ${command.slice(0, 200)}`)
    return
  }

  const agent = typeof input.agent_id === 'string' ? input.agent_id : undefined
  const role = process.env.CLAUDE_CODE_CHILD_SESSION || agent ? 'worker' : 'supervisor'
  const args = linkArgs(parsed, {
    session: input.session_id,
    agent,
    transcript: input.transcript_path,
    cwd: input.cwd,
    role,
  })
  const result = runAnthill(args, input.cwd || process.cwd())
  if (result.error) log(`anthill ${args.join(' ')} → ${result.error}`)
}

try {
  await main()
} catch (err) {
  log(`unexpected: ${err?.stack || err}`)
}
process.exitCode = 0
