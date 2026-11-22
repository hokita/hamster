import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const releasePattern = /^v\d+\.\d+\.\d+$/

const parse = (version) => version.replace(/^v/, '').split('.').map(Number)

const compare = (a, b) => {
  const [left, right] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

export function newerSecurityRelease(deployed, index) {
  const major = parse(deployed)[0]
  let newest = null
  for (const { version, security } of index) {
    if (!security || !releasePattern.test(version) || parse(version)[0] !== major) continue
    if (compare(version, deployed) <= 0) continue
    if (newest === null || compare(version, newest) > 0) newest = version
  }
  return newest
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rawDeployed, indexPath] = process.argv.slice(2)
  const deployed = rawDeployed?.trim()
  if (!deployed || !releasePattern.test(deployed) || !indexPath) {
    console.error('usage: check-node-runtime.mjs <deployed version> <index.json>')
    process.exit(2)
  }
  const newer = newerSecurityRelease(deployed, JSON.parse(fs.readFileSync(indexPath, 'utf8')))
  if (newer) {
    console.error(`Production runs ${deployed}; Node ${newer} is a security release. Bump Node in backend/Dockerfile, the Volta pins and setup-node, then redeploy hamster-backend.`)
    process.exit(1)
  }
  console.log(`Production runs ${deployed}; no newer Node ${parse(deployed)[0]} security release.`)
}
