import type { Register } from 'claude-code'

import { languageSanitization } from './features/language-sanitization'
import { timestamps } from './features/timestamps'

// Each feature is one module exporting a Register; add new ones here.
export const register: Register = (on, options) => {
  timestamps(on, options)
  languageSanitization(on, options)
}
