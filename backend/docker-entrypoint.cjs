// Compose-only bootstrap. Explicit JWT_SECRET wins; otherwise persist a private local key.
const { readFileSync, writeFileSync } = require('node:fs')
const { randomBytes } = require('node:crypto')
const path = '/var/lib/squad/jwt/secret'
if (!process.env.JWT_SECRET) {
  try {
    writeFileSync(path, randomBytes(64).toString('hex'), { flag: 'wx', mode: 0o600 })
    console.log('Generated persistent local JWT signing key; value not printed.')
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error('Cannot initialize local JWT signing key')
  }
  process.env.JWT_SECRET = readFileSync(path, 'utf8')
}
// Nest runs in this process; shutdown hooks receive Docker's SIGTERM directly.
require('./dist/main.js')
