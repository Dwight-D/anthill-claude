// Run: node --test tests/   (Node >= 22.18 / 23.6 strips TS types natively)
// Named *.spec.mjs, not *.test.ts, so `claude plugin test` does not pick it up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildDetail, buildNow, countItems, findRow, footerText, formatAge, parseList, parseObject,
  sections, shortLogLine, statusText, toRow, truncate,
} from '../hooks/features/now-pane/model.ts'

// tests/fixtures/now-pane: `list-active.json`, `list-all.json`, `session-list.json`
// and `show-ANT-5.json` are `anthill` 0.2.0's own output against this
// installation (one active item). `list-active.3.json` and
// `session-list.3.json` follow the same shape with two active and one
// validation item.
const fixtures = join(import.meta.dirname, 'fixtures', 'now-pane')
const fx = name => readFileSync(join(fixtures, name), 'utf8')

const NOW = Date.parse('2026-11-17T14:46:23Z')

test('rows from the real CLI output', () => {
  const now = buildNow({
    active: parseList(fx('list-active.json')),
    all: parseList(fx('list-all.json')),
    sessions: parseList(fx('session-list.json')),
  }, NOW, 3)
  assert.equal(now.rows.length, 1)
  assert.equal(now.validation.length, 0)
  const [row] = now.rows
  assert.equal(row.key, 'ANT-5')
  assert.equal(row.status, 'in-progress')
  assert.equal(row.claimedBy, 'claude-pane')
  assert.equal(row.session8, '38acdb2e')
  assert.equal(row.workstream, 'dev')
  assert.match(row.summary, /^anthill-claude mod: docked Now pane/)
  assert.equal(row.ageMs, NOW - Date.parse('2026-11-17T14:46:12Z')) // the ledger's latest last-seen
  assert.match(row.transcript, /38acdb2e-2f54-4bd2-a2e8-29b22a9eec0f\.jsonl$/)
  assert.deepEqual(now.counts, { ready: 2, proposed: 4, blocked: 0 })
  assert.equal(now.refreshedAt, NOW)
  assert.equal(now.turn, 3)
})

test('two active, one validation, counts', () => {
  const now = buildNow({
    active: parseList(fx('list-active.3.json')),
    all: parseList(fx('list-all.json')),
    sessions: parseList(fx('session-list.3.json')),
  }, NOW, 18)
  assert.deepEqual(now.rows.map(r => r.key), ['ANT-5', 'ANT-66'])
  assert.deepEqual(now.validation.map(r => r.key), ['ANT-67'])
  const v = now.validation[0]
  assert.equal(v.status, 'validation')
  assert.equal(v.claimedBy, 'cli-w2')
  assert.equal(v.session8, '9f8e7d6c')
  assert.equal(formatAge(v.ageMs), '1m')
  assert.equal(formatAge(now.rows[1].ageMs), '4m')
  assert.equal(now.counts.proposed, 4)
  assert.equal(findRow(now, 'ANT-67')?.key, 'ANT-67')
  assert.equal(findRow(now, 'ANT-66')?.workstream, 'cli')
  assert.equal(findRow(now, 'ANT-99'), undefined)
  assert.equal(statusText('ANT', now), 'anthill ANT · 2 active · 1 validation')
  assert.equal(footerText(now, NOW + 2000), 'ready 2 · proposed 4 · blocked 0 · ↻ 2s ago · turn 18')
})

test('counts over every non-archived item', () => {
  assert.deepEqual(countItems([
    { id: 'X-1', ready: true, dispatch: 'approved', status: 'triaged' },
    { id: 'X-2', ready: false, dispatch: 'proposed', status: 'new' },
    { id: 'X-3', ready: false, dispatch: 'approved', status: 'blocked' },
    { id: 'X-4', ready: true, dispatch: 'proposed', status: 'blocked' },
  ]), { ready: 2, proposed: 2, blocked: 2 })
})

test('the status line clears when nothing is active', () => {
  const now = buildNow({ active: [], all: [], sessions: [] }, NOW, 1)
  assert.equal(statusText('ANT', now), undefined)
  assert.equal(now.rows.length, 0)
})

