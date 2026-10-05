// Export only the Git index into a clean checkout; no host npm dependencies/builds/env.
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises')
const { join, dirname, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash, randomUUID } = require('node:crypto')
const net = require('node:net')
const { openBrowser, waitFor } = require('./docker-browser.cjs')
const root = resolve(__dirname, '..')
const expectedHash = '19eee95c4676faf2ef56b34dd6533dc719c3073ae282cac61531b1822370fece'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function port() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const result = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return result
}
async function main() {
  const checkout = await mkdtemp(join(tmpdir(), 'squad-docker-checkout-'))
  const project = 'squad_docker_test_' + randomUUID().replaceAll('-', '')
  // Deliberately do not inherit DATABASE_URL/JWT/CRA/Compose variables from the caller.
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'USER', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  )
  env.COMPOSE_PROJECT_NAME = project
  const ports = new Set()
  for (const key of ['FRONTEND_PORT', 'API_PORT', 'POSTGRES_PORT', 'REDIS_PORT']) {
    let value
    do {
      value = await port()
    } while (ports.has(value))
    ports.add(value)
    env[key] = String(value)
  }
  const docker = (args, extra = {}) =>
    execFileSync('docker', args, {
      cwd: checkout,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      ...extra,
    })
  const compose = (args) => docker(['compose', ...args])
  const sql = (query) =>
    compose(['exec', '-T', 'postgres', 'psql', '-U', 'squad', '-d', 'squad', '-Atc', query]).trim()
  const origin = 'http://127.0.0.1:' + env.FRONTEND_PORT
  let up, browser
  let stage = 'clean checkout export'
  try {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root })
      .toString()
      .split('\0')
      .filter(Boolean)
    for (const file of files) {
      assert.ok(
        !/(^|\/)(node_modules|build|dist|\.env)$/.test(file),
        'Generated/env inputs must not be tracked',
      )
      await mkdir(dirname(join(checkout, file)), { recursive: true })
      // Read the index itself, not a developer's potentially modified working-tree contents.
      const bytes = execFileSync('git', ['show', ':' + file], {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      })
      await writeFile(join(checkout, file), bytes)
    }
    assert.equal(
      sha256(await readFile(join(checkout, 'frontend/src/data/characters.json'))),
      expectedHash,
    )
    stage = 'two-command fresh startup'
    execFileSync('cp', ['backend/.env.example', 'backend/.env'], { cwd: checkout, env })
    console.log(
      'Clean checkout exported; starting exact docker compose up --build with isolated project/ports.',
    )
    // Same attached command as the reviewer; keep it running while HTTP/browser assertions execute.
    up = spawn('docker', ['compose', 'up', '--build'], {
      cwd: checkout,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const logChunks = []
    up.stdout.on('data', (chunk) => logChunks.push(chunk.toString()))
    up.stderr.on('data', (chunk) => logChunks.push(chunk.toString()))
    await waitFor(
      async () => {
        if (up.exitCode !== null) throw new Error('Fresh Compose startup failed')
        try {
          return (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(2000) })).ok
        } catch {
          return false
        }
      },
      'Fresh Compose startup did not become healthy',
      600000,
    )
    const logs = logChunks.join('')
    assert.match(logs, /Applied 2 migration\(s\)/)
    assert.match(logs, /changed: true/)
    assert.equal(
      sql(
        'SELECT (SELECT count(*) FROM characters), (SELECT count(*) FROM character_abilities), (SELECT count(*) FROM character_tags), (SELECT count(*) FROM schema_migrations), (SELECT revision FROM catalog_state)',
      ),
      '208|1040|523|2|1',
    )
    const initId = compose(['ps', '-a', '-q', 'initialize']).trim()
    assert.equal(docker(['inspect', '-f', '{{.State.ExitCode}}', initId]).trim(), '0')
    docker([
      'cp',
      `${initId}:/app/frontend/src/data/characters.json`,
      join(checkout, 'init-source.json'),
    ])
    assert.equal(sha256(await readFile(join(checkout, 'init-source.json'))), expectedHash)
    for (const base of [origin, 'http://127.0.0.1:' + env.API_PORT]) {
      const health = await fetch(base + '/api/v1/health')
      assert.equal(health.status, 200)
      assert.deepEqual(await health.json(), {
        status: 'ok',
        dependencies: { postgres: 'up', redis: 'up' },
      })
      assert.equal((await fetch(base + '/api/docs')).status, 200)
      for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-init.js'])
        assert.equal((await fetch(base + '/api/docs/' + asset)).status, 200)
      const swagger = await (await fetch(base + '/api/docs-json')).json()
      assert.ok(swagger.paths['/api/v1/squads'])
    }
    assert.equal((await fetch(origin)).status, 200)
    const tooling = JSON.parse(
      compose([
        'exec',
        '-T',
        'api',
        'node',
        '-e',
        "const names=['eslint','typescript','ts-node','webpack','react-scripts'];console.log(JSON.stringify(names.filter(name=>{try{require.resolve(name);return true}catch{return false}})))",
      ]),
    )
    assert.deepEqual(tooling, [], 'Backend runtime must not contain build/dev peer tooling')
    console.log(
      'Fresh startup passed: automatic migrations/seed, all counts, init checksum, frontend/API/Swagger/health.',
    )
    stage = 'real browser flow'
    browser = await openBrowser(origin)
    await browser.initialJourney()
    assert.equal(
      sql(
        'SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM squads), (SELECT count(*) FROM squad_members)',
      ),
      '1|1|1',
    )
    console.log('Real Chrome register/create/add/remove/reload passed.')
    stage = 'container recreation'
    // Stop only this owned Compose project, keep its volumes, and recreate every container.
    up.kill('SIGINT')
    await waitFor(() => up.exitCode !== null, 'Attached Compose did not stop', 30000)
    for (const service of ['api', 'frontend', 'postgres', 'redis']) {
      const stoppedId = compose(['ps', '-a', '-q', service]).trim()
      const exitCode = docker(['inspect', '-f', '{{.State.ExitCode}}', stoppedId]).trim()
      // Nest closes dependencies then re-emits SIGTERM, yielding the normal signal exit 143.
      console.log(`Shutdown ${service}: exit ${exitCode}`)
      assert.ok(
        (service === 'api' ? ['0', '143'] : ['0']).includes(exitCode),
        'Shutdown must not require SIGKILL or fail',
      )
    }
    compose(['down'])
    compose(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120'])
    assert.equal(
      sql(
        'SELECT (SELECT count(*) FROM characters), (SELECT count(*) FROM character_abilities), (SELECT count(*) FROM character_tags), (SELECT revision FROM catalog_state), (SELECT count(*) FROM users), (SELECT count(*) FROM squads), (SELECT count(*) FROM squad_members)',
      ),
      '208|1040|523|1|1|1|1',
    )
    assert.match(compose(['logs', '--no-color', 'initialize']), /Applied 0 migration\(s\)/)
    assert.match(compose(['logs', '--no-color', 'initialize']), /changed: false/)
    await browser.afterRecreation()
    await browser.close()
    browser = undefined
    console.log(
      'Recreation passed: users/squads/members, seed counts/revision, and existing JWT remain valid.',
    )
    stage = 'build-context exclusions'
    // Plant canaries after the clean startup, then export the filtered context using Docker itself.
    for (const file of [
      '.env',
      'backend/.env.secret',
      '.idea/canary',
      'node_modules/canary',
      'frontend/build/canary',
      'assignment-canary.pdf',
      'backend/src/canary.key',
    ]) {
      await mkdir(dirname(join(checkout, file)), { recursive: true })
      await writeFile(join(checkout, file), 'UNRELATED_BUILD_CANARY=BUILD_CONTEXT_CANARY\n')
    }
    await writeFile(join(checkout, 'context-audit.Dockerfile'), 'FROM scratch\nCOPY . /\n')
    const audit = join(checkout, 'context-export')
    docker(['build', '-f', 'context-audit.Dockerfile', '--output', 'type=local,dest=' + audit, '.'])
    const auditFiles = execFileSync('find', [audit, '-type', 'f']).toString()
    assert.ok(
      !/canary|\/\.env|\.pdf|node_modules|\.idea|design-references/.test(auditFiles),
      'Sensitive/generated inputs leaked into build context',
    )
    assert.equal(
      sha256(await readFile(join(audit, 'frontend/src/data/characters.json'))),
      expectedHash,
    )
    console.log(
      'Docker context excludes env/secrets/modules/builds/IDE/PDF canaries; canonical source retained.',
    )
    stage = 'initialization failure gate'
    compose(['down'])
    // In a separate project/fresh volumes, valid migrations then an invalid mounted source must fail.
    env.COMPOSE_PROJECT_NAME = project + '_failure'
    await writeFile(join(checkout, 'invalid-source.json'), '[]')
    await writeFile(
      join(checkout, 'failure.yaml'),
      'services:\n  initialize:\n    volumes:\n      - ./invalid-source.json:/app/frontend/src/data/characters.json:ro\n',
    )
    let failed = false
    try {
      docker([
        'compose',
        '-f',
        'compose.yaml',
        '-f',
        'failure.yaml',
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '120',
      ])
    } catch {
      failed = true
    }
    assert.ok(failed, 'Initialization failure must make Compose fail')
    const failureInit = docker([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'failure.yaml',
      'ps',
      '-a',
      '-q',
      'initialize',
    ]).trim()
    assert.equal(docker(['inspect', '-f', '{{.State.ExitCode}}', failureInit]).trim(), '1')
    const apiIds = docker([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'failure.yaml',
      'ps',
      '-a',
      '-q',
      'api',
    ]).trim()
    if (apiIds)
      assert.notEqual(docker(['inspect', '-f', '{{.State.Status}}', apiIds]).trim(), 'running')
    assert.match(
      docker([
        'compose',
        '-f',
        'compose.yaml',
        '-f',
        'failure.yaml',
        'logs',
        '--no-color',
        'initialize',
      ]),
      /Seed failed: Invalid character source/,
    )
    assert.equal(
      sql(
        'SELECT (SELECT count(*) FROM characters), (SELECT count(*) FROM users), (SELECT count(*) FROM schema_migrations)',
      ),
      '0|0|2',
    )
    console.log(
      'Failure gate passed: visible seed validation failure, nonzero init, API never started, no character writes.',
    )
    assert.equal(
      sha256(await readFile(join(root, 'frontend/src/data/characters.json'))),
      expectedHash,
    )
    console.log(
      'Docker startup verification passed; isolated test projects and volumes are being removed.',
    )
  } catch (error) {
    // Do not print raw Docker/browser exception payloads, environment values or credentials.
    const safeBrowserMessages = new Set([
      'Chrome is unavailable; set CHROME_BIN',
      'Chrome did not start',
      'Chrome connection failed',
      'Browser command timed out',
      'Browser command failed',
      'Browser assertion command failed',
      'Expected enabled browser control',
      'Production catalogue did not render',
      'Browser registration/login failed',
      'Browser squad creation failed',
      'Browser addition failed',
      'Browser removal failed',
      'Browser re-addition failed',
      'Browser reload lost squad/session',
      'Browser reported an uncaught JavaScript error',
      'Container recreation lost squad or signing key',
      'Session persistence check failed',
    ])
    if (safeBrowserMessages.has(error.message)) console.error(error.message)
    throw new Error('Docker verification failed at: ' + stage)
  } finally {
    await browser?.close()
    if (up && up.exitCode === null) {
      up.kill('SIGINT')
      await waitFor(() => up.exitCode !== null, 'Compose cleanup timed out', 30000)
    }
    for (const owned of [project + '_failure', project]) {
      env.COMPOSE_PROJECT_NAME = owned
      try {
        compose(['down', '--volumes', '--remove-orphans'])
      } catch {
        console.error('Could not clean owned test project: ' + owned)
      }
    }
    await rm(checkout, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
