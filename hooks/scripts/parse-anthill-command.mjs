// Pure parser for `anthill backlog <verb> …` command lines, shared by the
// classic PostToolUse hook (session-link.mjs) and the mod's tool.call handler
// (features/session-correlation.tsx). No Node or Claude imports.

/** The backlog verbs that move an item's ownership; each one links the session. */
export const VERBS = ['claim', 'deliver', 'close', 'block', 'release']

// Flags that take a value, per verb (`--flag value` or `--flag=value`).
const VALUE_FLAGS = new Set([
  '--by', '--session', '--workstream', '--evidence', '--evidence-file',
  '--reject', '--discard', '--remove', '--root',
])

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Splits a command line into segments on `&&`, `||`, `;`, `|` and newlines,
 * then each segment into words, honouring single and double quotes. Good
 * enough for Bash and PowerShell lines that invoke a CLI with plain args.
 * @param {string} command
 * @returns {string[][]}
 */
export function tokenize(command) {
  const segments = []
  let words = []
  let word = ''
  let inWord = false
  let quote = ''
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length) segments.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && (command[i + 1] === '"' || command[i + 1] === '\\')) word += command[++i]
      else if (c === '`' && quote === '"' && command[i + 1] === '"') word += command[++i]
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      inWord = true
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (c === '\n' || c === '\r' || c === ';') {
      endSegment()
    } else if ((c === '&' || c === '|') && command[i + 1] === c) {
      endSegment()
      i++
    } else if (c === '|') {
      endSegment()
    } else {
      word += c
      inWord = true
    }
  }
  endSegment()
  return segments
}

const isAnthill = w => /(^|[\\/])anthill(\.exe)?$/i.test(w)

/**
 * Pulls the item id out of a claim's output: a `claimed <id>` line (the
 * CLI's note, present when stderr is merged into the output), a JSON view's
 * `"id"`, or else the first line's first word (the CLI's answer is the id).
 * @param {string | undefined} stdout
 * @returns {string | null}
 */
export function idFromClaimOutput(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return null
  const text = stdout.trim()
  if (text.startsWith('{')) {
    try {
      const id = JSON.parse(text).id
      return typeof id === 'string' && ID.test(id) ? id : null
    } catch {
      return null
    }
  }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = /^claimed\s+(\S+)/.exec(line)
    if (m && ID.test(m[1])) return m[1]
  }
  const first = lines[0].split(/\s+/)[0]
  return ID.test(first) ? first : null
}

/**
 * Parses the first `anthill backlog <verb> …` segment of a command line.
 * `claim --next` takes its id from the tool's stdout; given stdout, a claim
 * counts only when the output names the claimed id (a failed claim prints none).
 * @param {string} command the shell command (Bash or PowerShell)
 * @param {string} [stdout] the command's output, for `claim --next`
 * @returns {{ verb: string, item: string, by?: string } | null} null when the
 *   line holds no tracked verb or no resolvable item id
 */
export function parseAnthillCommand(command, stdout) {
  if (typeof command !== 'string') return null
  for (let words of tokenize(command)) {
    if (words[0] === '&') words = words.slice(1) // PowerShell call operator
    if (!isAnthill(words[0] ?? '') || words[1] !== 'backlog') continue
    const verb = words[2]
    if (!VERBS.includes(verb)) return null

    let item = null
    let by
    let next = false
    let help = false
    for (let i = 3; i < words.length; i++) {
      const w = words[i]
      if (w.startsWith('--')) {
        const eq = w.indexOf('=')
        const name = eq < 0 ? w : w.slice(0, eq)
        const value = eq < 0 ? undefined : w.slice(eq + 1)
        if (name === '--next') next = true
        if (name === '--help') help = true
        if (VALUE_FLAGS.has(name)) {
          const v = value ?? words[++i]
          if (name === '--by' && v) by = v
        }
        continue
      }
      if (w.startsWith('-')) {
        if (w === '-h') help = true
        continue
      }
      if (item === null && ID.test(w)) item = w
    }
    if (help) return null
    if (verb === 'claim' && next && item === null) item = idFromClaimOutput(stdout)
    if (item === null) return null
    // A claim that failed (taken, not approved) prints no id: link nothing.
    if (verb === 'claim' && typeof stdout === 'string' && idFromClaimOutput(stdout) !== item) return null
    return by ? { verb, item, by } : { verb, item }
  }
  return null
}

/**
 * The `anthill session link` argv (after the binary) for a parsed command.
 * @param {{ verb: string, item: string, by?: string }} parsed
 * @param {{ session: string, agent?: string, transcript?: string, cwd?: string, role?: string }} ctx
 * @returns {string[]}
 */
export function linkArgs(parsed, ctx) {
  const args = ['session', 'link', '--session', ctx.session]
  if (ctx.agent) args.push('--agent', ctx.agent)
  if (parsed.by) args.push('--handle', parsed.by)
  args.push('--item', parsed.item, '--verb', parsed.verb)
  if (ctx.transcript) args.push('--transcript', ctx.transcript)
  if (ctx.cwd) args.push('--cwd', ctx.cwd)
  if (ctx.role) args.push('--role', ctx.role)
  return args
}
