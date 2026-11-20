import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SparkContent, SparkNode, SparkStatus } from '../../types'
import { color } from '../theme'
import { extractMentions, refScope } from './spark-nodes/mentions'
import {
  batches, chipLabel, contentArgv, contentView, hash, infoArgv, isSpawnFailure, parseNodeLines, pendingKeys, truncate,
  CHIP_TITLE_MAX,
} from './spark-nodes/model'

// Spark node chips: a chip under a message for every Spark node it mentions as
// `¤sp:n` / `¤sp:PROJ-n`; pressing one opens an in-flow box with the node's title, type and
// summary, and "Show content" fetches the full content on demand. Data comes
// from `spark query --json --all --fields …` (batched, non-mutating), never
// from `spark show`. Spec: docs/specs/spec-spark-nodes.md.

const RUN_TIMEOUT_MS = 10_000
const MAX_SCAN_KEYS = 200
const MAX_CONSECUTIVE_FAILURES = 3
const UNPARSEABLE_BACKOFF_MS = 5 * 60_000
// Spark E04 (spec-local-workspace.md) and the pre-existing missing-workspace message.
const ABSENT_GLOBAL = /no global graph at|no Spark workspace at/i

const status = atom({ plugin: 'anthill-claude', key: 'spark-status' } as const, 'unknown' as SparkStatus)
const nodes = atom({ plugin: 'anthill-claude', key: 'spark-nodes' } as const, {} as Record<string, SparkNode>)
const missing = atom({ plugin: 'anthill-claude', key: 'spark-missing' } as const, {} as Record<string, true>)
const contents = atom({ plugin: 'anthill-claude', key: 'spark-content' } as const, {} as Record<string, SparkContent>)
const open = atom({ plugin: 'anthill-claude', key: 'spark-open' } as const, {} as Record<string, string>)
const expanded = atom({ plugin: 'anthill-claude', key: 'spark-expanded' } as const, {} as Record<string, string>)

type Dollar = EngineInterface

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const log = ($: Dollar, line: string) => $.ui.log(line, { to: 'debug' })

// --- data (top-level functions: `$` may only be handed to these) -------------

// Keys being fetched right now; one scan's batches run serially.
const inFlight = new Set<string>()
// Per-scope state (F-SPK-L08): consecutive failures, scopes switched off for the session, and
// scopes backed off until a time after an unparseable answer. Scope "" is the global graph.
const failures = new Map<string, number>()
const scopeOff = new Set<string>()
const backoff = new Map<string, number>()
// The uuid of the last message a ranged read returned (a reload loses it).
let lastSeenUuid: string | undefined

const markUnavailable = ($: Dollar) => update($, status, () => 'unavailable' as SparkStatus)

const scopeName = (scope: string) => (scope === '' ? 'global' : scope)

const countFailure = ($: Dollar, scope: string) => {
  const n = (failures.get(scope) ?? 0) + 1
  failures.set(scope, n)
  if (n >= MAX_CONSECUTIVE_FAILURES && !scopeOff.has(scope)) {
    scopeOff.add(scope)
    log($, `spark-nodes: ${n} consecutive failures; ${scopeName(scope)} mentions are off for this session`)
  }
}

