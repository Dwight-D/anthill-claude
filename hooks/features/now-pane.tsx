import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Install } from '../../types'
import { refreshVerb } from '../scripts/parse-anthill-command.mjs'
import { extractKeys, parseKeyArg, readPrefix } from './now-pane/keys'
import {
  EMPTY_NOW, buildDetail, buildNow, findRow, footerText, formatAge, parseList, parseObject, statusText, truncate,
} from './now-pane/model'
import type { Detail, Item, Now, Row, SessionRecord } from './now-pane/model'

// The Now pane: a docked pane listing the installation's active and
// validation backlog items from `anthill backlog list --active --json` and
// `anthill session list --json`, key chips under transcript rows that mention
// an item (`ANT-74`), a detail view per item, a status-line count and the
// `/ant` command. Contract: anthill-cli/docs/ITEM_KEYS_SPEC.md §5.
//
// Read-only in v1: the controller verbs (done / reject / release) stay in the
// TUI Now mode. Extension point: `DetailButtons` below, one Button per verb
// running `anthill backlog <verb>` through `$.process.run` after a confirm.

export const PANE = 'anthill-now'
const COMMAND = 'ant'
const RUN_TIMEOUT_MS = 10_000

const install = atom({ plugin: 'anthill-claude', key: 'now-install' } as const, null as Install | null)
const now = atom({ plugin: 'anthill-claude', key: 'now' } as const, EMPTY_NOW)
const selected = atom({ plugin: 'anthill-claude', key: 'now-selected' } as const, null as string | null)
const details = atom({ plugin: 'anthill-claude', key: 'now-details' } as const, {} as Record<string, Detail>)

type Dollar = EngineInterface
type Elements = ReturnType<EngineInterface['ui']['resolve']>

const paneTitle = (prefix: string, key: string | null) => `Anthill · ${key ?? prefix}`

const sep = (root: string) => (root.includes('\\') ? '\\' : '/')
const join = (root: string, ...parts: string[]) => [root.replace(/[\\/]+$/, ''), ...parts].join(sep(root))

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// --- data (top-level functions: `$` may only be handed to these) -------------

// One refresh in flight at a time; a trigger during one schedules one more.
let inFlight: Promise<void> | null = null
let again = false
// The pane opens by itself once per session (module variable: a reload opens it again).
let opened = false

const run = async ($: Dollar, root: string, args: string[]) => {
  const { exitCode, stdout, stderr } = await $.process.run(['anthill', ...args], { cwd: root, timeoutMs: RUN_TIMEOUT_MS })
  if (exitCode !== 0) {
    $.ui.log(`now-pane: anthill ${args.join(' ')} → exit ${exitCode}: ${stderr.trim().split('\n')[0] ?? ''}`, { to: 'debug' })
    return null
  }
  return stdout
}

/** Looks for an installation at `root`; null when there is none. */
const discover = async ($: Dollar, root: string): Promise<Install | null> => {
  try {
    const workstreams = join(root, '.anthill', 'backlog', 'workstreams.md')
    if (await $.fs.exists(workstreams)) {
      const prefix = readPrefix(await $.fs.read(workstreams))
      if (prefix) return { root, prefix }
      $.ui.log(`now-pane: ${workstreams} has no key-prefix; the Now pane is off`, { to: 'debug' })
    }
  } catch (err) {
    $.ui.log(`now-pane: discovery: ${message(err)}`, { to: 'debug' })
  }
  return null
}

const registerCommand = ($: Dollar) =>
  $.command.register({
    name: COMMAND,
    description: 'Open the Anthill pane (/ant 74 opens an item, /ant help lists the keys)',
    argumentHint: '[key|help]',
  })

/**
 * The session's installation. session.start does not reach every session
 * (a cleared or resumed one, a reloaded module), so a missing result is
 * rediscovered from the session's cwd on demand.
 */
