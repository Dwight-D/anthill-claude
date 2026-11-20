// Run: node --test tests/   Spec: docs/specs/spec-spark-nodes.md F-SPK-T03
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { THEME, color } from '../hooks/theme.ts'

// Copied from claude-code.d.ts `ThemeKey` (engine 2.1.329).
const THEME_KEYS = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude',
  'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed',
  'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord',
]

test('every role maps to an engine theme key; the low-contrast keys are banned', () => {
  for (const [role, key] of Object.entries(THEME)) {
    assert.ok(THEME_KEYS.includes(key), `${role} → ${key}`)
    assert.ok(!['subtle', 'inactive'].includes(key), `${role} must not use ${key}`)
    assert.equal(color(role), key)
  }
})

test('the spark feature takes its colors only from the theme', () => {
  const src = readFileSync(new URL('../hooks/features/spark-nodes.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /color="/)
  assert.doesNotMatch(src, /borderColor="/)
  assert.doesNotMatch(src, /dimColor/)
  for (const key of THEME_KEYS) assert.doesNotMatch(src, new RegExp(`['"\`]${key}['"\`]`), key)
})
