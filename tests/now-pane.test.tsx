// Run: claude plugin test .   (the engine's own test kit; no fs, network or process)
// The Now pane and key chips of hooks/features/now-pane.tsx, driven through the
// engine with the CLI stubbed: `process.run` answers from the JSON below, which
// follows anthill 0.2.0's `--json` shape (tests/fixtures/now-pane/*.json).
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PLUGIN = 'anthill-claude'
const ROOT = 'E:\\Dev\\frameworks\\anthill'
const WORKSTREAMS = '---\nschema: 3\nkey-prefix: ANT\nsequence: 9\n---\n# Workstreams\n'

const item = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `${id} title`,
  summary: `${id} summary`,
  workstream: 'dev',
  status,
  dispatch: 'approved',
  disposition: 'auto',
  priority: 'normal',
  reporter: 'user',
  risk: 'additive',
  'created-at': '2026-11-17T12:12:44Z',
  'claimed-at': '2026-11-17T14:46:11Z',
  'claimed-by': 'claude-pane',
  session: '38acdb2e-2f54-4bd2-a2e8-29b22a9eec0f',
  path: `${ROOT}\\.anthill\\backlog\\dev\\${id}.md`,
  ready: false,
  active: true,
  ...extra,
})

const ACTIVE = [item('ANT-5', 'in-progress'), item('ANT-66', 'in-progress', { 'claimed-by': 'cli-w2', workstream: 'cli' }), item('ANT-67', 'validation', { 'claimed-by': 'cli-w2' })]
const ALL = [...ACTIVE, item('ANT-1', 'triaged', { ready: true, 'claimed-by': '' }), item('ANT-2', 'new', { dispatch: 'proposed' }), item('ANT-3', 'blocked')]
const SESSIONS = [{
  session: '38acdb2e-2f54-4bd2-a2e8-29b22a9eec0f', agent: '', handle: 'claude-pane', item: 'ANT-5', role: 'worker',
  transcript: 'C:\\Users\\me\\.claude\\projects\\x\\38acdb2e.jsonl', cwd: ROOT,
  started: '2026-11-17T13:55:51Z', 'last-seen': '2026-11-17T14:46:11Z', verb: 'claim',
}]
const SHOW = {
  ...item('ANT-5', 'in-progress'),
  verify: 'claude plugin test green',
  'former-id': 'anthill-claude-in-session-now-pane-showing-active',
  body: '## Description\nthe description\n\n## Acceptance\npane renders\n\n## Log\n- 2026-11-17T12:53:02Z one\n- 2026-11-17T13:47:51Z two\n- 2026-11-17T14:45:08Z three\n- 2026-11-17T14:46:11Z claim by claude-pane\n',
}

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Flags = {
  /** What `process.run` records. */
  calls: string[][]
  /** When true every CLI call fails (exit 2). */
  failing: boolean
  /** Whether the pane exists for `ui.panes`. */
  paneOpen: boolean
  /** Whether the cwd holds an installation. */
  installed: boolean
  /** Every `ui.open` argument, in order. */
  opens: { title?: string; focus?: true }[]
  /** Every `ui.close` id, in order. */
  closes: string[]
}

/**
 * The engine beneath the plugin: an installation at ROOT and a CLI answering
 * from the JSON above. Registered once, before the first call on `$`; the
 * flags steer it afterwards.
 */