const ensureInstall = async ($: Dollar): Promise<Install | null> => {
  const known = await read($, install)
  if (known) return known
  let found: Install | null = null
  try {
    found = await discover($, await $.session.cwd())
  } catch (err) {
    $.ui.log(`now-pane: cwd: ${message(err)}`, { to: 'debug' })
  }
  if (found) {
    await update($, install, () => found)
    await registerCommand($)
  }
  return found
}

const refreshOnce = async ($: Dollar) => {
  const found = await ensureInstall($)
  if (!found) return
  const { root, prefix } = found
  const [active, all, sessions] = await Promise.all([
    run($, root, ['backlog', 'list', '--active', '--json']),
    run($, root, ['backlog', 'list', '--json']),
    run($, root, ['session', 'list', '--json']),
  ])
  // A failed command keeps the last good state.
  if (active === null || all === null) return
  const [at, turn] = await Promise.all([$.clock.now(), $.session.turns()])
  const value = buildNow(
    {
      active: parseList<Item>(active),
      all: parseList<Item>(all),
      sessions: sessions === null ? [] : parseList<SessionRecord>(sessions),
    },
    at,
    turn,
  )
  await update($, now, () => value)
  await update($, details, () => ({}))
  $.ui.status(statusText(prefix, value))
  if (!opened && value.rows.length + value.validation.length > 0) {
    opened = true
    void $.ui.open({ id: PANE, title: paneTitle(prefix, await read($, selected)) })
  }
}

