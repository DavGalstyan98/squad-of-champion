// Dependency-free Chrome DevTools smoke driver (Node 22/24 WebSocket).
const { spawn } = require('node:child_process')
const { readFile, mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { randomBytes, randomUUID } = require('node:crypto')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(100)
  }
  throw new Error(message)
}
async function openBrowser(origin) {
  const profile = await mkdtemp(join(tmpdir(), 'squad-docker-chrome-'))
  const chrome = spawn(
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let launchError = false
  chrome.on('error', () => {
    launchError = true
  })
  let socket
  try {
    let port
    await waitFor(async () => {
      if (launchError || chrome.exitCode !== null)
        throw new Error('Chrome is unavailable; set CHROME_BIN')
      try {
        port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
        return Boolean(port)
      } catch {
        return false
      }
    }, 'Chrome did not start')
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('Chrome connection failed')), {
        once: true,
      })
    })
    let id = 0
    const pending = new Map(),
      browserErrors = []
    socket.addEventListener('message', (event) => {
      const result = JSON.parse(event.data)
      if (result.method === 'Runtime.exceptionThrown')
        browserErrors.push('Uncaught JavaScript error')
      if (result.id && pending.has(result.id)) {
        pending.get(result.id)(result)
        pending.delete(result.id)
      }
    })
    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const requestId = ++id
        const timeout = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error('Browser command timed out'))
        }, 10000)
        pending.set(requestId, (result) => {
          clearTimeout(timeout)
          result.error ? reject(new Error('Browser command failed')) : resolve(result.result)
        })
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    const evaluate = async (expression) => {
      const result = await rpc('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.exceptionDetails) throw new Error('Browser assertion command failed')
      return result.result.value
    }
    const until = (expression, message) => waitFor(() => evaluate(expression), message)
    const fill = (label, value) =>
      evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(l => l.firstChild.textContent.trim() === ${JSON.stringify(label)});
      const input = label.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', {bubbles: true}));
    })()`)
    const click = async (name) => {
      const test = `(() => { const b = [...document.querySelectorAll('button, summary, input[type=checkbox]')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === ${JSON.stringify(name)}); return b && !b.disabled })()`
      await until(test, 'Expected enabled browser control')
      await evaluate(
        `(() => { [...document.querySelectorAll('button, summary, input[type=checkbox]')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === ${JSON.stringify(name)}).click() })()`,
      )
    }
    await rpc('Runtime.enable')
    await rpc('Page.enable')
    await rpc('Page.navigate', { url: origin })
    await until(
      "document.querySelectorAll('article').length === 24",
      'Production catalogue did not render',
    )
    return {
      async initialJourney() {
        const email = `docker-${randomUUID()}@example.com`,
          password = randomBytes(24).toString('hex')
        await click('Sign in or register')
        await click('Register')
        await fill('Email', email)
        await fill('Password', password)
        await click('Create account')
        await until(
          `document.querySelector('.account')?.textContent.includes(${JSON.stringify(email)})`,
          'Browser registration/login failed',
        )
        await click('Manage squads')
        await fill('New squad name', 'Docker persistent squad')
        await click('Create squad')
        await until(
          "document.querySelector('.squad-name')?.textContent === 'Docker persistent squad'",
          'Browser squad creation failed',
        )
        const name = await evaluate("document.querySelector('article h3').textContent")
        await click(`Add ${name} to squad`)
        await until(
          "document.querySelector('.workspace-tools .count')?.textContent.includes('1 / 6')",
          'Browser addition failed',
        )
        await click(`Remove ${name} from squad`)
        await until(
          "document.querySelector('.workspace-tools .count')?.textContent.includes('0 / 6')",
          'Browser removal failed',
        )
        await click(`Add ${name} to squad`)
        await until(
          "document.querySelector('.workspace-tools .count')?.textContent.includes('1 / 6')",
          'Browser re-addition failed',
        )
        await rpc('Page.reload')
        await until(
          "document.querySelector('.workspace-tools .count')?.textContent.includes('1 / 6')",
          'Browser reload lost squad/session',
        )
        if (browserErrors.length) throw new Error('Browser reported an uncaught JavaScript error')
      },
      async afterRecreation() {
        await rpc('Page.reload')
        await until(
          "document.querySelector('.squad-name')?.textContent === 'Docker persistent squad' && document.querySelector('.workspace-tools .count')?.textContent.includes('1 / 6')",
          'Container recreation lost squad or signing key',
        )
        const status = await evaluate(
          "fetch('/api/v1/auth/me', {headers: {Authorization: 'Bearer ' + sessionStorage.getItem('squad.accessToken')}}).then(r => r.status)",
        )
        if (status !== 200 || browserErrors.length)
          throw new Error('Session persistence check failed')
      },
      async close() {
        socket.close()
        chrome.kill('SIGTERM')
        await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), pause(3000)])
        if (chrome.exitCode === null) chrome.kill('SIGKILL')
        await rm(profile, { recursive: true, force: true })
      },
    }
  } catch (error) {
    socket?.close()
    chrome.kill('SIGTERM')
    await rm(profile, { recursive: true, force: true })
    throw error
  }
}
module.exports = { openBrowser, waitFor }