const engine = (on: Parameters<TestBody>[1]): Flags => {
  const flags: Flags = { calls: [], failing: false, paneOpen: false, installed: true, opens: [], closes: [] }
  mock.clock(on, { now: Date.parse('2026-11-17T14:46:23Z') })
  mock.store(on)
  on('fs.exists', (_, e) => ({ value: flags.installed && e.path.endsWith('workstreams.md') }))
  on('fs.read', () => ({ value: WORKSTREAMS }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    flags.calls.push(argv)
    const a = argv.join(' ')
    if (flags.failing) return { value: { exitCode: 2, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
    if (a === 'anthill backlog list --active --json') return ok(JSON.stringify(ACTIVE))
    if (a === 'anthill backlog list --json') return ok(JSON.stringify(ALL))
    if (a === 'anthill session list --json') return ok(JSON.stringify(SESSIONS))
    if (a === 'anthill backlog show ANT-5 --json') return ok(JSON.stringify(SHOW))
    return { value: { exitCode: 1, stdout: '', stderr: 'no such item', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    flags.opens.push({ title: e.title, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    flags.closes.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: flags.paneOpen ? [{ id: 'anthill-now', title: 'Anthill · ANT', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('session.turns', () => ({ value: 18 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  return flags
}

const start = async ($: Parameters<TestBody>[0], cwd = ROOT) => {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  // The refresh runs detached from session.start; a turn's completion is awaited by its hook.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'anthill-now',
  props: { title: 'Anthill · ANT', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pane lists active and validation rows after a refresh, on every surface', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  expect(calls.some(c => c.join(' ') === 'anthill backlog list --active --json')).toBe(true)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /ACTIVE/ }))?.text).toBe('ACTIVE (2)')
    expect((await ui.find({ type: 'Text', text: /VALIDATION/ }))?.text).toBe('VALIDATION (1)')
    expect((await ui.find({ type: 'Text', text: /BLOCKED/ }))?.text).toBe('BLOCKED (1)')
    expect(await ui.find({ type: 'Button', key: 'open:ANT-5' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'open:ANT-66' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'open:ANT-67' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /ready/ }))?.text).toMatch(/ready 1 · proposed 1 · blocked 1 · ↻ \d+s ago · turn 18/)
    await ui.unmount()
  }
})

test('inline placement compresses each row to one line', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'inline' } })
  expect((await ui.find({ type: 'Text', text: /active 2/ }))?.text).toMatch(/Anthill · ANT · active 2 · validation 1 · ready 1/)
  expect(await ui.find({ type: 'Text', text: /ACTIVE \(/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
  await ui.unmount()
})

test('a pane row press opens the detail view; back returns to the list', async ($, on) => {
  const { calls } = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'open:ANT-5' })
  expect(calls.some(c => c.join(' ') === 'anthill backlog show ANT-5 --json')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /SUMMARY/ }))?.text).toBe('SUMMARY')
  expect((await ui.find({ type: 'Text', text: /ANT-5 summary/ }))?.text).toBe('ANT-5 summary')
  expect((await ui.find({ type: 'Text', text: /pane renders/ }))?.text).toBe('pane renders')
  expect((await ui.find({ type: 'Text', text: /former-id/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /anthill-claude-in-session-now-pane-showing-active/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /LOG/ }))?.text).toBe('LOG (last 3)')
  expect(await ui.find({ type: 'Text', text: /12:53Z one/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /claim by claude-pane/ }))?.text).toBe('14:46Z claim by claude-pane')
  expect(await ui.find({ type: 'Button', key: 'copy-key' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'open-file' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'transcript' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()

  await ui.press({ key: 'back' })
  expect((await ui.find({ type: 'Text', text: /ACTIVE/ }))?.text).toBe('ACTIVE (2)')
  await ui.unmount()
})

test('/ant 5 selects the item; /ant toggles the pane', async ($, on) => {
  const flags = engine(on)
  await start($)

  const run = (args: string) =>
    $.command.run({ command: 'ant', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } })

  expect((await run('5'))?.text).toBe('ANT-5 opened in the Anthill pane.')
  expect(flags.opens.at(-1)?.title).toBe('Anthill · ANT-5')

  expect((await run('ant-5'))?.text).toBe('ANT-5 opened in the Anthill pane.')
  expect((await run('nope'))?.text).toBe('nope is not a ANT-N key.')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /SUMMARY/ }))?.text).toBe('SUMMARY')
  await ui.unmount()

  // Not open (ui.panes answers none): /ant opens; open: /ant closes.
  expect((await run(''))?.text).toBe('Anthill pane opened.')
  flags.paneOpen = true
  expect((await run(''))?.text).toBe('Anthill pane closed.')
  expect(flags.closes).toEqual(['anthill-now'])
})

test('chips: rows that mention a key get one Button per distinct key, under the engine row', async ($, on) => {
  engine(on)
  await start($)

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text: 'Claimed ANT-5 and ANT-66; ANT-5 again, ANT-99 is unknown, UTF-8 is not a key.', isFirstOfReply: true },
  })
  expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  const chips = await ui.findAll({ type: 'Button' })
  expect(chips.map(c => c.key)).toEqual(['chip-open:ANT-5', 'chip-open:ANT-66', 'chip-open:ANT-99'])
  expect(chips[0]?.props.label).toBe('ANT-5 · ANT-5 summary · in-progress')
  expect(chips[2]?.props.label).toBe('ANT-99')
  expect(chips[2]?.props.dimColor).toBe(true)
  // The hover card is drawn hidden inside the keyed chip Box, revealed by the surface on hover.
  // (`hover` is a surface concern: the kit's element descriptions carry no hover props.)
  expect(await ui.find({ type: 'Box', key: 'chip:ANT-5' })).toBeDefined()
  const cards = (await ui.findAll({ type: 'Box' })).filter(b => b.props.display === 'none')
  expect(cards).toHaveLength(3)
  expect((await ui.find({ type: 'Text', text: /claimed by claude-pane/ }))).toBeDefined()
  await ui.unmount()

  const user = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'UserMessage',
    requestId: 'm2',
    props: { text: 'pick up ANT-67 next', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect((await user.findAll({ type: 'Button' })).map(c => c.key)).toEqual(['chip-open:ANT-67'])
  await user.unmount()
})

test('chips: a row without a key, or not from the composer, is the engine row untouched', async ($, on) => {
  engine(on)
  await start($)

  const plain = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm3',
    props: { text: 'decode as UTF-8 and hash with SHA-256', isFirstOfReply: false },
  })
  expect(await plain.drawn()).toMatchObject({ type: 'Text' })
  expect(await plain.findAll({ type: 'Button' })).toHaveLength(0)
  await plain.unmount()

  const notification = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'm4',
    props: { text: 'worker delivered ANT-5', origin: { kind: 'task-notification' }, isExpanded: false },
  })
  expect(await notification.findAll({ type: 'Button' })).toHaveLength(0)
  await notification.unmount()
})

