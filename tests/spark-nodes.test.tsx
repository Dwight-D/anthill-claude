// Run: claude plugin test .   (the engine's own test kit; no fs, network or process)
// The Spark node chips of hooks/features/spark-nodes.tsx, driven through the
// engine with the spark CLI stubbed: `process.run` answers by exact argv.
// Spec: docs/specs/spec-spark-nodes.md F-SPK-T04.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PLUGIN = 'anthill-claude'

const NODES: Record<number, { key: number; title: string; type: string | null; summary: string; content: string | null }> = {
  2: { key: 2, title: 'Payments API', type: 'component', summary: 'Handles card payments', content: 'Owns the card flow.' },
  3: { key: 3, title: 'Card vault', type: null, summary: '', content: null },
}

const out = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

type Flags = {
  calls: string[][]
  /** Messages `session.messages` answers with. */
  messages: { role: 'user' | 'assistant'; text: string; uuid: string }[]
  /** `process.run` rejects (the binary is missing). */
  missing: boolean
  /** The info call exits 1. */
  failing: boolean
  /** The content call answers as an older spark does. */
  oldSpark: boolean
}

const engine = (on: Parameters<TestBody>[1]): Flags => {
  const flags: Flags = { calls: [], messages: [], missing: false, failing: false, oldSpark: false }
  mock.clock(on, { now: Date.parse('2026-11-20T12:00:00Z') })
  mock.store(on)
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    flags.calls.push(argv)
    if (flags.missing) throw new Error('spawn spark ENOENT')
    const keys = argv.flatMap((a, i) => (argv[i - 1] === '--key' ? [Number(a)] : []))
    const wantsContent = argv.includes('key,title,type,summary,content')
    if (wantsContent && flags.oldSpark) return out(1, '', 'spark: unknown field "content"')
    if (flags.failing) return out(1, '', 'boom')
    const lines = keys.flatMap(k => {
      const n = NODES[k]
      if (!n) return []
      const { content, ...info } = n
      return [JSON.stringify(wantsContent ? { ...info, content } : info)]
    })
    return out(0, lines.join('\n') + (lines.length ? '\n' : ''))
  })
  // Honors `after`: only the rows behind that uuid (a ranged read carries uuids).
  on('session.messages', (_, e) => {
    const args = e as { after?: string }
    if (args.after === undefined) return { value: flags.messages }
    const at = flags.messages.findIndex(m => m.uuid === args.after)
    return { value: at < 0 ? { deny: 'gone' } : flags.messages.slice(at + 1) }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  return flags
}

const complete = ($: Parameters<TestBody>[0], id: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })

const start = async ($: Parameters<TestBody>[0], flags: Flags, text = 'see [2] and [3] but not arr[1] or [99]') => {
  flags.messages = [{ role: 'assistant', text, uuid: `u-${flags.calls.length}-${text.length}` }]
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await complete($, 't1')
  // The scans run detached from their hooks; let them settle.
  await new Promise(r => setTimeout(r, 20))
}

const infoCalls = (flags: Flags) => flags.calls.filter(c => !c.includes('key,title,type,summary,content'))

const message = (
  $: Parameters<TestBody>[0],
  surface: 'terminal' | 'desktop',
  requestId: string,
  text: string,
  component: 'AssistantMessage' | 'UserMessage' = 'AssistantMessage',
  origin: string = 'composer',
) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component,
    requestId,
    props: component === 'AssistantMessage' ? { text, isFirstOfReply: true } : { text, origin: { kind: origin }, isExpanded: false },
  } as never)

const TEXT = 'see [2] and [3] but not arr[1] or [99]'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`chips are batched, cached and never use show (${surface})`, async ($, on) => {
    const flags = engine(on)
    await start($, flags)

    const query = flags.calls.filter(c => c[1] === 'query')
    expect(query.map(c => c.join(' '))).toContain(
      'spark query --json --all --fields key,title,type,summary --key 2 --key 3 --key 99',
    )
    expect(flags.calls.some(c => c.includes('show'))).toBe(false)
    expect(infoCalls(flags).length).toBeGreaterThan(0)
    expect(infoCalls(flags).every(c => c.join(' ') === 'spark query --json --all --fields key,title,type,summary --key 2 --key 3 --key 99')).toBe(true)
    // Exactly one info call overall (session.start read the message; the turn's `after` read found none new).
    expect(infoCalls(flags)).toHaveLength(1)

    const ui = await message($, surface, 'm1', TEXT)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['spark-chip:2', 'spark-chip:3'])
    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    await ui.unmount()
  })

  test(`a chip opens the box; Show content fetches once and toggles (${surface})`, async ($, on) => {
    const flags = engine(on)
    await start($, flags)
    const ui = await message($, surface, 'm1', TEXT)

    expect(await ui.find({ key: 'spark-info' })).toBeUndefined()
    await ui.press({ key: 'spark-chip:2' })
    expect((await ui.find({ type: 'Text', text: /Payments API/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /· component/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Handles card payments/ }))).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'spark-content:2' }))?.props.label).toBe('Show content')
    expect(await ui.find({ type: 'Text', text: /Owns the card flow/ })).toBeUndefined()
    expect(flags.calls.some(c => c.includes('key,title,type,summary,content'))).toBe(false)

    await ui.press({ key: 'spark-chip:2' })
    expect(await ui.find({ key: 'spark-info' })).toBeUndefined()
    await ui.press({ key: 'spark-chip:2' })

    await ui.press({ key: 'spark-content:2' })
    const contentCalls = () => flags.calls.filter(c => c.includes('key,title,type,summary,content'))
    expect(contentCalls().map(c => c.join(' '))).toEqual([
      'spark query --json --all --fields key,title,type,summary,content --key 2',
    ])
    expect((await ui.find({ type: 'Text', text: /Owns the card flow\./ }))).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'spark-content:2' }))?.props.label).toBe('Hide content')

    await ui.press({ key: 'spark-content:2' })
    expect(await ui.find({ type: 'Text', text: /Owns the card flow/ })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'spark-content:2' }))?.props.label).toBe('Show content')
    await ui.press({ key: 'spark-content:2' })
    expect((await ui.find({ type: 'Text', text: /Owns the card flow\./ }))).toBeDefined()
    expect(contentCalls()).toHaveLength(1)
    await ui.unmount()
  })
}

