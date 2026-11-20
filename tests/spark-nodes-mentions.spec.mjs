// Run: node --test tests/   Spec: docs/specs/spec-spark-nodes.md F-SPK-T01
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_KEYS_PER_MESSAGE, canonicalRef, extractMentions, maskCode, refScope } from '../hooks/features/spark-nodes/mentions.ts'

const cases = [
  ['see ¤sp:12 and ¤spark:40.', ['12', '40']],
  ['¤sp:12 ¤spark:12', ['12']],
  ['[12]', []],
  ['see [12] and [3]', []],
  ['`¤sp:12`', []],
  ['```\n¤sp:12\n```', []],
  ['¤ah:12', []],
  ['¤sp:0', []],
  ['¤sp:1234567890', []],
]
for (const [text, want] of cases) {
  test(`mentions ${JSON.stringify(text)}`, () => assert.deepEqual(extractMentions(text), want))
}

test('first-appearance order, distinct', () => assert.deepEqual(extractMentions('¤sp:5 ¤sp:3 ¤sp:5 ¤sp:9 ¤sp:3'), ['5', '3', '9']))

test('the cap is 12 distinct keys', () => {
  const text = Array.from({ length: 14 }, (_, i) => `¤sp:${i + 1}`).join(' ')
  assert.equal(MAX_KEYS_PER_MESSAGE, 12)
  assert.deepEqual(extractMentions(text), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
})

test('tilde fence and a 4-backtick fence containing a 3-backtick line', () => {
  assert.deepEqual(extractMentions('~~~\n¤sp:1\n~~~\n¤sp:2'), ['2'])
  assert.deepEqual(extractMentions('````\n```\n¤sp:1\n```\n¤sp:2\n````\n¤sp:3'), ['3'])
})

test('an unclosed fence masks to the end', () => assert.deepEqual(extractMentions('¤sp:1\n```\n¤sp:2\n¤sp:3'), ['1']))

test('an unmatched backtick leaves following text matchable', () => assert.deepEqual(extractMentions('a ` b ¤sp:3'), ['3']))

test('an inline span may cross a newline', () => assert.deepEqual(extractMentions('`a\n¤sp:1` ¤sp:2'), ['2']))

test('maskCode keeps length and newlines', () => {
  const t = 'a `b\nc` d\n```\nx\n```\ne'
  const m = maskCode(t)
  assert.equal(m.length, t.length)
  assert.deepEqual([...m].map((c, i) => c === '\n' && t[i] === '\n'), [...t].map(c => c === '\n'))
  assert.equal(m, 'a __\n__ d\n___\n_\n___\ne')
})

test('non-string or empty input', () => {
  assert.deepEqual(extractMentions(undefined), [])
  assert.deepEqual(extractMentions(5), [])
  assert.deepEqual(extractMentions(''), [])
  assert.equal(maskCode(null), '')
})

const qualified = [
  ['¤sp:PAY-12', ['PAY-12']],
  ['¤sp:pay-12', ['PAY-12']],
  ['¤Spark:Pay-12', ['PAY-12']],
  ['¤sp:PAY-12 ¤sp:pay-12', ['PAY-12']],
  ['¤sp:PAY-12 ¤sp:12', ['PAY-12', '12']],
  ['¤sp:ANT-5', ['ANT-5']],
  ['(¤sp:PAY-12).', ['PAY-12']],
  ['¤sp:P-12', []],
  ['¤sp:ABCDEFGHIJK-1', []],
  ['¤sp:PA1-2', []],
  ['¤sp:PAY-012', []],
  ['¤sp:PAY-0', []],
  ['¤sp:PAY12', []],
  ['¤sp:PAY-', []],
  ['¤sp:PAY-12-3', []],
  ['¤sp:PAY-12a', []],
  ['`¤sp:PAY-12`', []],
]
for (const [text, want] of qualified) {
  test(`qualified mentions ${JSON.stringify(text)}`, () => assert.deepEqual(extractMentions(text), want))
}

test('canonicalRef and refScope', () => {
  assert.equal(canonicalRef('pay-12'), 'PAY-12')
  assert.equal(canonicalRef('12'), '12')
  for (const bad of ['', 'x', 'P-1', 'PAY-0', '012', 5, null]) assert.equal(canonicalRef(bad), null, String(bad))
  assert.equal(refScope('PAY-12'), 'PAY')
  assert.equal(refScope('12'), '')
})
