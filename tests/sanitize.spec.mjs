// Run: node --test tests/sanitize.spec.mjs   (Node >= 22.18 / 23.6 strips TS types natively)
// Named *.spec.mjs, not *.test.ts, so `claude plugin test` does not pick it up.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitize, warning } from '../hooks/features/language-sanitization/sanitize.ts'
import { TERMS } from '../hooks/features/language-sanitization/terms.ts'

test('every seed term substitutes', () => {
  const cases = [
    ['write your reasoning trail', 'write your evidence trail'],
    ['keep a reasoning trace', 'keep a investigation trace'],
    ['show your chain-of-thought', 'show your step-by-step rationale'],
    ['show your chain of thought', 'show your step-by-step rationale'],
    ['explain your internal reasoning', 'explain your rationale'],
    ['dump the thinking blocks', 'dump the working notes'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(sanitize(input, TERMS).text, expected, input)
  }
})

test('match is case-insensitive and keeps a leading capital', () => {
  assert.equal(sanitize('REASONING TRAIL here', TERMS).text, 'Evidence trail here')
  assert.equal(sanitize('Reasoning Trail: write it', TERMS).text, 'Evidence trail: write it')
  assert.equal(sanitize('a reasoning-trail file', TERMS).text, 'a evidence trail file')
})

test('clean text is unchanged and reports nothing', () => {
  const clean = 'Implement the backlog item; report the commit shas and the test output.'
  const r = sanitize(clean, TERMS)
  assert.equal(r.text, clean)
  assert.deepEqual(r.fired, [])
})

test('word boundaries: no match inside other words', () => {
  const r = sanitize('reasoning trailhead', TERMS)
  assert.equal(r.text, 'reasoning trailhead')
  assert.equal(r.fired.length, 0)
})

test('reports which terms fired, with counts, and builds the warning', () => {
  const r = sanitize('Write your reasoning trail. Then a reasoning trail again, and your chain of thought.', TERMS)
  assert.deepEqual(
    r.fired.map(f => ({ match: f.match, replacement: f.replacement, count: f.count })),
    [
      { match: 'reasoning trail', replacement: 'evidence trail', count: 2 },
      { match: 'chain of thought', replacement: 'step-by-step rationale', count: 1 },
    ],
  )
  assert.ok(r.fired.every(f => f.note.length > 0))
  assert.equal(
    warning(r.fired),
    'Wording that can trip model safeguards: reasoning trail → evidence trail; chain of thought → step-by-step rationale',
  )
})