test('a row without a ledger record ages from its own stamps', () => {
  const row = toRow({ id: 'X-1', status: 'in-progress', 'claimed-at': '2026-11-17T14:00:00Z', 'claimed-by': 'w' }, [], NOW)
  assert.equal(formatAge(row.ageMs), '46m')
  assert.equal(row.session8, '')
  assert.equal(row.summary, '')
  const unknown = toRow({ id: 'X-2' }, [], NOW)
  assert.equal(unknown.ageMs, null)
  assert.equal(formatAge(unknown.ageMs), '?')
})

test('age and truncation formatting', () => {
  assert.equal(formatAge(0), '0s')
  assert.equal(formatAge(12_000), '12s')
  assert.equal(formatAge(59_999), '59s')
  assert.equal(formatAge(60_000), '1m')
  assert.equal(formatAge(4 * 60_000 + 5000), '4m')
  assert.equal(formatAge(3 * 3_600_000), '3h')
  assert.equal(formatAge(47 * 3_600_000), '47h')
  assert.equal(formatAge(48 * 3_600_000), '2d')
  assert.equal(truncate('short', 40), 'short')
  assert.equal(truncate('a'.repeat(50), 40).length, 40)
  assert.equal(truncate('a'.repeat(50), 40).endsWith('…'), true)
  assert.equal(truncate('two  words\nhere', 40), 'two words here')
})

test('lenient parsing', () => {
  assert.deepEqual(parseList('not json'), [])
  assert.deepEqual(parseList('{"id":"x"}'), [])
  assert.deepEqual(parseList('[1, null, {"id":"x"}]'), [{ id: 'x' }])
  assert.equal(parseObject('[]'), null)
  assert.equal(parseObject('nope'), null)
  assert.deepEqual(parseObject('{"id":"x"}'), { id: 'x' })
})

test('the detail from show --json', () => {
  const item = parseObject(fx('show-ANT-5.json'))
  const d = buildDetail(item, parseList(fx('session-list.json')), NOW)
  assert.equal(d.key, 'ANT-5')
  assert.equal(d.status, 'in-progress')
  assert.equal(d.dispatch, 'approved')
  assert.equal(d.disposition, 'auto')
  assert.equal(d.workstream, 'dev')
  assert.equal(d.priority, 'high')
  assert.equal(d.risk, 'additive')
  assert.equal(d.claimedBy, 'claude-pane')
  assert.equal(d.session8, '38acdb2e')
  assert.equal(d.reporter, 'user')
  assert.equal(d.createdAt, '2026-11-17T12:12:44Z')
  assert.match(d.verify, /^claude plugin validate/)
  assert.equal(d.formerId, 'anthill-claude-in-session-now-pane-showing-active')
  assert.match(d.path, /0005-anthill-claude-in-session-now-pane\.md$/)
  assert.match(d.transcript, /\.jsonl$/)
  assert.match(d.summary, /^anthill-claude mod: docked Now pane/)
  assert.equal(d.acceptance, '')
  assert.deepEqual(d.log, [
    '13:47Z approve by worker:38acdb2e',
    '14:45Z migrate schema 2 → 3 by anthill: anthill-claude-in-session-now-pane-showing-active → ANT-5',
    '14:46Z claim by claude-pane (session 38acdb2e…)',
  ])
})

test('body sections and log lines', () => {
  const sec = sections('## Description\nd1\nd2\n\n## Acceptance\n- a\n\n## Log\n- 2026-11-17T12:53:02Z one\n- 2026-11-17T14:02:00Z two\n')
  assert.equal(sec.description, 'd1\nd2')
  assert.equal(sec.acceptance, '- a')
  assert.equal(shortLogLine('- 2026-11-17T12:53:02Z migrate schema 1 → 2 by anthill'), '12:53Z migrate schema 1 → 2 by anthill')
  assert.equal(shortLogLine('- no stamp'), 'no stamp')
  assert.deepEqual(sections(''), {})
  const d = buildDetail({ id: 'X-1', value: 'the value', body: '## Description\nfrom body' }, [], NOW)
  assert.equal(d.summary, 'from body')
  assert.deepEqual(d.log, [])
})
