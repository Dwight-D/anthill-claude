// Run: node --test tests/   Spec: docs/specs/spec-spark-nodes.md F-SPK-T02
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  batches, chipLabel, contentArgv, contentView, hash, infoArgv, isSpawnFailure, parseNodeLines, pendingKeys,
} from '../hooks/features/spark-nodes/model.ts'

const fixture = name => readFileSync(new URL(`./fixtures/spark-nodes/${name}`, import.meta.url), 'utf8')

test('argv shapes', () => {
  assert.deepEqual(infoArgv([12, 40]), ['spark', 'query', '--json', '--all', '--fields', 'key,title,type,summary', '--key', '12', '--key', '40'])
  assert.deepEqual(contentArgv(12), ['spark', 'query', '--json', '--all', '--fields', 'key,title,type,summary,content', '--key', '12'])
})

test('batches', () => {
  const ks = n => Array.from({ length: n }, (_, i) => i + 1)
  assert.deepEqual(batches([]), [])
  assert.deepEqual(batches(ks(1)).map(b => b.length), [1])
  assert.deepEqual(batches(ks(50)).map(b => b.length), [50])
  assert.deepEqual(batches(ks(51)).map(b => b.length), [50, 1])
  assert.deepEqual(batches(ks(120)).map(b => b.length), [50, 50, 20])
  assert.deepEqual(batches([1, 2, 3], 2), [[1, 2], [3]])
})

test('pendingKeys excludes cached, missing and in-flight; keeps order; de-duplicates', () => {
  assert.deepEqual(pendingKeys([5, 1, 2, 3, 4, 5, 1], { 1: {} }, { 2: true }, new Set([3])), [5, 4])
  assert.deepEqual(pendingKeys([], {}, {}, new Set()), [])
})

test('parseNodeLines: info fixture', () => {
  const r = parseNodeLines(fixture('info.jsonl'))
  assert.equal(r.ok, true)
  assert.deepEqual(r.nodes, [
    { key: 1, title: 'Me', type: null, summary: '' },
    { key: 2, title: 'Payments API', type: 'component', summary: 'Handles card payments' },
    { key: 3, title: 'Card vault', type: null, summary: '' },
  ])
  assert.deepEqual(r.contents, {})
})

test('parseNodeLines: content fixture', () => {
  const r = parseNodeLines(fixture('content.jsonl'))
  assert.equal(r.ok, true)
  assert.deepEqual(r.contents, { 2: 'Owns the card flow.', 3: null, 4: null })
})

test('parseNodeLines: unknown properties are ignored', () => {
  const r = parseNodeLines(fixture('unknown-fields.jsonl'))
  assert.deepEqual(r, { ok: true, nodes: [{ key: 2, title: 'Payments API', type: 'component', summary: 'Handles card payments' }], contents: {} })
})

test('parseNodeLines: empty and blank lines', () => {
  assert.deepEqual(parseNodeLines(''), { ok: true, nodes: [], contents: {} })
  assert.equal(parseNodeLines('{"key":1,"title":"a"}\n\n  \n').ok, true)
})

test('parseNodeLines: corrupt answers are not ok', () => {
  for (const bad of ['garbage', '[1]', '{"key":0,"title":"a"}', '{"key":"2","title":"a"}', '{"key":2}', '{"key":1,"title":"a"}\nnope'])
    assert.deepEqual(parseNodeLines(bad), { ok: false }, bad)
})

test('parseNodeLines: type and summary coercion', () => {
  const r = parseNodeLines('{"key":1,"title":"a","type":5}')
  assert.deepEqual(r.nodes[0], { key: 1, title: 'a', type: null, summary: '' })
})

test('contentView cuts at 60 lines / 4000 characters', () => {
  const lines = n => Array.from({ length: n }, (_, i) => `l${i}`).join('\n')
  assert.deepEqual(contentView(lines(59)), { text: lines(59), moreLines: 0 })
  assert.deepEqual(contentView(lines(60)), { text: lines(60), moreLines: 0 })
  assert.deepEqual(contentView(lines(61)), { text: lines(60), moreLines: 1 })
  assert.deepEqual(contentView(lines(100)), { text: lines(60), moreLines: 40 })
  assert.deepEqual(contentView('x'.repeat(3999)), { text: 'x'.repeat(3999), moreLines: 0 })
  assert.deepEqual(contentView('x'.repeat(4000)), { text: 'x'.repeat(4000), moreLines: 0 })
  // A line cut mid-way counts as not shown.
  assert.deepEqual(contentView('x'.repeat(4001)), { text: 'x'.repeat(4000), moreLines: 1 })
  const two = `${'x'.repeat(2500)}\n${'y'.repeat(2500)}`
  const v = contentView(two)
  assert.equal(v.text.length, 4000)
  assert.equal(v.moreLines, 1)
  // Cut exactly at a line end.
  assert.deepEqual(contentView(`${'x'.repeat(3999)}\nrest`), { text: `${'x'.repeat(3999)}\n`, moreLines: 1 })
})

test('chip label truncates the title at 32', () => {
  assert.equal(chipLabel(2, 'Payments API'), '[2] Payments API')
  assert.equal(chipLabel(2, 'a'.repeat(40)), `[2] ${'a'.repeat(31)}…`)
  assert.equal(chipLabel(2, 'a  b\n c'), '[2] a b c')
})

test('spawn failures are told from other rejections', () => {
  assert.equal(isSpawnFailure(new Error('spawn spark ENOENT')), true)
  assert.equal(isSpawnFailure({ code: 'EACCES', message: 'x' }), true)
  assert.equal(isSpawnFailure(new Error('timed out after 10000ms')), false)
})

test('hash is stable', () => assert.equal(hash('a'), hash('a')))
