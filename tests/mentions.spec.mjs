// Run: node --test tests/   Spec: docs/specs/spec-mentions.md F-MEN-06
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PROGRAMS, SIGIL, namespacedPattern, programFor } from '../hooks/mentions.ts'

test('the sigil is U+00A4', () => assert.equal(SIGIL, '¤'))

test('programFor resolves names and aliases case-insensitively', () => {
  assert.equal(programFor('spark'), 'spark')
  assert.equal(programFor('SP'), 'spark')
  assert.equal(programFor('Ah'), 'anthill')
  assert.equal(programFor('anthill'), 'anthill')
  for (const bad of ['jira', '', 's p']) assert.equal(programFor(bad), null)
  assert.deepEqual(Object.keys(PROGRAMS), ['spark', 'anthill'])
})

const spark = text => [...text.matchAll(namespacedPattern('spark', '[1-9][0-9]{0,8}'))].map(m => m[1])
const cases = [
  ['¤spark:123', ['123']],
  ['¤sp:7', ['7']],
  ['¤SP:7', ['7']],
  ['¤Spark:7', ['7']],
  ['(¤sp:7)', ['7']],
  ['¤sp:7.', ['7']],
  ['¤sp:7, ¤sp:8', ['7', '8']],
  ['x¤sp:7', []],
  ['¤sp:07', []],
  ['¤sp:7a', []],
  ['¤sp:7_x', []],
  ['¤sp: 7', []],
  ['*sp:7', []],
  ['¤spk:7', []],
]
for (const [text, want] of cases) test(`spark pattern ${JSON.stringify(text)}`, () => assert.deepEqual(spark(text), want))

test('anthill keys keep their own case rules', () => {
  const re = () => namespacedPattern('anthill', 'ANT-[1-9][0-9]*')
  assert.deepEqual([...'¤ah:ANT-5 ¤AH:ANT-6'.matchAll(re())].map(m => m[1]), ['ANT-5', 'ANT-6'])
  assert.deepEqual([...'¤ah:ant-5 ¤ah:ANT-5-3'.matchAll(re())], [])
})
