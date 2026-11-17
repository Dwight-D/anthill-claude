// Run: node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { idFromClaimOutput, linkArgs, parseAnthillCommand as parse, refreshVerb } from '../hooks/scripts/parse-anthill-command.mjs'

test('each verb with a positional id', () => {
  assert.deepEqual(parse('anthill backlog claim cli-foo'), { verb: 'claim', item: 'cli-foo' })
  assert.deepEqual(parse('anthill backlog deliver cli-foo --evidence "tests pass; see log"'), { verb: 'deliver', item: 'cli-foo' })
  assert.deepEqual(parse('anthill backlog close cli-foo --done "shipped in 0.2.0"'), { verb: 'close', item: 'cli-foo' })
  assert.deepEqual(parse('anthill backlog block cli-foo "waiting on the user"'), { verb: 'block', item: 'cli-foo' })
  assert.deepEqual(parse('anthill backlog release cli-foo'), { verb: 'release', item: 'cli-foo' })
})

test('flags before the id and their values are skipped', () => {
  assert.deepEqual(parse('anthill backlog deliver --evidence "all green" cli-foo'), { verb: 'deliver', item: 'cli-foo' })
  assert.deepEqual(parse('anthill backlog close --reject "dup of x" cli-foo'), { verb: 'close', item: 'cli-foo' })
  assert.deepEqual(parse('anthill backlog deliver --evidence-file=out.txt cli-foo'), { verb: 'deliver', item: 'cli-foo' })
})

test('quoted reasons with separators do not split the command', () => {
  assert.deepEqual(parse(`anthill backlog block cli-foo "needs a decision; ask && wait | later"`), { verb: 'block', item: 'cli-foo' })
  assert.deepEqual(parse(`anthill backlog block cli-foo 'it is blocked; really'`), { verb: 'block', item: 'cli-foo' })
  assert.deepEqual(parse(`anthill backlog deliver cli-foo --evidence "said \\"done\\"; ok"`), { verb: 'deliver', item: 'cli-foo' })
})

test('--by is extracted, spaced or with =', () => {
  assert.deepEqual(parse('anthill backlog claim cli-foo --by cli-worker'), { verb: 'claim', item: 'cli-foo', by: 'cli-worker' })
  assert.deepEqual(parse('anthill backlog claim --by=cli-worker cli-foo'), { verb: 'claim', item: 'cli-foo', by: 'cli-worker' })
  assert.deepEqual(parse('anthill backlog claim --by "w 1" cli-foo'), { verb: 'claim', item: 'cli-foo', by: 'w 1' })
})

test('claim --next resolves the id from stdout', () => {
  assert.deepEqual(parse('anthill backlog claim --next', 'claimed cli-bar by w\nbody text\n'), { verb: 'claim', item: 'cli-bar' })
  assert.deepEqual(parse('anthill backlog claim --next --workstream cli', 'cli-bar\n## Description\n'), { verb: 'claim', item: 'cli-bar' })
  assert.deepEqual(parse('anthill backlog claim --next --by w1', 'claimed cli-bar by w1\n'), { verb: 'claim', item: 'cli-bar', by: 'w1' })
  assert.deepEqual(parse('anthill backlog claim --next --json', '{\n  "id": "cli-bar",\n  "title": "t"\n}'), { verb: 'claim', item: 'cli-bar' })
  assert.equal(parse('anthill backlog claim --next'), null)
  assert.equal(parse('anthill backlog claim --next', ''), null)
})

test('a claim whose output does not name the id is a failed claim', () => {
  assert.equal(parse('anthill backlog claim cli-foo', ''), null)
  assert.equal(parse('anthill backlog claim cli-foo', 'error: cli-foo is in-progress'), null)
  assert.deepEqual(parse('anthill backlog claim cli-foo', 'cli-foo\nbody'), { verb: 'claim', item: 'cli-foo' })
})

test('PowerShell and Bash forms', () => {
  const want = { verb: 'release', item: 'cli-foo' }
  assert.deepEqual(parse('cd E:\\proj && anthill backlog release cli-foo'), want)
  assert.deepEqual(parse('cd E:\\proj; anthill backlog release cli-foo'), want)
  assert.deepEqual(parse('& anthill backlog release cli-foo'), want)
  assert.deepEqual(parse('& "C:\\Tools\\anthill.exe" backlog release cli-foo'), want)
  assert.deepEqual(parse('anthill.exe backlog release cli-foo | Out-Null'), want)
  assert.deepEqual(parse('/usr/local/bin/anthill backlog release cli-foo 2>&1'), want)
  assert.deepEqual(parse('anthill backlog block cli-foo "PS says `"hi`"; later"'), { verb: 'block', item: 'cli-foo' })
})

test('non-matching commands return null', () => {
  for (const c of [
    'anthill backlog list --active',
    'anthill backlog new "a title" --value v',
    'anthill backlog claim --help',
    'anthill backlog claim',
    'anthill --json backlog claim cli-foo',
    'anthill session list',
    'git commit -m "anthill backlog claim cli-foo"',
    'echo anthill backlog claim cli-foo',
    'notanthill backlog claim cli-foo',
    '',
  ]) assert.equal(parse(c), null, c)
  assert.equal(parse(undefined), null)
})

test('idFromClaimOutput', () => {
  assert.equal(idFromClaimOutput('claimed a-b by x'), 'a-b')
  assert.equal(idFromClaimOutput('a-b\nrest'), 'a-b')
  assert.equal(idFromClaimOutput('{"id":"a-b"}'), 'a-b')
  assert.equal(idFromClaimOutput('{broken'), null)
  assert.equal(idFromClaimOutput(undefined), null)
})

test('linkArgs orders the session link flags', () => {
  assert.deepEqual(
    linkArgs({ verb: 'claim', item: 'i', by: 'w' }, { session: 's', agent: 'a', transcript: 't', cwd: 'c', role: 'worker' }),
    ['session', 'link', '--session', 's', '--agent', 'a', '--handle', 'w', '--item', 'i', '--verb', 'claim', '--transcript', 't', '--cwd', 'c', '--role', 'worker'],
  )
  assert.deepEqual(linkArgs({ verb: 'close', item: 'i' }, { session: 's' }), ['session', 'link', '--session', 's', '--item', 'i', '--verb', 'close'])
})

test('refreshVerb: any backlog verb that changes the Now pane, no id needed', () => {
  assert.equal(refreshVerb('anthill backlog claim ANT-5 --by w'), 'claim')
  assert.equal(refreshVerb('anthill backlog new "a title" --value "why"'), 'new')
  assert.equal(refreshVerb('anthill backlog triage ANT-3 --workstream dev'), 'triage')
  assert.equal(refreshVerb('anthill backlog approve ANT-3'), 'approve')
  assert.equal(refreshVerb('anthill backlog renumber --dry-run'), 'renumber')
  assert.equal(refreshVerb('anthill backlog set ANT-3 priority high'), 'set')
  assert.equal(refreshVerb('cd E:\proj; & anthill.exe backlog deliver ANT-5 --evidence "x"'), 'deliver')
  assert.equal(refreshVerb('anthill backlog list --active --json'), null)
  assert.equal(refreshVerb('anthill backlog show ANT-5 --json'), null)
  assert.equal(refreshVerb('anthill backlog claim --help'), null)
  assert.equal(refreshVerb('git commit -m "anthill backlog claim"'), null)
  assert.equal(refreshVerb(undefined), null)
})
