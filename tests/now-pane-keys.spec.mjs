// Run: node --test tests/   (Node >= 22.18 / 23.6 strips TS types natively)
// Named *.spec.mjs, not *.test.ts, so `claude plugin test` does not pick it up.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { extractKeys, keyNumber, keyPattern, parseKeyArg, readPrefix } from '../hooks/features/now-pane/keys.ts'

test('keys are extracted distinct, in order of first appearance', () => {
  assert.deepEqual(extractKeys('pick up ANT-74 and ANT-71 next; ANT-69 can wait, ANT-74 again', 'ANT'), ['ANT-74', 'ANT-71', 'ANT-69'])
  assert.deepEqual(extractKeys('(ANT-5) [ANT-12], ANT-3.', 'ANT'), ['ANT-5', 'ANT-12', 'ANT-3'])
  assert.deepEqual(extractKeys('ANT-7\nANT-8', 'ANT'), ['ANT-7', 'ANT-8'])
})

test('extraction is bound to the installation prefix', () => {
  assert.deepEqual(extractKeys('decode as UTF-8, hash with SHA-256, see RFC-2119', 'ANT'), [])
  assert.deepEqual(extractKeys('BH-3 is another installation; ANT-3 is ours', 'ANT'), ['ANT-3'])
  assert.deepEqual(extractKeys('BH-3 is ours here', 'BH'), ['BH-3'])
})

test('extraction is case-sensitive and word-bounded', () => {
  assert.deepEqual(extractKeys('ant-74 Ant-74 ANT-74', 'ANT'), ['ANT-74'])
  assert.deepEqual(extractKeys('XANT-74 ANT-74x ANT-074 ANT-0 ANT- ANT74', 'ANT'), [])
  assert.deepEqual(extractKeys('item ANT-10, not ANT-1', 'ANT'), ['ANT-10', 'ANT-1'])
})

test('an invalid prefix extracts nothing', () => {
  assert.equal(keyPattern('a'), null)
  assert.equal(keyPattern('TOOLONG'), null)
  assert.equal(keyPattern('an'), null)
  assert.deepEqual(extractKeys('ANT-1', ''), [])
  assert.deepEqual(extractKeys('', 'ANT'), [])
})

test('key numbers', () => {
  assert.equal(keyNumber('ANT-74'), 74)
  assert.equal(keyNumber('ANT-100'), 100)
  assert.ok(Number.isNaN(keyNumber('ANT-074')))
  assert.ok(Number.isNaN(keyNumber('74')))
})

test('a command argument resolves to a canonical key', () => {
  assert.equal(parseKeyArg('74', 'ANT'), 'ANT-74')
  assert.equal(parseKeyArg('ANT-74', 'ANT'), 'ANT-74')
  assert.equal(parseKeyArg('ant-74', 'ANT'), 'ANT-74')
  assert.equal(parseKeyArg('  ANT-74 ', 'ANT'), 'ANT-74')
  assert.equal(parseKeyArg('BH-74', 'ANT'), null)
  assert.equal(parseKeyArg('074', 'ANT'), null)
  assert.equal(parseKeyArg('', 'ANT'), null)
  assert.equal(parseKeyArg('x', 'ANT'), null)
})

test('the prefix is read from workstreams.md frontmatter', () => {
  assert.equal(readPrefix('---\nschema: 3\nkey-prefix: ANT\nsequence: 9\n---\n# Workstreams\n'), 'ANT')
  assert.equal(readPrefix('---\nkey-prefix: "bh"\n---\n'), 'BH')
  assert.equal(readPrefix('---\nkey-prefix: TOOLONG\n---\n'), null)
  assert.equal(readPrefix('# Workstreams\nno frontmatter'), null)
  assert.equal(readPrefix(''), null)
})
