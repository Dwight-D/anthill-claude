import type { Register } from 'claude-code'

import { languageSanitization } from './features/language-sanitization'
import { nowPane } from './features/now-pane'
import { sessionCorrelation } from './features/session-correlation'
import { timestamps } from './features/timestamps'

// Each feature is one module exporting a Register; add new ones here.
export const register: Register = (on, options) => {
  timestamps(on, options)
  languageSanitization(on, options)
  sessionCorrelation(on, options)
  nowPane(on, options)
}
