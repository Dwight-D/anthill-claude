// `node --test tests/` runs this file (Node 22+ takes a directory argument as
// a module path, resolving to its index.js); it loads every *.spec.mjs here.
// `node --test "tests/*.spec.mjs"` runs the same specs directly.
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

for (const f of readdirSync(__dirname).filter(f => f.endsWith('.spec.mjs')).sort()) {
  import(pathToFileURL(join(__dirname, f)).href)
}
