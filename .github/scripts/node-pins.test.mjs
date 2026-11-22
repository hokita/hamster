import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const unique = (values) => [...new Set(values)]

const workflowDir = '.github/workflows'
const workflows = fs
  .readdirSync(path.join(root, workflowDir))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: read(path.join(workflowDir, name)) }))

const dockerFroms = [
  ...read('backend/Dockerfile').matchAll(
    /^FROM node:(\d+\.\d+\.\d+)-alpine@(sha256:[0-9a-f]{64})(?: AS \S+)?$/gm
  ),
]
const dockerVersion = dockerFroms[0]?.[1]

test('every Dockerfile FROM pins the same node version and digest', () => {
  const allFroms = read('backend/Dockerfile').match(/^FROM .*$/gm)
  assert.equal(dockerFroms.length, allFroms.length)
  assert.ok(dockerFroms.length > 0)
  assert.equal(unique(dockerFroms.map((match) => match[1])).length, 1)
  assert.equal(unique(dockerFroms.map((match) => match[2])).length, 1)
})

test('every setup-node in every workflow uses the Dockerfile version', () => {
  const versions = workflows.flatMap(({ text }) =>
    [...text.matchAll(/node-version: '([^']+)'/g)].map((match) => match[1])
  )
  assert.ok(versions.length > 0)
  assert.deepEqual(unique(versions), [dockerVersion])
})

test('every workflow that runs npm, npx or node sets up node', () => {
  const missing = workflows
    .filter(({ text }) => /^\s*(?:run:\s*)?(?:npm|npx|node)\s/m.test(text))
    .filter(({ text }) => !text.includes('actions/setup-node@'))
    .map(({ name }) => name)
  assert.deepEqual(missing, [])
})

test('every package.json pins node with Volta to the Dockerfile version', () => {
  for (const file of [
    'package.json',
    'backend/package.json',
    'frontend/package.json',
    'e2e/package.json',
  ]) {
    assert.equal(JSON.parse(read(file)).volta?.node, dockerVersion, file)
  }
})

test('npx firebase-tools pins match the root lockfile', () => {
  const locked = JSON.parse(read('package-lock.json')).packages['node_modules/firebase-tools']
    .version
  const pinned = workflows.flatMap(({ text }) =>
    [...text.matchAll(/npx (?:-y )?firebase-tools@(\S+)/g)].map((match) => match[1])
  )
  assert.ok(pinned.length > 0)
  assert.deepEqual(unique(pinned), [locked])
})
