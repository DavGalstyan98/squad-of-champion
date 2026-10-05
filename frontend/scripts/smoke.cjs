// Real browser + real Nest/PostgreSQL smoke. No development database writes.
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')
const { chromium, expect } = require('@playwright/test')
const Redis = require('ioredis')
const root = path.resolve(__dirname, '../..')
require('ts-node').register({ project: path.join(root, 'backend/tsconfig.json') })
require('reflect-metadata')
const { createDataSource, databaseUrl } = require(
  path.join(root, 'backend/src/database/data-source.ts'),
)
const { readSource } = require(path.join(root, 'backend/src/database/seed-source.ts'))
const { seedCatalogue } = require(path.join(root, 'backend/src/database/seed.ts'))
const { configureApp } = require(path.join(root, 'backend/src/configure-app.ts'))
const { NestFactory } = require('@nestjs/core')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
let stage = 'test infrastructure'
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Browser smoke refuses production')
  const adminUrl = databaseUrl(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL)
  const name = 'squad_browser_test_' + randomUUID().replaceAll('-', '')
  const url = new URL(adminUrl)
  url.pathname = '/' + name
  const frontendPort = await freePort(),
    frontendOrigin = 'http://127.0.0.1:' + frontendPort
  const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
  const namespace = 'test_browser_' + randomUUID().replaceAll('-', '')
  const overrides = {
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(64).toString('hex'),
    CORS_ORIGINS: frontendOrigin,
    REDIS_URL: redisUrl,
    CACHE_NAMESPACE: namespace,
  }
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]))
  const admin = await createDataSource(adminUrl).initialize()
  let database,
    app,
    frontend,
    browser,
    created = false
  const inspection = new Redis(redisUrl, {
    connectTimeout: 1000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 0,
  })
  inspection.on('error', () => {})
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    database = await createDataSource(url.toString()).initialize()
    await database.runMigrations()
    await seedCatalogue(database, await readSource())
    Object.assign(process.env, overrides)
    const { AppModule } = require(path.join(root, 'backend/src/app.module.ts'))
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
    configureApp(app)
    await app.listen(0, '127.0.0.1')
    const backendOrigin = await app.getUrl()
    const swagger = await (await fetch(backendOrigin + '/api/docs-json')).json()
    for (const route of [
      '/api/v1/auth/me',
      '/api/v1/characters',
      '/api/v1/squads',
      '/api/v1/squads/{id}',
    ])
      assert.ok(swagger.paths[route])
    stage = 'frontend dev server startup'
    frontend = spawn(process.execPath, [require.resolve('react-scripts/scripts/start')], {
      cwd: path.join(root, 'frontend'),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(frontendPort),
        BROWSER: 'none',
        CI: 'true',
        FAST_REFRESH: 'false',
        REACT_APP_API_URL: backendOrigin + '/api/v1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let serverLog = ''
    frontend.stdout.on('data', (data) => {
      serverLog = (serverLog + data.toString()).slice(-4000)
    })
    frontend.stderr.on('data', (data) => {
      serverLog = (serverLog + data.toString()).slice(-4000)
    })
    const deadline = Date.now() + 90000
    let ready = false
    while (Date.now() < deadline) {
      if (frontend.exitCode !== null)
        throw new Error('Frontend dev server exited; run build/typecheck for diagnostics')
      try {
        const response = await fetch(frontendOrigin, { signal: AbortSignal.timeout(1000) })
        if (response.ok && serverLog.includes('Compiled')) {
          ready = true
          break
        }
      } catch {
        /* Wait for compilation. */
      }
      await pause(250)
    }
    assert.ok(ready, 'Frontend dev server must compile within 90 seconds')
    stage = 'Chrome launch'
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
      headless: true,
    })
    const page = await browser.newPage({ viewport: { width: 1376, height: 1080 } })
    const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), 'squad-frontend-'))
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.name))
    // External scraped images can be unavailable; force a deterministic fallback check.
    await page.route('**/*', (route) =>
      route.request().resourceType() === 'image' &&
      !route.request().url().startsWith(frontendOrigin)
        ? route.abort()
        : route.continue(),
    )
    stage = 'public catalogue'
    await page.goto(frontendOrigin)
    await expect(page.getByRole('article')).toHaveCount(24)
    stage = 'registration'
    await expect(page.getByRole('checkbox', { name: /^Add .* to squad$/ }).first()).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Sign in to select characters', exact: true }),
    ).toBeVisible()
    assert.equal(await page.getByText('Catalogue options', { exact: true }).count(), 0)
    await page.getByText('Sign in or register', { exact: true }).click()
    await page.getByRole('button', { name: 'Register', exact: true }).click()
    const email = 'browser-' + randomUUID() + '@example.com',
      password = randomBytes(24).toString('hex')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    stage = 'squad creation'
    await page.getByText('Manage squads', { exact: false }).click()
    await page.getByLabel('New squad name').fill('Browser verified squad')
    await page.getByRole('button', { name: 'Create squad', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Browser verified squad', exact: true }),
    ).toBeVisible()
    stage = 'search and membership'
    await page.unroute('**/*')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('article')).toHaveCount(24)
    await expect(page.getByText('0 / 6 members', { exact: true })).toBeVisible()
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.character-row')]
          .slice(0, 3)
          .every((row) => [...row.querySelectorAll('img')].every((image) => image.complete)),
      undefined,
      { timeout: 15000 },
    )
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(screenshots, 'desktop-empty.png') })
    await page.getByText('Manage squads', { exact: false }).click()
    const firstSearch = await (await fetch(backendOrigin + '/api/v1/characters?search=goku')).json()
    const champion = firstSearch.data[0]
    assert.ok(champion)
    await page.getByLabel('Search by name').fill('goku')
    await expect(page.getByRole('article', { name: champion.name, exact: true })).toBeVisible()
    async function slowMemberChange(checkbox) {
      await expect(checkbox).toBeEnabled()
      const snapshot = () =>
        page.evaluate(() =>
          [
            '.squad-summary h1',
            '.statistics',
            '.statistics dt',
            '.statistics dd',
            '.average-value',
            '.members',
            '.members li',
            '.search',
            '.catalogue',
            '.table-heading',
            '.character-grid',
          ].flatMap((selector) =>
            [...document.querySelectorAll(selector)].map((element) => {
              const box = element.getBoundingClientRect()
              return {
                selector,
                x: box.x + scrollX,
                y: box.y + scrollY,
                width: box.width,
                height: box.height,
              }
            }),
          ),
        )
      const before = await snapshot()
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const pattern = '**/api/v1/squads/*/characters/*'
      await page.route(pattern, async (route) => {
        await gate
        await route.continue()
      })
      try {
        await checkbox.click()
        await expect(page.getByTestId('average-skeleton')).toHaveCount(5)
        await expect(page.getByRole('region', { name: 'Server squad statistics' })).toHaveAttribute(
          'aria-busy',
          'true',
        )
        await page.waitForTimeout(1500)
        assert.deepEqual(
          await snapshot(),
          before,
          'Slow mutation must not move headings, avatars, values, search or catalogue',
        )
        assert.ok(
          await page.locator('.average-skeleton').evaluateAll((skeletons) =>
            skeletons.every((skeleton) => {
              const box = skeleton.getBoundingClientRect(),
                value = skeleton.parentElement.getBoundingClientRect()
              return box.width === value.width && box.height === value.height
            }),
          ),
          'Skeletons match the reserved value dimensions',
        )
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert.ok(
          await page
            .locator('.average-skeleton')
            .evaluateAll((skeletons) =>
              skeletons.every((skeleton) => getComputedStyle(skeleton).animationName === 'none'),
            ),
          'Reduced motion disables skeleton animation',
        )
        assert.deepEqual(await snapshot(), before, 'Reduced motion preserves geometry')
      } finally {
        release()
      }
      await expect(page.getByTestId('average-skeleton')).toHaveCount(0)
      await page.unroute(pattern)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      console.log(
        'Slow checkbox mutation passed: five dimension-matched skeletons, zero layout changes during 1500ms delay, reduced motion respected, server values restored.',
      )
    }
    await slowMemberChange(
      page.getByRole('checkbox', { name: `Add ${champion.name} to squad`, exact: true }),
    )
    await expect(page.getByText('1 / 6 members', { exact: true })).toBeVisible()
    await page.getByLabel('Search by name').fill('')
    await expect(page.getByText('Page 1 of 9', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect(page.getByText('Page 2 of 9', { exact: true })).toBeVisible()
    await expect(
      page
        .getByRole('list', { name: 'Saved squad members' })
        .getByText(champion.name, { exact: true }),
    ).toBeVisible()
    const secondPage = await (await fetch(backendOrigin + '/api/v1/characters?page=2')).json()
    const second = secondPage.data.find((character) => character.id !== champion.id)
    await page.getByRole('checkbox', { name: `Add ${second.name} to squad`, exact: true }).click()
    await expect(page.getByText('2 / 6 members', { exact: true })).toBeVisible()
    await slowMemberChange(
      page.getByRole('checkbox', { name: `Remove ${second.name} from squad`, exact: true }),
    )
    await expect(page.getByText('1 / 6 members', { exact: true })).toBeVisible()
    await page.getByLabel('Rename squad', { exact: true }).fill('Browser renamed squad')
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Browser renamed squad', exact: true }),
    ).toBeVisible()
    stage = 'reload restoration'
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Browser renamed squad', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('1 / 6 members', { exact: true })).toBeVisible()
    await expect(
      page
        .getByRole('list', { name: 'Saved squad members' })
        .getByText(champion.name, { exact: true }),
    ).toBeVisible()
    stage = 'logout and login'
    await page.getByRole('button', { name: 'Log out', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Browser renamed squad', exact: true }),
    ).toHaveCount(0)
    assert.equal(await page.evaluate(() => sessionStorage.length), 0)
    stage = 'login form after logout'
    await page.getByText('Sign in or register', { exact: true }).click()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    stage = 'logging in to persisted squad'
    await page.getByRole('button', { name: 'Sign in to account', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Browser renamed squad', exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('list', { name: 'Saved squad members' })
        .getByText(champion.name, { exact: true }),
    ).toBeVisible()
    stage = 'member replacement'
    stage = 'opening restored squad controls'
    await page.getByText('Manage squads', { exact: false }).click()
    const replacement = (
      await (await fetch(backendOrigin + '/api/v1/characters')).json()
    ).data.find((character) => character.id !== champion.id)
    await page.getByRole('button', { name: 'Edit full member list', exact: true }).click()
    await page
      .getByRole('button', { name: `Remove ${champion.name} from replacement draft`, exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: `Stage ${replacement.name} for replacement`, exact: true })
      .click()
    await expect(
      page
        .getByRole('list', { name: 'Saved squad members' })
        .getByText(champion.name, { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Save replacement', exact: true }).click()
    await expect(
      page
        .getByRole('list', { name: 'Saved squad members' })
        .getByText(replacement.name, { exact: true }),
    ).toBeVisible()
    stage = 'second squad deletion'
    await page.getByLabel('New squad name').fill('Temporary second squad')
    await page.getByRole('button', { name: 'Create squad', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Temporary second squad', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Delete squad', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm delete squad', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Browser renamed squad', exact: true }),
    ).toBeVisible()
    stage = 'responsive and keyboard checks'
    stage = 'six member reference capture'
    await page.getByLabel('animal', { exact: true }).check()
    const roster = (await (await fetch(backendOrigin + '/api/v1/characters?tags=animal')).json())
      .data
    for (const character of roster.filter((item) => item.id !== replacement.id).slice(0, 5)) {
      await page
        .getByRole('checkbox', { name: `Add ${character.name} to squad`, exact: true })
        .click()
      await expect(
        page.getByRole('checkbox', { name: `Remove ${character.name} from squad`, exact: true }),
      ).toBeChecked()
    }
    await expect(page.getByText('6 / 6 members', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('checkbox', { name: /^Remove .* from squad$/ }).first(),
    ).toBeEnabled()
    assert.ok(
      await page
        .getByRole('article')
        .getByRole('checkbox')
        .evaluateAll((checkboxes) =>
          checkboxes.every((checkbox) =>
            checkbox.checked ? !checkbox.disabled : checkbox.disabled,
          ),
        ),
      'A full squad disables all unselected character checkboxes while allowing deselection',
    )
    await page.getByText('Manage squads', { exact: false }).click()
    await page.getByLabel('animal', { exact: true }).check()
    await expect(page.getByRole('checkbox', { name: 'animal', exact: true })).toBeChecked()
    stage = 'selected reference hover capture'
    await page.getByRole('list', { name: 'Saved squad members' }).getByRole('button').nth(1).hover()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('list', { name: 'Saved squad members' }).getByRole('button').nth(1).hover()
    await page.screenshot({ path: path.join(screenshots, 'desktop-selected.png') })
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true })
    stage = 'mobile width and keyboard checks'
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Browser renamed squad', exact: true }),
    ).toBeVisible()
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Mobile view must not overflow horizontally',
    )
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to catalogue', exact: true })).toBeFocused()
    await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true })
    assert.equal(pageErrors.length, 0, 'Browser must have no uncaught JavaScript errors')
    stage = 'responsive character column alignment'
    for (const width of [1376, 1280, 1100, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1080 })
      const layout = await page.evaluate(() => {
        const heading = document.querySelector('.table-heading')
        const row = document.querySelector('.character-row')
        const list = document.querySelector('.character-list')
        const headings = [...heading.children].slice(2).map((cell) => {
          const bounds = cell.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(cell)
          const text = range.getBoundingClientRect()
          return { center: (bounds.left + bounds.right) / 2, left: text.left, right: text.right }
        })
        const scores = [...row.querySelectorAll('.ability-score')].map((cell) => {
          const bounds = cell.getBoundingClientRect()
          return (bounds.left + bounds.right) / 2
        })
        return {
          headings,
          scores,
          tableScrolls: list.scrollWidth > list.clientWidth,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      assert.equal(layout.headings.length, 5)
      layout.headings.forEach((heading, index) => {
        assert.ok(
          Math.abs(heading.center - layout.scores[index]) < 1,
          `Aligned column ${index} at ${width}px`,
        )
        if (index)
          assert.ok(
            heading.left - layout.headings[index - 1].right >= 12,
            `Separated headings at ${width}px`,
          )
      })
      assert.equal(layout.overflow, false, `No document overflow at ${width}px`)
      if (width <= 1100) assert.ok(layout.tableScrolls, `Table scrolls intentionally at ${width}px`)
    }
    console.log(
      'Column geometry passed at 1376/1280/1100/1024/768/390px: all five text headings separated by >=12px, score centers aligned within 1px, contained narrow-screen scrolling.',
    )
    console.log(
      'Browser smoke passed: register/login, create, search/page, add/remove, rename, reload, logout/login persistence, replacement, delete, mobile width and keyboard focus.',
    )
    console.log('Screenshots: ' + screenshots)
  } finally {
    await browser?.close()
    if (frontend && frontend.exitCode === null) {
      frontend.kill('SIGTERM')
      await Promise.race([new Promise((resolve) => frontend.once('exit', resolve)), pause(3000)])
      if (frontend.exitCode === null) frontend.kill('SIGKILL')
    }
    await app?.close()
    await database?.destroy()
    const keys = await inspection.keys(namespace + ':*')
    if (keys.length) await inspection.del(...keys)
    inspection.disconnect()
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.destroy()
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
main().catch((error) => {
  const location = error.stack?.match(/smoke\.cjs:(\d+):\d+/)?.[1]
  if (location) console.error('Check location: smoke.cjs:' + location)
  console.error(
    'Browser smoke failed at: ' +
      stage +
      '. Credentials and request details are intentionally not printed.',
  )
  process.exitCode = 1
})
