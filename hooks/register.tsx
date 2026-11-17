import type { Register } from 'claude-code'

import { timestamps } from './features/timestamps'

// Each feature is one module exporting a Register; add new ones here.
export const register: Register = (on, options) => {
  timestamps(on, options)
}
