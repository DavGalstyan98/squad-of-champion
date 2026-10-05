import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

async function main(): Promise<void> {
  const path = resolve(__dirname, '../../.env')
  const content = await readFile(path, 'utf8')
  const match = /^(?:export\s+)?JWT_SECRET=.*$/m.exec(content)
  if (parse(content).JWT_SECRET) {
    console.log('JWT_SECRET already configured; existing value retained.')
    return
  }
  const line = `JWT_SECRET=${randomBytes(64).toString('hex')}`
  const updated = match
    ? content.replace(/^(?:export\s+)?JWT_SECRET=.*$/m, line)
    : `${content}\n${line}\n`
  await writeFile(path, updated, { mode: 0o600 })
  console.log('Local JWT secret configured; value not printed.')
}

main().catch(() => {
  console.error('Could not configure JWT secret. Copy backend/.env.example to backend/.env first.')
  process.exitCode = 1
})