test('a chip press selects the key and opens the pane focused', async ($, on) => {
  const flags = engine(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm5',
    props: { text: 'see ANT-66', isFirstOfReply: true },
  })
  await ui.press({ key: 'chip-open:ANT-66' })
  expect(flags.opens.at(-1)).toEqual({ title: 'Anthill · ANT-66', focus: true })
  await ui.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /ANT-66 is not in the active list|Loading the item/ }))).toBeDefined()
  await pane.unmount()
})

test('without an installation the feature is inert', async ($, on) => {
  const flags = engine(on)
  flags.installed = false
  await start($, 'C:\\elsewhere')

  expect(flags.calls).toHaveLength(0)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm6',
    props: { text: 'ANT-5 is mentioned', isFirstOfReply: true },
  })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a backlog verb through Bash triggers a refresh; a failed list keeps the last state', async ($, on) => {
  const flags = engine(on)
  await start($)
  const before = flags.calls.length

  await $.tool.call({ tool: 'Bash', command: 'anthill backlog claim ANT-1 --by w' })
  expect(flags.calls.length).toBeGreaterThan(before)

  await $.tool.call({ tool: 'Bash', command: 'anthill backlog list --json' })
  const after = flags.calls.length

  flags.failing = true
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /ACTIVE/ }))?.text).toBe('ACTIVE (2)')
  await ui.unmount()
  expect(after).toBeGreaterThan(before)
})

test('chip cards are absolute, open above the chip row, and light per message', async ($, on) => {
  engine(on)
  await start($)
  const mount = (requestId: string, text: string) =>
    $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } })

  const a = await mount('m7', 'ANT-5 and ANT-66')
  // The hover props ride on the drawn tree, not on find()'s description.
  const scopeOf = async (ui: typeof a, key: string) => {
    const walk = (n: unknown): string | undefined => {
      if (!n || typeof n !== 'object') return undefined
      const el = n as { props?: { key?: string; children?: unknown }; hover?: { scope?: string }; key?: string; children?: unknown }
      if ((el.key ?? el.props?.key) === key) return el.hover?.scope ?? (el.props as { hover?: { scope?: string } } | undefined)?.hover?.scope
      const kids = el.children ?? el.props?.children
      for (const c of Array.isArray(kids) ? kids : [kids]) {
        const found = walk(c)
        if (found) return found
      }
      return undefined
    }
    return walk(await ui.drawn())
  }
  expect((await a.find({ key: 'card:ANT-5' }))?.props).toMatchObject({ position: 'absolute', bottom: 0, left: 0, display: 'none' })
  const scope = await scopeOf(a, 'card:ANT-5')
  expect(scope).toBeDefined()
  expect(await scopeOf(a, 'chip:ANT-5')).toBe(scope)
  expect(await scopeOf(a, 'card:ANT-66')).not.toBe(scope)
  await a.unmount()

  const b = await mount('m8', 'ANT-5 again, elsewhere')
  expect(await scopeOf(b, 'card:ANT-5')).not.toBe(scope)
  await b.unmount()
})

test('/ant help lists the keys; pane rows carry 1-9 hotkeys', async ($, on) => {
  engine(on)
  await start($)
  const res = await $.command.run({ command: 'ant', args: 'help', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } })
  expect(res?.text).toMatch(/ctrl\+x tab/)
  expect(res?.text).toMatch(/1-9/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'open:ANT-5' }))?.props.hotkey).toBe('1')
  await ui.unmount()
})
