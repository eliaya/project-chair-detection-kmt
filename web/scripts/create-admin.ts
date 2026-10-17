/* eslint-disable no-console */
// Create an admin account in D1, or reset the password of an existing email.
// Usage: npm run admin:create -- <email> [name] [--remote]
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { adminCreateSchema } from '../shared/schemas.ts'
import { hashPassword } from '../worker/auth.ts'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const [email, name = ''] = args.filter((a) => a !== '--remote')

// readline echoes keystrokes to its output; send that to a sink so the password
// stays hidden, and write the prompts to stdout directly.
const sink = new Writable({ write: (_chunk, _enc, done) => done() })
const rl = createInterface({
  input: process.stdin,
  output: sink,
  terminal: !!process.stdin.isTTY,
})
rl.on('SIGINT', () => process.exit(130))
const lines = rl[Symbol.asyncIterator]()
async function ask(prompt: string) {
  process.stdout.write(prompt)
  const { value = '' } = await lines.next()
  process.stdout.write('\n')
  return value as string
}
const password = await ask('パスワード（半角英数字・記号 8文字以上）: ')
const confirm = await ask('もう一度入力: ')
rl.close()
if (password !== confirm) {
  console.error('✘ パスワードが一致しません')
  process.exit(1)
}

const r = adminCreateSchema.safeParse({ email, name, password })
if (!r.success) {
  for (const i of r.error.issues) console.error(`✘ ${i.path.join('.')}: ${i.message}`)
  process.exit(1)
}
const d = r.data
// `d1 execute --command` has no bind parameters; quote as SQLite string literals.
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const sql = `INSERT INTO admins (email, name, password_hash) VALUES (${lit(d.email)}, ${lit(d.name)}, ${lit(await hashPassword(d.password))})
  ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash,
    name = COALESCE(NULLIF(excluded.name, ''), admins.name)`
execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'kmt-occupancy', remote ? '--remote' : '--local', '--command', sql],
  { stdio: 'inherit' }
)
console.log(`✔ ${d.email} を${remote ? 'リモート' : 'ローカル'}の D1 に保存しました`)
