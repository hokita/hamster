import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newerSecurityRelease } from './check-node-runtime.mjs'

const script = fileURLToPath(new URL('./check-node-runtime.mjs', import.meta.url))
const entry = (version, security) => ({ version, security })

test('deployed is newest security release', () => {
  assert.equal(newerSecurityRelease('v24.22.3', [entry('v24.22.3', true)]), null)
})

test('newer security release is returned', () => {
  const index = [entry('v24.22.3', true), entry('v24.22.2', false)]
  assert.equal(newerSecurityRelease('v24.22.1', index), 'v24.22.3')
})

test('newer non-security release is ignored', () => {
  assert.equal(newerSecurityRelease('v24.22.2', [entry('v24.22.3', false)]), null)
})

test('other majors are ignored', () => {
  assert.equal(newerSecurityRelease('v24.22.3', [entry('v26.1.0', true)]), null)
})

test('comparison is numeric', () => {
  assert.equal(newerSecurityRelease('v24.9.0', [entry('v24.10.0', true)]), 'v24.10.0')
  assert.equal(newerSecurityRelease('v24.10.0', [entry('v24.9.0', true)]), null)
})

test('newest of several security releases wins', () => {
  const index = [entry('v24.10.0', true), entry('v24.22.0', true), entry('v24.9.0', true)]
  assert.equal(newerSecurityRelease('v24.1.0', index), 'v24.22.0')
})

const runCli = (deployed, index) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-runtime-'))
  const file = path.join(dir, 'index.json')
  fs.writeFileSync(file, JSON.stringify(index))
  return spawnSync(process.execPath, [script, deployed, file], { encoding: 'utf8' })
}

test('cli success message and exit 0', () => {
  const result = runCli('v24.22.3', [entry('v24.22.3', true)])
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'Production runs v24.22.3; no newer Node 24 security release.\n')
})

test('cli failure message and exit 1', () => {
  const result = runCli('v24.22.1', [entry('v24.22.3', true)])
  assert.equal(result.status, 1)
  assert.equal(
    result.stderr + result.stdout,
    'Production runs v24.22.1; Node v24.22.3 is a security release. Redeploy hamster-backend.\n',
  )
})

test('cli trims a trailing newline on the deployed version', () => {
  const result = runCli('v24.22.3\n', [entry('v24.22.3', true)])
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'Production runs v24.22.3; no newer Node 24 security release.\n')
})
