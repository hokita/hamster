import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const USES_LINE = /^[ \t]*(?:-[ \t]+)?uses:[ \t]*(.*?)[ \t]*$/gm
const QUOTED = /^(?:"([^"]*)"|'([^']*)')$/
const PINNED = /^(?:[^/@\s]+\/[^@\s]+@[0-9a-f]{40}|\.\/\S*|docker:\/\/\S+@sha256:[0-9a-f]{64})$/

export function findUnpinned(workflowText) {
  const offenders = []
  for (const match of workflowText.matchAll(USES_LINE)) {
    const quoted = match[1].match(QUOTED)
    const value = quoted ? (quoted[1] ?? quoted[2]) : match[1]
    if (!PINNED.test(value)) offenders.push(value)
  }
  return offenders
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: check-action-pins.mjs <workflow files...>')
    process.exit(2)
  }
  let failed = false
  for (const file of files) {
    for (const value of findUnpinned(fs.readFileSync(file, 'utf8'))) {
      console.log(`${file}: ${value}`)
      failed = true
    }
  }
  process.exit(failed ? 1 : 0)
}
