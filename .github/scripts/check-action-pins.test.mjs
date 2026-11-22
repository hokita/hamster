import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findUnpinned } from './check-action-pins.mjs'

const script = fileURLToPath(new URL('./check-action-pins.mjs', import.meta.url))
const sha = 'a'.repeat(40)

test('tag is an offender', () => {
  assert.deepEqual(findUnpinned('uses: actions/checkout@v4'), ['actions/checkout@v4'])
})

test('40 hex sha is pinned', () => {
  assert.deepEqual(findUnpinned(`uses: actions/checkout@${sha}`), [])
})

test('sub path with sha is pinned', () => {
  assert.deepEqual(findUnpinned(`uses: github/codeql-action/init@${sha}`), [])
})

test('39 hex is an offender', () => {
  const short = 'a'.repeat(39)
  assert.deepEqual(findUnpinned(`uses: a/b@${short}`), [`a/b@${short}`])
})

test('uppercase hex is an offender', () => {
  const upper = 'A'.repeat(40)
  assert.deepEqual(findUnpinned(`uses: a/b@${upper}`), [`a/b@${upper}`])
})

test('branch is an offender', () => {
  assert.deepEqual(findUnpinned('uses: a/b@main'), ['a/b@main'])
})

test('local path is allowed', () => {
  assert.deepEqual(findUnpinned('uses: ./x'), [])
})

test('docker tag is an offender', () => {
  assert.deepEqual(findUnpinned('uses: docker://alpine:3'), ['docker://alpine:3'])
})

test('docker digest is pinned', () => {
  assert.deepEqual(findUnpinned(`uses: docker://alpine@sha256:${'b'.repeat(64)}`), [])
})

test('quoted values and list form are parsed', () => {
  const text = [
    'steps:',
    '  - uses: "actions/checkout@v4"',
    "    uses: 'actions/setup-node@v4'",
    `  - uses: actions/cache@${sha}`,
  ].join('\n')
  assert.deepEqual(findUnpinned(text), ['actions/checkout@v4', 'actions/setup-node@v4'])
})

test('trailing comment after a pin is an offender', () => {
  assert.deepEqual(findUnpinned(`uses: actions/checkout@${sha} # v4`), [`actions/checkout@${sha} # v4`])
})

test('hash directly after a pin is an offender', () => {
  assert.deepEqual(findUnpinned(`uses: a/b@${sha}#v4`), [`a/b@${sha}#v4`])
})

test('quoted pin with trailing comment is an offender', () => {
  assert.equal(findUnpinned(`uses: 'x/y@${sha}' # c`).length, 1)
})

test('tag with sha comment is still an offender', () => {
  assert.deepEqual(findUnpinned(`uses: a/b@v4 # ${sha}`), [`a/b@v4 # ${sha}`])
})

test('trailing spaces after a pin are allowed', () => {
  assert.deepEqual(findUnpinned(`uses: a/b@${sha}   `), [])
})

test('cli exits 2 with usage when no files are given', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr + result.stdout, /usage/i)
})

test('cli reports offenders and exits 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'))
  const file = path.join(dir, 'w.yml')
  fs.writeFileSync(file, '- uses: actions/checkout@v4\n')
  const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, `${file}: actions/checkout@v4\n`)
})

test('cli exits 0 silently when all pinned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'))
  const file = path.join(dir, 'w.yml')
  fs.writeFileSync(file, `- uses: actions/checkout@${sha}\n`)
  const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})
