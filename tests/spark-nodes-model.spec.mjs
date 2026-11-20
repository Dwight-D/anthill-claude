// Run: node --test tests/   Spec: docs/specs/spec-spark-nodes.md F-SPK-T02
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  batches, chipLabel, contentArgv, contentView, hash, infoArgv, isSpawnFailure, parseNodeLines, pendingKeys,
} from '../hooks/features/spark-nodes/model.ts'

const fixture = name => readFileSync(new URL(`./fixtures/spark-nodes/${name}`, import.meta.url), 'utf8')

test('argv shapes', () => {
  assert.deepEqual(infoArgv(['PAY-12', '12']), ['spark', 'query', '--json', '--all', '--fields', 'key,scope,ref,title,type,summary', '--key', 'PAY-12', '--key', '12'])
  assert.deepEqual(contentArgv('PAY-12'), ['spark', 'query', '--json', '--all', '--fields', 'key,scope,ref,title,type,summary,content', '--key', 'PAY-12'])
  assert.deepEqual(contentArgv('12'), ['spark', 'query', '--json', '--all', '--fields', 'key,scope,ref,title,type,summary,content', '--key', '12'])
})

test('batches', () => {
  const ks = n => Array.from({ length: n }, (_, i) => String(i + 1))
  assert.deepEqual(batches([]), [])
  assert.deepEqual(batches(ks(1)).map(b => b.length), [1])
  assert.deepEqual(batches(ks(50)).map(b => b.length), [50])
  assert.deepEqual(batches(ks(51)).map(b => b.length), [50, 1])
  assert.deepEqual(batches(ks(120)).map(b => b.length), [50, 50, 20])
  assert.deepEqual(batches(['1', '2', '3'], 2), [['1', '2'], ['3']])
})

test('batches group by scope, first appearance, then chunk', () => {
  assert.deepEqual(batches(['12', 'PAY-1', '40', 'OPS-2', 'PAY-3']), [['12', '40'], ['PAY-1', 'PAY-3'], ['OPS-2']])
  assert.deepEqual(batches(['PAY-1', '12', 'PAY-2', 'PAY-3'], 2), [['PAY-1', 'PAY-2'], ['PAY-3'], ['12']])
})

test('pendingKeys excludes cached, missing and in-flight; keeps order; de-duplicates', () => {
  assert.deepEqual(pendingKeys(['5', '1', '2', '3', 'PAY-4', '5', '1'], { 1: {} }, { 2: true }, new Set(['3'])), ['5', 'PAY-4'])
  assert.deepEqual(pendingKeys(['PAY-1', '1'], { 'PAY-1': {} }, {}, new Set()), ['1'])
  assert.deepEqual(pendingKeys([], {}, {}, new Set()), [])
})

test('parseNodeLines: info fixture', () => {
  const r = parseNodeLines(fixture('info.jsonl'))
  assert.equal(r.ok, true)
  assert.deepEqual(r.nodes, [
    { key: '1', title: 'Me', type: null, summary: '' },
    { key: '2', title: 'Payments API', type: 'component', summary: 'Handles card payments' },
    { key: '3', title: 'Card vault', type: null, summary: '' },
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
  assert.deepEqual(r, { ok: true, nodes: [{ key: '2', title: 'Payments API', type: 'component', summary: 'Handles card payments' }], contents: {} })
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
  assert.deepEqual(r.nodes[0], { key: '1', title: 'a', type: null, summary: '' })
})

const line = o => JSON.stringify({ title: 'T', type: null, summary: '', ...o })

test('parseNodeLines: identity is ref; old Spark falls back to key', () => {
  const pay = parseNodeLines(line({ key: 3, scope: 'PAY', ref: 'PAY-3' }))
  assert.deepEqual(pay.nodes.map(n => n.key), ['PAY-3'])
  assert.deepEqual(parseNodeLines(line({ key: 12, scope: '', ref: '12' })).nodes.map(n => n.key), ['12'])
  assert.deepEqual(parseNodeLines(line({ key: 12 })).nodes.map(n => n.key), ['12'])
  assert.deepEqual(parseNodeLines(line({ key: 3, scope: 'pay', ref: 'pay-3' })).ok, false) // scope must equal the canonical prefix
  assert.deepEqual(parseNodeLines(line({ key: 3, ref: 'pay-3' })).nodes.map(n => n.key), ['PAY-3'])
})

test('parseNodeLines: the same key in two scopes is two nodes; contents keyed by ref', () => {
  const r = parseNodeLines([line({ key: 3, scope: 'PAY', ref: 'PAY-3', content: 'a' }), line({ key: 3, scope: '', ref: '3', content: 'b' })].join('\n'))
  assert.equal(r.ok, true)
  assert.deepEqual(r.nodes.map(n => n.key), ['PAY-3', '3'])
  assert.deepEqual(r.contents, { 'PAY-3': 'a', 3: 'b' })
})

test('parseNodeLines: bad ref, bad key or disagreeing scope fail the batch', () => {
  for (const o of [
    { key: 3, ref: 'x' }, { key: 3, ref: null }, { key: '3', ref: '3' }, { key: 3, scope: 'OPS', ref: 'PAY-3' },
    { key: 3, scope: 'PAY', ref: '3' }, { key: 3, scope: 'PAY' }, { key: 0, ref: '3' },
  ]) assert.deepEqual(parseNodeLines(line(o)), { ok: false }, JSON.stringify(o))
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
  assert.equal(chipLabel('2', 'Payments API'), '[2] Payments API')
  assert.equal(chipLabel('2', 'a'.repeat(40)), `[2] ${'a'.repeat(31)}…`)
  assert.equal(chipLabel('2', 'a  b\n c'), '[2] a b c')
})

test('chip label shows a qualified ref', () => assert.equal(chipLabel('PAY-3', 'Vault'), '[PAY-3] Vault'))

test('spawn failures are told from other rejections', () => {
  assert.equal(isSpawnFailure(new Error('spawn spark ENOENT')), true)
  assert.equal(isSpawnFailure({ code: 'EACCES', message: 'x' }), true)
  assert.equal(isSpawnFailure(new Error('timed out after 10000ms')), false)
})

test('hash is stable', () => assert.equal(hash('a'), hash('a')))