/** Fetches the title/type/summary of the mentioned keys that no cache holds. */
const resolve = async ($: Dollar, keys: string[]) => {
  if ((await read($, status)) === 'unavailable') return
  const now = Date.now()
  const pending = pendingKeys(keys, await read($, nodes), await read($, missing), inFlight).filter(k => {
    const sc = refScope(k)
    return !scopeOff.has(sc) && (backoff.get(sc) ?? 0) <= now
  })
  if (pending.length === 0) return
  // Qualified refs resolve against the workspaces found from the session's directory (F-SPK-L01).
  const cwd = await $.session.cwd()
  for (const k of pending) inFlight.add(k)
  const groups = batches(pending)
  try {
    for (const batch of groups) {
      if ((await read($, status)) === 'unavailable') return
      const scope = refScope(batch[0] as string)
      if (scopeOff.has(scope)) continue
      try {
        let out: { exitCode: number; stdout: string; stderr: string }
        try {
          out = await $.process.run(infoArgv(batch), { cwd, timeoutMs: RUN_TIMEOUT_MS })
        } catch (err) {
          if (isSpawnFailure(err)) {
            log($, `spark-nodes: spark unavailable: ${message(err)}`)
            await markUnavailable($)
            return
          }
          log($, `spark-nodes: spark query failed: ${message(err)}`)
          countFailure($, scope)
          return
        }
        // A batch holds one scope (batches()); failures count per scope (F-SPK-L08).
        const qualified = scope !== ''
        const first = out.stderr.trim().split('\n')[0] ?? ''
        if (out.exitCode !== 0) {
          if (qualified) {
            // Ambiguous project key, or a Spark without local workspaces: no chip for this scope.
            log($, `spark-nodes: workspace query for ${batch.join(' ')} → exit ${out.exitCode}: ${first}`)
            await update($, missing, m => ({ ...m, ...Object.fromEntries(batch.map(k => [k, true as const])) }))
            continue
          }
          log($, `spark-nodes: spark query → exit ${out.exitCode}: ${first}`)
          if (ABSENT_GLOBAL.test(out.stderr)) {
            // No global DB (Spark E04): global mentions are off; workspace lookups are unaffected.
            scopeOff.add('')
            await update($, missing, m => ({ ...m, ...Object.fromEntries(batch.map(k => [k, true as const])) }))
            log($, 'spark-nodes: no global Spark graph; global mentions are off for this session')
            continue
          }
          countFailure($, scope)
          continue
        }
        const parsed = parseNodeLines(out.stdout)
        if (!parsed.ok) {
          log($, 'spark-nodes: unparseable spark query output')
          if (qualified) {
            // Back this workspace off so a broken one is not re-spawned on every scan (F-SPK-L08).
            backoff.set(scope, Date.now() + UNPARSEABLE_BACKOFF_MS)
          } else {
            countFailure($, scope)
          }
          continue
        }
        const found = new Set(parsed.nodes.map(n => n.key))
        // Only refs that were asked for are cached.
        const got = parsed.nodes.filter(n => batch.includes(n.key))
        const absent = batch.filter(k => !found.has(k))
        await update($, nodes, n => ({ ...n, ...Object.fromEntries(got.map(g => [g.key, g])) }))
        await update($, missing, m => ({ ...m, ...Object.fromEntries(absent.map(k => [k, true as const])) }))
        await update($, status, () => 'ok' as SparkStatus)
        failures.delete(scope)
        backoff.delete(scope)
      } finally {
        for (const k of batch) inFlight.delete(k)
      }
    }
  } finally {
    for (const k of pending) inFlight.delete(k)
  }
}

/** Fetches one node's content (lazy: only from the "Show content" press). */
const fetchContent = async ($: Dollar, key: string) => {
  const id = key
  const cwd = await $.session.cwd()
  const have = (await read($, contents))[id]
  if (have && (have.state === 'ok' || have.state === 'loading' || have.state === 'unsupported')) return
  const set = (value: SparkContent) => update($, contents, c => ({ ...c, [id]: value }))
  await set({ state: 'loading' })
  let out: { exitCode: number; stdout: string; stderr: string }
  try {
    out = await $.process.run(contentArgv(key), { cwd, timeoutMs: RUN_TIMEOUT_MS })
  } catch (err) {
    log($, `spark-nodes: content fetch failed: ${message(err)}`)
    await set({ state: 'failed' })
    return
  }
  if (out.exitCode !== 0) {
    if (out.stderr.includes('unknown field "content"')) {
      await set({ state: 'unsupported' })
      return
    }
    log($, `spark-nodes: content query → exit ${out.exitCode}: ${out.stderr.trim().split('\n')[0] ?? ''}`)
    await set({ state: 'failed' })
    return
  }
  const parsed = parseNodeLines(out.stdout)
  if (!parsed.ok) {
    log($, 'spark-nodes: unparseable spark query output (content)')
    await set({ state: 'failed' })
    return
  }
  const record = parsed.nodes.find(n => n.key === key)
  if (!record) {
    await set({ state: 'gone' })
    return
  }
  await update($, nodes, n => ({ ...n, [id]: record }))
  await set({ state: 'ok', content: parsed.contents[id] ?? null })
}

/** Reads the messages a trigger names, extracts mentions and resolves them. */
const scan = async ($: Dollar, range: { last: number } | { after: string } | { prompt: string }) => {
  try {
    const texts: string[] = []
    if ('prompt' in range) {
      texts.push(range.prompt)
    } else {
      let found = await $.session.messages(range)
      if ('deny' in found && 'after' in range) found = await $.session.messages({ last: 50 })
      if ('deny' in found) return
      for (const m of found) if (m.role === 'user' || m.role === 'assistant') texts.push(m.text)
      const uuid = found.at(-1)?.uuid
      if (uuid) lastSeenUuid = uuid
    }
    const keys: string[] = []
    const seen = new Set<string>()
    for (const t of texts) {
      for (const k of extractMentions(t)) {
        if (!seen.has(k)) {
          seen.add(k)
          keys.push(k)
        }
      }
    }
    if (keys.length) await resolve($, keys.slice(0, MAX_SCAN_KEYS))
  } catch (err) {
    log($, `spark-nodes: scan: ${message(err)}`)
  }
}

