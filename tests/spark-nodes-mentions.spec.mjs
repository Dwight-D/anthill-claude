// Run: node --test tests/   Spec: docs/specs/spec-spark-nodes.md F-SPK-T01
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_KEYS_PER_MESSAGE, extractMentions, maskCode } from '../hooks/features/spark-nodes/mentions.ts'

const cases = [
  ['see [12] and [40].', [12, 40]],
  ['([3])', [3]],
  ['**[3]**', [3]],
  ['- [3] item', [3]],
  ['[3]\n', [3]],
  ['[12] then [12] again', [12]],
  ['`see [12]`', []],
  ['```\n[12]\n```', []],
  ['`x`[1]', []],
  ['arr[0]', []],
  ['arr[1]', []],
  ['a[12]', []],
  ['é[2]', []],
  ['_[2]', []],
  ['[01]', []],
  ['[0]', []],
  ['[1234567890]', []],
  ['[-1]', []],
  ['[1.5]', []],
  ['[ 1 ]', []],
  ['[1](https://x)', []],
  ['[1]: https://x', []],
  ['[1][ref]', []],
  ['[text][1]', []],
  ['[[1]]', []],
  ['![1]', []],
  ['[^1]', []],
  ['[^1]: note', []],
  ['- [ ] task', []],
  ['- [x] done', []],
  ['[X]', []],
  ['see [1]: it…', []],
]
for (const [text, want] of cases) {
  test(`mentions ${JSON.stringify(text)}`, () => assert.deepEqual(extractMentions(text), want))
}

test('first-appearance order, distinct', () => assert.deepEqual(extractMentions('[5] [3] [5] [9] [3]'), [5, 3, 9]))

test('the cap is 12 distinct keys', () => {
  const text = Array.from({ length: 14 }, (_, i) => `[${i + 1}]`).join(' ')
  assert.equal(MAX_KEYS_PER_MESSAGE, 12)
  assert.deepEqual(extractMentions(text), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('tilde fence and a 4-backtick fence containing a 3-backtick line', () => {
  assert.deepEqual(extractMentions('~~~\n[1]\n~~~\n[2]'), [2])
  assert.deepEqual(extractMentions('````\n```\n[1]\n```\n[2]\n````\n[3]'), [3])
})

test('an unclosed fence masks to the end', () => assert.deepEqual(extractMentions('[1]\n```\n[2]\n[3]'), [1]))

test('an unmatched backtick leaves following text matchable', () => assert.deepEqual(extractMentions('a ` b [3]'), [3]))

test('an inline span may cross a newline', () => assert.deepEqual(extractMentions('`a\n[1]` [2]'), [2]))

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