const refresh = ($: Dollar): Promise<void> => {
  if (inFlight) {
    again = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        again = false
        await refreshOnce($)
      } while (again)
    } catch (err) {
      $.ui.log(`now-pane: refresh: ${message(err)}`, { to: 'debug' })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

const isOpen = async ($: Dollar) => (await $.ui.panes()).some(p => p.id === PANE)

const loadDetail = async ($: Dollar, key: string) => {
  const found = await ensureInstall($)
  if (!found) return
  if ((await read($, details))[key]) return
  const shown = await run($, found.root, ['backlog', 'show', key, '--json'])
  const item = shown === null ? null : parseObject<Item>(shown)
  if (!item) {
    $.ui.toast(`${key}: not found`)
    return
  }
  const sessions = await run($, found.root, ['session', 'list', '--json'])
  const at = await $.clock.now()
  const detail = buildDetail(item, sessions === null ? [] : parseList<SessionRecord>(sessions), at)
  await update($, details, d => ({ ...d, [key]: detail }))
}

/** Selects a key, retitles the pane and opens it (focused when asked). */
const select = async ($: Dollar, key: string | null, focus?: true) => {
  const found = await ensureInstall($)
  if (!found) return
  await update($, selected, () => key)
  opened = true
  await $.ui.open({ id: PANE, title: paneTitle(found.prefix, key), ...(focus ? { focus } : {}) })
  if (key) await loadDetail($, key)
}

export const nowPane: Register = on => {
  // --- triggers ---------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    const found = await discover($, e.cwd)
    await update($, install, () => found)
    if (found) {
      await registerCommand($)
      void refresh($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && (await ensureInstall($))) void refresh($)
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && refreshVerb(e.command) && (await ensureInstall($))) void refresh($)
    return ran
  }).catch(($, e, next) => next(e)) // never refuse a command over this hook

  // --- the command ------------------------------------------------------------

  on('command.run', { command: COMMAND }, async ($, e) => {
    const found = await ensureInstall($)
    if (!found) return { text: 'No anthill installation in this session (no .anthill/backlog/workstreams.md in the cwd).' }
    const arg = e.args.trim()
    if (/^(help|\?|-h|--help)$/i.test(arg)) return { text: HELP_TEXT }
    if (!arg) {
      if (await isOpen($)) {
        await $.ui.close({ id: PANE })
        return { text: 'Anthill pane closed.' }
      }
      await select($, await read($, selected), true)
      void refresh($)
      return { text: 'Anthill pane opened.' }
    }
    const key = parseKeyArg(arg, found.prefix)
    if (!key) {
      $.ui.toast(`/ant: ${arg} is not a ${found.prefix}-N key`)
      return { text: `${arg} is not a ${found.prefix}-N key.` }
    }
    await select($, key, true)
    return { text: `${key} opened in the Anthill pane.` }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'The Anthill pane could not open; see the debug log.' }))

  // Escape in the pane (closeOnEscape is not set) returns the keys; the
  // person's close mark closes it. A close while the detail view is up goes
  // back to the list instead and keeps the pane.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && (await read($, selected)) !== null) {
      await select($, null)
      return { deny: 'back to the list; close again to close the pane' }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a failure here never pins the pane open

  // --- the pane ---------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const found = await ensureInstall($)
    const [state, key, cache, at] = await Promise.all([read($, now), read($, selected), read($, details), $.clock.now()])
    const inline = e.props.placement === 'inline'
    const columns = Math.max(20, e.props.bodyColumns || 60)

    if (!found) return <Text dimColor>No anthill installation in this session.</Text>

    if (key) {
      const detail = cache[key]
      const row = findRow(state, key)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text weight="bold">{key}</Text>
            <Text wrap="wrap">· {detail?.title ?? row?.title ?? ''}</Text>
          </Box>
          {detail ? (
            <DetailView
              detail={detail}
              columns={columns}
              ui={ui}
              copyKey={async () => {
                await $.ui.copy({ text: key })
                $.ui.toast(`${key} copied`)
              }}
              openFile={() => void $.prompt.fill({ text: ` @${detail.path}`, mode: 'append' })}
              transcript={() => $.ui.toast(detail.transcript ? `transcript: ${detail.transcript}` : `${key}: no transcript in the ledger`)}
            />
          ) : (
            <Text dimColor>{row ? 'Loading the item…' : `${key} is not in the active list; loading…`}</Text>
          )}
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="back" hotkey="b" role="dismiss" onPress={() => void select($, null)} />
          </Box>
          <Text dimColor>b back · c copy · o open file · t transcript · Tab walks · Esc returns the keys</Text>
        </Box>
      )
    }

    const section = (name: string, rows: Row[], offset: number) => (
      <Box flexDirection="column">
        <Text weight="bold" dimColor>
          {name} ({rows.length})
        </Text>
        {rows.length === 0 && <Text dimColor>none</Text>}
        {rows.map((r, i) => (
          <Box key={`row:${r.key}`} flexDirection="column" hover={{ scope: `now:${r.key}` }}>
            <Box flexDirection="row" gap={1}>
              <Button key={`open:${r.key}`} plain label={r.key} hotkey={rowHotkey(offset + i)} onPress={() => void select($, r.key)} />
              <Text color={pillColor(r.status)}>{r.status}</Text>
              <Text>{r.claimedBy || 'unclaimed'}</Text>
              {!inline && r.session8 && <Text dimColor>{r.session8}</Text>}
              <Text dimColor>{formatAge(r.ageMs)}</Text>
              {!inline && <Text dimColor>{r.workstream}</Text>}
              {inline && <Text dimColor>{truncate(r.summary, Math.max(10, columns - 40))}</Text>}
            </Box>
            {!inline && (
              <Box paddingLeft={2}>
                <Text dimColor wrap="truncate-end">
                  {truncate(r.summary, Math.max(10, columns - 4))}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )

    if (inline) {
      return (
        <Box flexDirection="column">
          <Text dimColor>
            Anthill · {found.prefix} · active {state.rows.length} · validation {state.validation.length} · ready {state.counts.ready}
          </Text>
          {[...state.rows, ...state.validation].map((r, i) => (
            <Box key={`row:${r.key}`} flexDirection="row" gap={1}>
              <Button key={`open:${r.key}`} plain label={r.key} hotkey={rowHotkey(i)} onPress={() => void select($, r.key)} />
              <Text color={pillColor(r.status)}>{r.status}</Text>
              <Text>{r.claimedBy || 'unclaimed'}</Text>
              <Text dimColor>{formatAge(r.ageMs)}</Text>
              <Text dimColor>{truncate(r.summary, Math.max(10, columns - 40))}</Text>
            </Box>
          ))}
          {state.rows.length + state.validation.length === 0 && <Text dimColor>nothing active</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          ↻ {state.refreshedAt ? `${formatAge(at - state.refreshedAt)} ago` : 'never'} · turn {state.turn}
        </Text>
        {section('ACTIVE', state.rows, 0)}
        {section('VALIDATION', state.validation, state.rows.length)}
        <Box flexDirection="column">
          <Text weight="bold" dimColor>
            BLOCKED ({state.counts.blocked})
          </Text>
        </Box>
        <Text dimColor>{footerText(state, at)}</Text>
        <Text dimColor>1-9 open a row · Tab walks · Esc returns the keys · /ant help for all keys</Text>
      </Box>
    )
  })

  // --- key chips in the transcript ----------------------------------------------

  on('ui.render', { component: ['AssistantMessage', 'UserMessage'] }, async ($, e, next) => {
    const found = await ensureInstall($)
    if (!found) return next(e)
    const props = e.props as { text?: string; origin?: { kind?: string } }
    if (e.component === 'UserMessage' && props.origin?.kind !== 'composer') return next(e)
    const keys = extractKeys(props.text ?? '', found.prefix)
    if (keys.length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, now)
    // One hover group per chip per message: a card reveals only for the chip
    // under the pointer, never for the same key in another message.
    const msg = hash(`${e.component}:${props.text ?? ''}`)
    const scope = (key: string) => `chip:${msg}:${key}`.slice(0, 64)

    // The hover cards are `position: "absolute"` children of a zero-height
    // anchor drawn between the message and the chip row, offset `bottom={0}`:
    // each card's bottom edge sits on the chip row's top edge, so it opens
    // upward over the message text, at the row's left edge. Absolute boxes take
    // no room, so a reveal moves neither the neighbouring chips nor the
    // transcript (an in-flow card widened its chip and grew the row).
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box position="relative" height={0} flexDirection="column">
          {keys.map(key => {
            const row = findRow(state, key)
            return (
              <Box
                key={`card:${key}`}
                position="absolute"
                bottom={0}
                left={0}
                width={CARD_WIDTH}
                display="none"
                hover={{ scope: scope(key), display: 'flex' }}
                flexDirection="column"
                borderStyle="round"
                paddingX={1}
              >
                {row ? (
                  <Box flexDirection="column">
                    <Box flexDirection="row" gap={1}>
                      <Text weight="bold">{key}</Text>
                      <Text>{[row.status, row.dispatch, row.disposition, row.workstream].filter(Boolean).join(' · ')}</Text>
                    </Box>
                    <Text wrap="wrap">{row.summary || row.title}</Text>
                    <Text dimColor>
                      {row.claimedBy ? `claimed by ${row.claimedBy} · ${formatAge(row.ageMs)}` : 'unclaimed'}
                    </Text>
                  </Box>
                ) : (
                  <Text dimColor>{key} · not in the active list · press to open</Text>
                )}
              </Box>
            )
          })}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {keys.map(key => {
            const row = findRow(state, key)
            const label = row ? `${key} · ${truncate(row.summary || row.title, 40)} · ${row.status}` : key
            return (
              <Box key={`chip:${key}`} hover={{ scope: scope(key) }}>
                <Button
                  key={`chip-open:${key}`}
                  label={label}
                  dimColor={!row}
                  onPress={() => void select($, key, true)}
                />
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e)) // never fail a row over the chips
}

const CARD_WIDTH = 64

/** A short stable id for a string (djb2, base 36). */
const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Row hotkeys `1`–`9`, in display order across ACTIVE then VALIDATION. */
const rowHotkey = (index: number) => (index < 9 ? String(index + 1) : undefined)

export const HELP_TEXT = [
  'Anthill keys',
  '',
  '  /ant              toggle the Anthill pane (opens it focused)',
  '  /ant 74           open ANT-74 in the pane (also /ant ANT-74)',
  '  /ant help         this help',
  '  ctrl+x tab        give the keyboard to the pane (or click it)',
  '',
  'While the pane holds the keyboard:',
  '  1-9               open the numbered row',
  '  tab / arrows      walk rows and buttons; enter presses',
  '  b                 back to the list (detail view)',
  '  c / o / t         copy key / open file / transcript (detail view)',
  '  esc               hand the keyboard back to the prompt',
  '',
  'Key chips in the transcript are mouse-only: hover shows the card, click opens',
  'the item. From the keyboard, use /ant <key>.',
].join('\n')

const pillColor = (status: string) =>
  status === 'in-progress' ? 'green' : status === 'validation' ? 'yellow' : status === 'blocked' ? 'red' : undefined

/** The detail view's body: pills, the key/value block, the sections, the buttons. */
const DetailView = ({
  detail: d, columns, ui, copyKey, openFile, transcript,
}: { detail: Detail; columns: number; ui: Elements; copyKey: () => void; openFile: () => void; transcript: () => void }) => {
  const { Box, Text, Button } = ui
  const kv = (k: string, v: string) =>
    v ? (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{k.padEnd(10)}</Text>
        <Text wrap="wrap">{v}</Text>
      </Box>
    ) : null
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={pillColor(d.status)}>{d.status}</Text>
        <Text color="cyan">{d.dispatch}</Text>
        <Text dimColor>
          {[d.disposition, d.workstream, d.priority, d.risk].filter(Boolean).join(' · ')}
        </Text>
      </Box>
      <Box flexDirection="column">
        {kv('claimed-by', d.claimedBy ? `${d.claimedBy}${d.session8 ? ` · session ${d.session8}` : ''} · ${formatAge(d.ageMs)} ago` : 'unclaimed')}
        {kv('reporter', [d.reporter, d.createdAt].filter(Boolean).join(' · '))}
        {kv('verify', truncate(d.verify, Math.max(20, columns * 3)))}
        {kv('former-id', d.formerId)}
      </Box>
      <Box flexDirection="column">
        <Text weight="bold" dimColor>SUMMARY</Text>
        <Text wrap="wrap">{d.summary || '—'}</Text>
      </Box>
      <Box flexDirection="column">
        <Text weight="bold" dimColor>ACCEPTANCE</Text>
        <Text wrap="wrap">{d.acceptance || '—'}</Text>
      </Box>
      <Box flexDirection="column">
        <Text weight="bold" dimColor>LOG (last {d.log.length})</Text>
        {d.log.map((line, i) => (
          <Text key={`log:${i}`} dimColor>{line}</Text>
        ))}
      </Box>
      <DetailButtons Box={Box} Button={Button} copyKey={copyKey} openFile={openFile} transcript={transcript} hasPath={!!d.path} />
    </Box>
  )
}

// Extension point: controller verbs (done / reject / release) would be added
// here as Buttons that confirm, then run `anthill backlog <verb>`.
const DetailButtons = ({
  Box, Button, copyKey, openFile, transcript, hasPath,
}: {
  Box: Elements['Box']
  Button: Elements['Button']
  copyKey: () => void
  openFile: () => void
  transcript: () => void
  hasPath: boolean
}) => (
  <Box flexDirection="row" gap={1}>
    <Button key="copy-key" label="copy key" hotkey="c" onPress={copyKey} />
    {hasPath && <Button key="open-file" label="open file" hotkey="o" onPress={openFile} />}
    <Button key="transcript" label="transcript" hotkey="t" onPress={transcript} />
  </Box>
)
