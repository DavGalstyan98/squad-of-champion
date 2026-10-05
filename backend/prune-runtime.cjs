// npm's hoisted peer cycles can retain dev tools even with --omit=dev/peer.
// Keep the graph reachable from explicit backend production dependencies only.
// Run inside the Docker build, never against the developer's node_modules.
const fs = require('node:fs')
const path = require('node:path')
const root = '/app'
if (process.cwd() !== root) throw new Error('Runtime pruning requires the image /app directory')
const reachable = new Set()
function resolvePackage(name, from) {
  for (let directory = from; directory.startsWith(root); directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    if (directory === root) break
  }
  throw new Error('Missing required runtime dependency: ' + name)
}
function visit(directory) {
  if (reachable.has(directory)) return
  reachable.add(directory)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')))
  const dependencies = { ...manifest.dependencies }
  for (const [name, version] of Object.entries(manifest.peerDependencies || {})) {
    if (!manifest.peerDependenciesMeta?.[name]?.optional) dependencies[name] = version
  }
  for (const name of Object.keys(dependencies)) {
    if (manifest.optionalDependencies?.[name]) continue
    visit(resolvePackage(name, directory))
  }
}
const backend = path.join(root, 'backend')
const manifest = JSON.parse(fs.readFileSync(path.join(backend, 'package.json')))
for (const name of Object.keys(manifest.dependencies)) visit(resolvePackage(name, backend))
let removed = 0
function prune(modules) {
  if (!fs.existsSync(modules)) return
  for (const entry of fs.readdirSync(modules)) {
    if (entry.startsWith('.')) continue
    const directory = path.join(modules, entry)
    if (entry.startsWith('@')) {
      prune(directory)
      continue
    }
    if (!fs.existsSync(path.join(directory, 'package.json'))) continue
    const real = fs.realpathSync(directory)
    // Workspace links are configuration, not installed packages. Leave them alone.
    if (real === backend || real === path.join(root, 'frontend')) continue
    if (!reachable.has(real)) {
      if ([...reachable].some((item) => item.startsWith(real + path.sep)))
        throw new Error('Required nested package would be removed')
      fs.rmSync(directory, { recursive: true, force: true })
      removed++
    } else prune(path.join(directory, 'node_modules'))
  }
}
prune(path.join(root, 'node_modules'))
prune(path.join(backend, 'node_modules'))
console.log('Runtime dependency graph retained; removed ' + removed + ' unreachable packages')
