// The one place colors are chosen. Features pass `color('<role>')`, never a
// literal. Roles map to engine theme keys (not hex, not ANSI names), so the
// person's Claude Code theme, including its daltonized / high-contrast ones,
// decides the actual colors. The user is colorblind: contrast comes first,
// nothing is conveyed by hue alone, and the low-contrast keys ('subtle',
// 'inactive') are not used. If a role ever needs an explicit color, change it
// here and only here: high-contrast and more saturated than a typical default.
// Pure: a type import only. Spec: docs/specs/spec-spark-nodes.md §6.
import type { ThemeKey } from 'claude-code'

export const THEME = {
  key: 'suggestion', // node keys [n] — always also bold
  body: 'text', // titles, summaries, content
  secondary: 'text', // type, loading / "no content" lines: same key as body, told apart by italic and words
  frame: 'suggestion', // info box border
  problem: 'error', // failure lines — always prefixed with words ("Content unavailable", …)
} as const satisfies Record<string, ThemeKey>

export type Role = keyof typeof THEME

export const color = (role: Role): ThemeKey => THEME[role]
