// Run: node --test tests/
// Feeds session-link.mjs a PostToolUse payload with a fake `anthill` on PATH
// that records its argv.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'scripts', 'session-link.mjs')
const SESSION = 'efcb0f1d-e40f-4e32-b676-4ea7a5bd2be0'

function sandbox({ withShim, shimExit = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'anthill hook '))
  const bin = join(dir, 'bin')
  const home = join(dir, 'home')
  const out = join(dir, 'argv.json')
  mkdirSync(bin)
  mkdirSync(home)
  if (withShim) {
    const shim = join(bin, 'shim.mjs')
    writeFileSync(shim, [
      `import { writeFileSync } from 'node:fs'`,
      `writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))`,
      `process.exit(${shimExit})`,
    ].join('\n'))
    if (process.platform === 'win32') {
      writeFileSync(join(bin, 'anthill.cmd'), `@"${process.execPath}" "${shim}" %*\r\n`)
    } else {
      writeFileSync(join(bin, 'anthill'), `#!/bin/sh\nexec "${process.execPath}" "${shim}" "$@"\n`)
      chmodSync(join(bin, 'anthill'), 0o755)
    }
  }
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k]
  delete env.CLAUDE_CODE_CHILD_SESSION
  env.PATH = bin // the real anthill must not be reachable
  env.HOME = home
  env.USERPROFILE = home
  return { dir, out, env, log: join(home, '.claude', 'anthill-session-hook.log') }
}

const transcript = dir => join(dir, 'projects', 'E--proj', `${SESSION}.jsonl`)

function payload(dir, command, stdout = '') {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: transcript(dir),
    cwd: dir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout, stderr: '', interrupted: false },
  })
}

const run = (env, input) => spawnSync(process.execPath, [SCRIPT], { input, env, encoding: 'utf8' })

test('claim --next runs session link with the exact argv', () => {
  const s = sandbox({ withShim: true })
  const r = run(s.env, payload(s.dir, 'anthill backlog claim --next --workstream cli', 'claimed cli-bar by supervisor:efcb0f1d\nbody\n'))
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, '')
  const got = JSON.parse(readFileSync(s.out, 'utf8'))
  assert.deepEqual(got.argv, [
    'session', 'link',
    '--session', SESSION,
    '--item', 'cli-bar',
    '--verb', 'claim',
    '--transcript', transcript(s.dir),
    '--cwd', s.dir,
    '--role', 'supervisor',
  ])
  assert.equal(got.cwd.toLowerCase(), s.dir.toLowerCase())
  assert.equal(existsSync(s.log), false)
})

test('a child session links as worker, with --handle from --by', () => {
  const s = sandbox({ withShim: true })
  s.env.CLAUDE_CODE_CHILD_SESSION = '1'
  const r = run(s.env, payload(s.dir, 'anthill backlog deliver cli-foo --evidence "green; see log" --by w1'))
  assert.equal(r.status, 0)
  const { argv } = JSON.parse(readFileSync(s.out, 'utf8'))
  assert.deepEqual(argv.slice(0, 10), ['session', 'link', '--session', SESSION, '--handle', 'w1', '--item', 'cli-foo', '--verb', 'deliver'])
  assert.deepEqual(argv.slice(-2), ['--role', 'worker'])
})

test('missing anthill exits 0 silently and logs', () => {
  const s = sandbox({ withShim: false })
  const r = run(s.env, payload(s.dir, 'anthill backlog release cli-foo'))
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, '')
  assert.match(readFileSync(s.log, 'utf8'), /^\d{4}-\d\d-\d\dT[\d:.]+Z anthill session link .* → anthill not found on PATH\n$/)
})

test('a failing anthill (older CLI, unknown verb) exits 0 silently and logs', () => {
  const s = sandbox({ withShim: true, shimExit: 1 })
  const r = run(s.env, payload(s.dir, 'anthill backlog close cli-foo --done'))
  assert.equal(r.status, 0)
  assert.equal(r.stdout + r.stderr, '')
  assert.match(readFileSync(s.log, 'utf8'), /→ exit 1/)
})

test('garbage stdin and untracked commands exit 0 silently', () => {
  const s = sandbox({ withShim: true })
  for (const input of ['not json', payload(s.dir, 'anthill backlog list'), '']) {
    const r = run(s.env, input)
    assert.equal(r.status, 0)
    assert.equal(r.stdout + r.stderr, '')
  }
  assert.equal(existsSync(s.out), false)
})