test('a later turn mentioning known or missing keys makes no new call', async ($, on) => {
  const flags = engine(on)
  await start($, flags)
  const before = flags.calls.length
  flags.messages = [{ role: 'assistant', text: 'again [99] and [2]', uuid: 'u-later' }]
  await complete($, 't2')
  await new Promise(r => setTimeout(r, 20))
  expect(flags.calls.length).toBe(before)
})

test('a node without type or summary shows only its title', async ($, on) => {
  const flags = engine(on)
  await start($, flags)
  const ui = await message($, 'terminal', 'm1', TEXT)
  await ui.press({ key: 'spark-chip:3' })
  expect((await ui.find({ type: 'Text', text: /Card vault/ }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /·/ })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'spark-content:3' }))?.props.label).toBe('Show content')
  await ui.press({ key: 'spark-content:3' })
  expect((await ui.find({ type: 'Text', text: /no content/ }))).toBeDefined()
  await ui.unmount()
})

test('an old spark answers Show content with the unavailable line; chips still work', async ($, on) => {
  const flags = engine(on)
  flags.oldSpark = true
  await start($, flags)
  const ui = await message($, 'terminal', 'm1', TEXT)
  await ui.press({ key: 'spark-chip:2' })
  await ui.press({ key: 'spark-content:2' })
  expect((await ui.find({ type: 'Text', text: /Content unavailable/ }))).toBeDefined()
  await ui.press({ key: 'spark-chip:3' })
  expect((await ui.find({ type: 'Text', text: /Card vault/ }))).toBeDefined()
  await ui.unmount()
})

test('the same key in two messages opens independently', async ($, on) => {
  const flags = engine(on)
  await start($, flags)
  const a = await message($, 'terminal', 'm1', TEXT)
  const b = await message($, 'terminal', 'm2', 'and again [2]')
  await a.press({ key: 'spark-chip:2' })
  expect(await a.find({ key: 'spark-info' })).toBeDefined()
  expect(await b.find({ key: 'spark-info' })).toBeUndefined()
  await a.unmount()
  await b.unmount()
})

// The test kit cannot hand the plugin a custom rejection: a hook that throws is skipped and the
// engine rejects with "no implementation for process.run". That is not a spawn failure (the
// ENOENT / EACCES classification is covered by isSpawnFailure in spark-nodes-model.spec.mjs), so
// this drives the other rejection path: no chips, nothing negatively cached, off after three.
test('a rejecting process.run leaves the feature inert and stops spawning', async ($, on) => {
  const flags = engine(on)
  flags.missing = true
  await start($, flags)
  const ui = await message($, 'terminal', 'm1', TEXT)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await ui.unmount()
  for (const id of ['u-new-1', 'u-new-2', 'u-new-3', 'u-new-4']) {
    flags.messages = [...flags.messages, { role: 'assistant', text: 'new [7]', uuid: id }]
    await complete($, id)
    await new Promise(r => setTimeout(r, 20))
  }
  expect(flags.calls).toHaveLength(3)
})

test('a failing query is not cached, is retried, and stops after three failures', async ($, on) => {
  const flags = engine(on)
  flags.failing = true
  await start($, flags) // failure 1 (session.start) — the turn's `after` read sees nothing new
  expect(flags.calls).toHaveLength(1)
  const ui = await message($, 'terminal', 'm1', TEXT)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()

  flags.messages = [{ role: 'assistant', text: TEXT, uuid: 'u-2' }]
  await complete($, 't2') // failure 2: the keys were not negatively cached
  await new Promise(r => setTimeout(r, 20))
  expect(flags.calls).toHaveLength(2)
  flags.messages = [{ role: 'assistant', text: TEXT, uuid: 'u-3' }]
  await complete($, 't3') // failure 3
  await new Promise(r => setTimeout(r, 20))
  expect(flags.calls).toHaveLength(3)
  flags.messages = [{ role: 'assistant', text: TEXT, uuid: 'u-4' }]
  await complete($, 't4')
  await new Promise(r => setTimeout(r, 20))
  expect(flags.calls).toHaveLength(3)
})

test('a user message gets chips only from the composer', async ($, on) => {
  const flags = engine(on)
  await start($, flags)
  const mine = await message($, 'terminal', 'u1', 'look at [2]', 'UserMessage', 'composer')
  expect((await mine.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['spark-chip:2'])
  await mine.unmount()
  const other = await message($, 'terminal', 'u2', 'look at [2]', 'UserMessage', 'task-notification')
  expect(await other.findAll({ type: 'Button' })).toHaveLength(0)
  await other.unmount()
})