// --- the feature ---------------------------------------------------------------

export const sparkNodes: Register = on => {
  // --- triggers (never awaiting the CLI) ---------------------------------------

  // The engine refuses a second unmatched hook on one event (the Now pane holds
  // those), so these two carry a one-of matcher that selects every event.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    void scan($, { last: 200 })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', { isAborted: [true, false] }, async ($, e, next) => {
    if (e.agentId === undefined) void scan($, lastSeenUuid ? { after: lastSeenUuid } : { last: 50 })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true) void scan($, { prompt: e.text })
    return next(e)
  }).catch(($, e, next) => next(e))

  // --- chips and the info box ----------------------------------------------------

  on('ui.render', { component: ['AssistantMessage', 'UserMessage'] }, async ($, e, next) => {
    const props = e.props as { text?: string; origin?: { kind?: string } }
    if (e.component === 'UserMessage' && props.origin?.kind !== 'composer') return next(e)
    if ((await read($, status)) === 'unavailable') return next(e)
    const text = props.text ?? ''
    const known = await read($, nodes)
    const shown = extractMentions(text)
      .map(k => known[k])
      .filter((n): n is SparkNode => n !== undefined)
    if (shown.length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const site = hash(`${e.component}:${e.requestId ?? ''}:${text}`)
    const openKey = (await read($, open))[site]
    const openNode = shown.find(n => n.key === openKey)
    const isExpanded = openNode !== undefined && (await read($, expanded))[site] === openNode.key
    const content = openNode ? (await read($, contents))[openNode.key] : undefined

    const toggleChip = async (n: string) => {
      if ((await read($, open))[site] === n) {
        await update($, open, o => omit(o, site))
        await update($, expanded, x => omit(x, site))
      } else {
        await update($, open, o => ({ ...o, [site]: n }))
        await update($, expanded, x => omit(x, site))
      }
    }
    const toggleContent = async (n: string) => {
      const hasContent = (await read($, expanded))[site] === n && (await read($, contents))[n]?.state !== 'failed'
      if (hasContent) {
        await update($, expanded, x => omit(x, site))
        return
      }
      await update($, expanded, x => ({ ...x, [site]: n }))
      await fetchContent($, n)
    }

    const contentArea = (n: SparkNode) => {
      if (!content || content.state === 'loading') return <Text color={color('secondary')}>Loading content…</Text>
      if (content.state === 'ok') {
        if (content.content === null) return <Text color={color('secondary')} italic>no content</Text>
        const view = contentView(content.content)
        return (
          <Box flexDirection="column">
            <Text color={color('body')} wrap="wrap">{view.text}</Text>
            {view.moreLines > 0 && (
              <Text color={color('secondary')}>… {view.moreLines} more lines — spark show --peek {n.key}</Text>
            )}
          </Box>
        )
      }
      if (content.state === 'unsupported') {
        return <Text color={color('problem')}>Content unavailable: this spark has no node-content (update spark).</Text>
      }
      if (content.state === 'failed') {
        return <Text color={color('problem')}>Content could not be loaded (see the debug log). Press Show content to retry.</Text>
      }
      return <Text color={color('problem')}>[{n.key}] no longer exists in Spark.</Text>
    }

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {shown.map(n => (
            <Button key={`spark-chip:${n.key}`} label={chipLabel(n.key, n.title)} onPress={() => void toggleChip(n.key)}>
              <Text weight="bold" color={color('key')}>[{n.key}]</Text>
              {` ${truncate(n.title, CHIP_TITLE_MAX)}${openNode?.key === n.key ? ' ▾' : ' ▸'}`}
            </Button>
          ))}
        </Box>
        {openNode && (
          <Box key="spark-info" flexDirection="column" borderStyle="round" borderColor={color('frame')} paddingX={1}>
            <Box flexDirection="row" gap={1}>
              <Text weight="bold" color={color('key')}>[{openNode.key}]</Text>
              <Text weight="bold" color={color('body')} wrap="wrap">{openNode.title}</Text>
              {openNode.type !== null && <Text color={color('secondary')}>· {openNode.type}</Text>}
            </Box>
            {openNode.summary !== '' && <Text color={color('body')} wrap="wrap">{openNode.summary}</Text>}
            <Button
              key={`spark-content:${openNode.key}`}
              label={isExpanded && content?.state !== 'failed' ? 'Hide content' : 'Show content'}
              onPress={() => void toggleContent(openNode.key)}
            />
            {isExpanded && contentArea(openNode)}
          </Box>
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e)) // never fail a row over the chips
}

const omit = <T,>(o: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _gone, ...rest } = o
  return rest
}
